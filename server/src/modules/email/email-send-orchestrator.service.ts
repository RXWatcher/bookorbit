import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { SendMailOptions } from 'nodemailer';

import { NotificationType } from '@bookorbit/types';
import type { BookFile } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { NotificationService } from '../notification/notification.service';
import { BookService } from '../book/book.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { EmailBookAccessService } from './email-book-access.service';
import { EmailFileSelector } from './email-file-selector';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailRecipientService } from './email-recipient.service';
import { KINDLE_CONVERT_SUBJECT } from './email-send.constants';
import { EmailSendLogService, SEND_RETRY_DELAYS_MS } from './email-send-log.service';
import { EmailTemplateContextService } from './email-template-context.service';
import { EmailTemplateService } from './email-template.service';
import { EmailTransportService } from './email-transport.service';
import { renderTemplate } from './email-template-renderer';
import type { SendBookDto } from './dto/send-book.dto';

interface SendTask {
  bookId: number | null;
  userId: number;
  recipientId: number;
  recipientEmail: string;
  recipientName: string;
  deviceType: string | null;
  preferredFormat: string | null;
  effectiveTemplateId: number | null;
  catalogMediaType?: 'ebook' | null;
  catalogRemoteId?: string | null;
}

const EMAIL_SEND_EVENT = 'email.send';
const EMAIL_RESEND_EVENT = 'email.resend';
const EMAIL_QUICK_SEND_EVENT = 'email.quick-send';
const EMAIL_DISPATCH_EVENT = 'email.dispatch';

type CatalogEbookSelection = { remoteId: string };
type CatalogDownload = Awaited<ReturnType<WarehouseCatalogService['downloadEbook']>>;
type ResendLogEntry = Awaited<ReturnType<EmailSendLogService['getForResend']>>;
type EmailAttachment = BookFile | CatalogAttachment;
type MailAttachment = NonNullable<SendMailOptions['attachments']>[number];

interface CatalogAttachment {
  kind: 'catalog';
  fallbackFilename: string;
  load: () => Promise<CatalogDownload>;
}

@Injectable()
export class EmailSendOrchestrator {
  private readonly logger = new Logger(EmailSendOrchestrator.name);

  constructor(
    private readonly bookService: BookService,
    private readonly bookAccessService: EmailBookAccessService,
    private readonly providerResolver: EmailProviderResolver,
    private readonly fileSelector: EmailFileSelector,
    private readonly recipientService: EmailRecipientService,
    private readonly groupService: EmailRecipientGroupService,
    private readonly templateService: EmailTemplateService,
    private readonly templateContextService: EmailTemplateContextService,
    private readonly preferencesService: EmailPreferencesService,
    private readonly sendLogService: EmailSendLogService,
    private readonly transportService: EmailTransportService,
    private readonly notificationService: NotificationService,
    private readonly warehouseCatalog: WarehouseCatalogService,
  ) {}

  async send(dto: SendBookDto, user: RequestUser): Promise<{ queued: number }> {
    const startedAt = Date.now();
    const requestedRecipientCount = (dto.recipientIds?.length ?? 0) + (dto.groupIds?.length ?? 0);
    this.logger.log(
      `[${EMAIL_SEND_EVENT}] [start] userId=${user.id} selectionMode=${dto.query ? 'query' : 'ids'} requestedCount=${dto.bookIds?.length ?? 0} requestedRecipientCount=${requestedRecipientCount} - send enqueue started`,
    );

    try {
      const catalogEbooks = this.resolveCatalogEbookSelections(dto);
      const bookIds = [...new Set(await this.bookService.resolveSelectionToIds(dto, user))];
      if (bookIds.length > 0) {
        await this.bookAccessService.assertUserCanAccessBooks(bookIds, user);
      }

      const preferences = await this.preferencesService.getForUser(user.id);
      const tasks = await this.buildTasks(dto, user, preferences?.defaultTemplateId ?? null);
      if (tasks.length === 0) throw new BadRequestException('No recipients specified');

      const resolved = await this.providerResolver.resolve(user, dto.providerId);

      let queued = 0;
      for (const task of tasks) {
        for (const bookId of bookIds) {
          await this.enqueueOne({ ...task, bookId, userId: user.id }, resolved, dto.fileId ?? null, user);
          queued++;
        }
        for (const catalogEbook of catalogEbooks) {
          await this.enqueueCatalogEbook({ ...task, bookId: null, userId: user.id }, resolved, catalogEbook, user);
          queued++;
        }
      }

      this.logger.log(`[${EMAIL_SEND_EVENT}] [end] userId=${user.id} durationMs=${Date.now() - startedAt} queued=${queued} - send enqueue completed`);
      return { queued };
    } catch (error) {
      this.logger.error(
        `[${EMAIL_SEND_EVENT}] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${this.getErrorClass(error)} error="${this.getErrorMessage(error)}" - send enqueue failed`,
      );
      throw error;
    }
  }

  async resend(logEntryId: number, user: RequestUser): Promise<{ queued: number }> {
    const startedAt = Date.now();
    this.logger.log(`[${EMAIL_RESEND_EVENT}] [start] userId=${user.id} logEntryId=${logEntryId} - resend enqueue started`);

    try {
      const logEntry = await this.sendLogService.getForResend(logEntryId, user);
      if (logEntry.catalogMediaType === 'ebook' && logEntry.catalogRemoteId) {
        return await this.resendCatalogEbook(logEntryId, logEntry, user);
      }

      if (logEntry.bookId === null || logEntry.bookId === undefined || !logEntry.toEmail) {
        throw new BadRequestException('Cannot resend: original book or recipient is missing');
      }

      await this.bookAccessService.assertUserCanAccessBook(logEntry.bookId, user);

      const resolved = await this.providerResolver.resolve(user, logEntry.providerId ?? null);
      const file = await this.fileSelector.select(logEntry.bookId, logEntry.bookFileId ?? null, null);
      const template = await this.templateService.resolveTemplate(logEntry.templateId ?? null, user);
      const context = await this.templateContextService.buildForBook(logEntry.bookId, file.id, user.name);
      const rendered = renderTemplate(template.subject, template.bodyText, context);
      const effectiveSubject = logEntry.subject === KINDLE_CONVERT_SUBJECT ? KINDLE_CONVERT_SUBJECT : rendered.subject;

      const newLog = await this.sendLogService.create({
        userId: user.id,
        bookId: logEntry.bookId,
        bookFileId: file.id,
        providerId: resolved.providerId,
        templateId: template.id,
        toEmail: logEntry.toEmail,
        toName: logEntry.toName ?? '',
        subject: effectiveSubject,
      });

      const task: SendTask = {
        bookId: logEntry.bookId,
        userId: user.id,
        recipientId: 0,
        recipientEmail: logEntry.toEmail,
        recipientName: logEntry.toName ?? '',
        deviceType: logEntry.subject === KINDLE_CONVERT_SUBJECT ? 'kindle' : null,
        preferredFormat: null,
        effectiveTemplateId: logEntry.templateId ?? null,
      };

      setImmediate(() => void this.dispatchSend(newLog.id, resolved.config, task, file, effectiveSubject, rendered.bodyText, 0));

      this.logger.log(
        `[${EMAIL_RESEND_EVENT}] [end] userId=${user.id} logEntryId=${logEntryId} durationMs=${Date.now() - startedAt} queued=1 - resend enqueue completed`,
      );
      return { queued: 1 };
    } catch (error) {
      this.logger.error(
        `[${EMAIL_RESEND_EVENT}] [fail] userId=${user.id} logEntryId=${logEntryId} durationMs=${Date.now() - startedAt} errorClass=${this.getErrorClass(error)} error="${this.getErrorMessage(error)}" - resend enqueue failed`,
      );
      throw error;
    }
  }

  async quickSend(bookId: number, user: RequestUser): Promise<{ queued: number }> {
    const startedAt = Date.now();
    this.logger.log(`[${EMAIL_QUICK_SEND_EVENT}] [start] userId=${user.id} bookId=${bookId} - quick send enqueue started`);

    try {
      await this.bookAccessService.assertUserCanAccessBook(bookId, user);
      const prefs = await this.preferencesService.getForUser(user.id);
      if (!prefs?.defaultRecipientId) {
        throw new BadRequestException('No default recipient configured. Set one in email settings.');
      }

      const recipient = await this.recipientService.getOwnedById(prefs.defaultRecipientId, user);
      const resolved = await this.providerResolver.resolve(user, null);

      await this.enqueueOne(
        {
          bookId,
          userId: user.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          deviceType: recipient.deviceType,
          preferredFormat: recipient.preferredFormat,
          effectiveTemplateId: recipient.defaultTemplateId ?? prefs.defaultTemplateId ?? null,
        },
        resolved,
        null,
        user,
      );

      this.logger.log(
        `[${EMAIL_QUICK_SEND_EVENT}] [end] userId=${user.id} bookId=${bookId} durationMs=${Date.now() - startedAt} queued=1 - quick send enqueue completed`,
      );
      return { queued: 1 };
    } catch (error) {
      this.logger.error(
        `[${EMAIL_QUICK_SEND_EVENT}] [fail] userId=${user.id} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${this.getErrorClass(error)} error="${this.getErrorMessage(error)}" - quick send enqueue failed`,
      );
      throw error;
    }
  }

  private async buildTasks(dto: SendBookDto, user: RequestUser, defaultTemplateId: number | null): Promise<Omit<SendTask, 'bookId' | 'userId'>[]> {
    const recipientIds = new Set<number>(dto.recipientIds ?? []);

    if (dto.groupIds?.length) {
      const groupRecipients = await Promise.all(dto.groupIds.map((groupId) => this.groupService.expandOwnedGroupToRecipientIds(groupId, user)));
      for (const groupMemberIds of groupRecipients) {
        groupMemberIds.forEach((id) => recipientIds.add(id));
      }
    }

    const dedupedRecipientIds = [...recipientIds];
    if (dedupedRecipientIds.length === 0) return [];

    const recipients = await this.recipientService.getOwnedByIds(dedupedRecipientIds, user);
    return recipients.map((recipient) => ({
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      deviceType: recipient.deviceType,
      preferredFormat: recipient.preferredFormat,
      effectiveTemplateId: dto.templateId ?? recipient.defaultTemplateId ?? defaultTemplateId,
    }));
  }

  private async enqueueOne(
    task: SendTask,
    resolved: Awaited<ReturnType<EmailProviderResolver['resolve']>>,
    fileId: number | null,
    user: RequestUser,
  ) {
    if (task.bookId === null) throw new BadRequestException('No book selected');
    const bookId = task.bookId;
    const file = await this.fileSelector.select(bookId, fileId, task.preferredFormat);
    const template = await this.templateService.resolveTemplate(task.effectiveTemplateId, user);
    const context = await this.templateContextService.buildForBook(bookId, file.id, user.name);
    const rendered = renderTemplate(template.subject, template.bodyText, context);

    const effectiveSubject = task.deviceType === 'kindle' ? KINDLE_CONVERT_SUBJECT : rendered.subject;

    const logEntry = await this.sendLogService.create({
      userId: user.id,
      bookId,
      bookFileId: file.id,
      providerId: resolved.providerId,
      templateId: template.id,
      toEmail: task.recipientEmail,
      toName: task.recipientName,
      subject: effectiveSubject,
    });

    setImmediate(() => void this.dispatchSend(logEntry.id, resolved.config, task, file, effectiveSubject, rendered.bodyText, 0));
  }

  private async enqueueCatalogEbook(
    task: SendTask,
    resolved: Awaited<ReturnType<EmailProviderResolver['resolve']>>,
    catalogEbook: CatalogEbookSelection,
    user: RequestUser,
  ) {
    await this.warehouseCatalog.assertUserCanAccessEbook(user, catalogEbook.remoteId);
    const item = await this.warehouseCatalog.getEbook(catalogEbook.remoteId);
    if (!item) throw new BadRequestException('Library item not available');
    const initialDownload = await this.warehouseCatalog.downloadEbook(user, catalogEbook.remoteId);
    const attachment = this.createCatalogEbookAttachment(user, catalogEbook.remoteId, initialDownload);
    const template = await this.templateService.resolveTemplate(task.effectiveTemplateId, user);
    const context = this.templateContextService.buildForCatalogEbook(item, initialDownload, user.name);
    const rendered = renderTemplate(template.subject, template.bodyText, context);
    const effectiveSubject = task.deviceType === 'kindle' ? KINDLE_CONVERT_SUBJECT : rendered.subject;

    const logEntry = await this.sendLogService.create({
      userId: user.id,
      bookId: null,
      bookFileId: null,
      catalogMediaType: 'ebook',
      catalogRemoteId: catalogEbook.remoteId,
      providerId: resolved.providerId,
      templateId: template.id,
      toEmail: task.recipientEmail,
      toName: task.recipientName,
      subject: effectiveSubject,
    });

    setImmediate(
      () =>
        void this.dispatchSend(
          logEntry.id,
          resolved.config,
          { ...task, catalogMediaType: 'ebook', catalogRemoteId: catalogEbook.remoteId },
          attachment,
          effectiveSubject,
          rendered.bodyText,
          0,
        ),
    );
  }

  private async resendCatalogEbook(logEntryId: number, logEntry: ResendLogEntry, user: RequestUser): Promise<{ queued: number }> {
    if (!logEntry.catalogRemoteId || !logEntry.toEmail) {
      throw new BadRequestException('Cannot resend: original book or recipient is missing');
    }

    await this.warehouseCatalog.assertUserCanAccessEbook(user, logEntry.catalogRemoteId);
    const item = await this.warehouseCatalog.getEbook(logEntry.catalogRemoteId);
    if (!item) throw new BadRequestException('Library item not available');
    const resolved = await this.providerResolver.resolve(user, logEntry.providerId ?? null);
    const initialDownload = await this.warehouseCatalog.downloadEbook(user, logEntry.catalogRemoteId);
    const attachment = this.createCatalogEbookAttachment(user, logEntry.catalogRemoteId, initialDownload);
    const template = await this.templateService.resolveTemplate(logEntry.templateId ?? null, user);
    const context = this.templateContextService.buildForCatalogEbook(item, initialDownload, user.name);
    const rendered = renderTemplate(template.subject, template.bodyText, context);
    const effectiveSubject = logEntry.subject === KINDLE_CONVERT_SUBJECT ? KINDLE_CONVERT_SUBJECT : rendered.subject;

    const newLog = await this.sendLogService.create({
      userId: user.id,
      bookId: null,
      bookFileId: null,
      catalogMediaType: 'ebook',
      catalogRemoteId: logEntry.catalogRemoteId,
      providerId: resolved.providerId,
      templateId: template.id,
      toEmail: logEntry.toEmail,
      toName: logEntry.toName ?? '',
      subject: effectiveSubject,
    });

    const task: SendTask = {
      bookId: null,
      userId: user.id,
      recipientId: 0,
      recipientEmail: logEntry.toEmail,
      recipientName: logEntry.toName ?? '',
      deviceType: logEntry.subject === KINDLE_CONVERT_SUBJECT ? 'kindle' : null,
      preferredFormat: null,
      effectiveTemplateId: logEntry.templateId ?? null,
      catalogMediaType: 'ebook',
      catalogRemoteId: logEntry.catalogRemoteId,
    };

    setImmediate(() => void this.dispatchSend(newLog.id, resolved.config, task, attachment, effectiveSubject, rendered.bodyText, 0));

    this.logger.log(`[${EMAIL_RESEND_EVENT}] [end] userId=${user.id} logEntryId=${logEntryId} queued=1 - source-backed resend enqueue completed`);
    return { queued: 1 };
  }

  private async dispatchSend(
    logId: number,
    smtpConfig: Awaited<ReturnType<EmailProviderResolver['resolve']>>['config'],
    task: SendTask,
    file: EmailAttachment,
    subject: string,
    bodyText: string,
    attemptCount: number,
  ) {
    try {
      const transporter = this.transportService.buildTransporter(smtpConfig);
      const effectiveSubject = task.deviceType === 'kindle' ? KINDLE_CONVERT_SUBJECT : subject;
      const from = this.buildFromHeader(smtpConfig.fromName, smtpConfig.fromAddress);

      const attachment = await this.resolveAttachment(file);

      await transporter.sendMail({
        ...(from ? { from } : {}),
        to: task.recipientEmail,
        subject: effectiveSubject,
        text: bodyText,
        attachments: [attachment],
      });

      await this.sendLogService.markSent(logId);

      this.notificationService
        .notify({
          type: NotificationType.EmailSent,
          title: 'Email sent successfully',
          message: `Sent to ${task.recipientEmail}`,
          scope: { kind: 'user', userId: task.userId },
          meta: { logId, bookId: task.bookId, recipientEmail: task.recipientEmail },
        })
        .catch(() => {});
    } catch (error) {
      const errorClass = this.getErrorClass(error);
      const errorMessage = this.getErrorMessage(error);
      const attempt = attemptCount + 1;

      const { isFinal } = await this.sendLogService.markFailed(logId, errorMessage, attemptCount);

      if (!isFinal) {
        const delayMs = SEND_RETRY_DELAYS_MS[attemptCount] ?? 0;
        this.logger.warn(
          `[${EMAIL_DISPATCH_EVENT}] [fail] logId=${logId} attempt=${attempt} willRetry=true retryDelayMs=${delayMs} errorClass=${errorClass} error="${errorMessage}" - dispatch failed`,
        );
        const retryTimer = setTimeout(() => void this.dispatchSend(logId, smtpConfig, task, file, subject, bodyText, attemptCount + 1), delayMs);
        if (typeof retryTimer.unref === 'function') {
          retryTimer.unref();
        }
      } else {
        this.logger.error(
          `[${EMAIL_DISPATCH_EVENT}] [fail] logId=${logId} toEmail=${task.recipientEmail} attempt=${attempt} willRetry=false errorClass=${errorClass} error="${errorMessage}" - dispatch failed`,
        );

        this.notificationService
          .notify({
            type: NotificationType.EmailFailed,
            title: 'Email delivery failed',
            message: `Failed to send to ${task.recipientEmail}`,
            scope: { kind: 'user', userId: task.userId },
            meta: { logId, bookId: task.bookId, recipientEmail: task.recipientEmail },
          })
          .catch(() => {});
      }
    }
  }

  private resolveCatalogEbookSelections(dto: SendBookDto): CatalogEbookSelection[] {
    const catalogEbooks = (dto as SendBookDto & { catalogEbooks?: unknown }).catalogEbooks;
    if (!Array.isArray(catalogEbooks)) return [];
    const seen = new Set<string>();
    const selections: CatalogEbookSelection[] = [];
    for (const item of catalogEbooks) {
      const remoteId = typeof (item as { remoteId?: unknown })?.remoteId === 'string' ? (item as { remoteId: string }).remoteId.trim() : '';
      if (!remoteId || seen.has(remoteId)) continue;
      seen.add(remoteId);
      selections.push({ remoteId });
    }
    return selections;
  }

  private createCatalogEbookAttachment(user: RequestUser, remoteId: string, initialDownload?: CatalogDownload): CatalogAttachment {
    let queuedInitialDownload = initialDownload ?? null;
    return {
      kind: 'catalog',
      fallbackFilename: `${remoteId}.epub`,
      load: async () => {
        if (queuedInitialDownload) {
          const download = queuedInitialDownload;
          queuedInitialDownload = null;
          return download;
        }
        return this.warehouseCatalog.downloadEbook(user, remoteId);
      },
    };
  }

  private async resolveAttachment(file: EmailAttachment): Promise<MailAttachment> {
    if (this.isCatalogAttachment(file)) {
      const download = await file.load();
      return {
        filename: download.fileName ?? file.fallbackFilename,
        content: download.body,
      };
    }

    return {
      filename: this.buildAttachmentFilename(file),
      content: createReadStream(file.absolutePath),
    };
  }

  private isCatalogAttachment(file: EmailAttachment): file is CatalogAttachment {
    return (file as CatalogAttachment).kind === 'catalog';
  }

  private buildAttachmentFilename(file: BookFile): string {
    const ext = file.format ? `.${file.format.toLowerCase()}` : '';
    const base = file.relPath
      ? (file.relPath
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'book')
      : 'book';
    return `${base}${ext}`;
  }

  private buildFromHeader(fromName: string | null | undefined, fromAddress: string | null | undefined): string | undefined {
    const normalizedAddress = fromAddress?.trim();
    if (!normalizedAddress) return undefined;

    const normalizedName = fromName?.trim();
    if (!normalizedName) return normalizedAddress;

    return `${normalizedName} <${normalizedAddress}>`;
  }

  private getErrorClass(error: unknown): string {
    if (error instanceof Error && error.name) return error.name;
    return 'Error';
  }

  private getErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw
      .replace(/[\r\n"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
