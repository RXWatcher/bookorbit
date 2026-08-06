import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailFileSelector } from './email-file-selector';
import { EmailRecipientService } from './email-recipient.service';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplateContextService } from './email-template-context.service';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailSendLogService } from './email-send-log.service';
import { EmailTransportService } from './email-transport.service';
import { EmailBookAccessService } from './email-book-access.service';
import { NotificationService } from '../notification/notification.service';
import { BookService } from '../book/book.service';
import type { RequestUser } from '../../common/types/request-user';
import type { SendBookDto } from './dto/send-book.dto';
import * as fs from 'fs';
import { Readable } from 'stream';
import { KINDLE_CONVERT_SUBJECT } from './email-send.constants';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';

vi.mock('fs');

describe('EmailSendOrchestrator', () => {
  let orchestrator: EmailSendOrchestrator;
  let providerResolver: EmailProviderResolver;
  let recipientService: EmailRecipientService;
  let groupService: EmailRecipientGroupService;
  let preferencesService: EmailPreferencesService;
  let sendLogService: EmailSendLogService;
  let transportService: EmailTransportService;
  let bookAccessService: EmailBookAccessService;
  let bookService: BookService;
  let templateService: EmailTemplateService;
  let warehouseCatalogService: WarehouseCatalogService;

  const mockUser: RequestUser = {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    isSuperuser: false,
    permissions: [],

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };

  const mockRecipient = {
    id: 10,
    email: 'recipient@test.com',
    name: 'Recipient',
    deviceType: 'kindle',
    preferredFormat: 'mobi',
    defaultTemplateId: null,
  };
  const mockFile = { id: 100, absolutePath: '/path/to/book.mobi', format: 'MOBI', relPath: 'Books/book.mobi' };
  const mockTemplate = { id: 200, subject: 'Subject {{title}}', bodyText: 'Body' };
  const mockProvider = {
    config: { host: 'smtp.test.com', fromName: 'BookOrbit Bot', fromAddress: 'bot@example.com' },
    providerId: 300,
  };
  const mockLogEntry = { id: 400 };

  beforeEach(async () => {
    // Avoid background tasks running in tests where we don't expect them
    vi.spyOn(global, 'setImmediate').mockImplementation((fn: any) => fn() as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSendOrchestrator,
        {
          provide: BookService,
          useValue: {
            resolveSelectionToIds: vi.fn().mockImplementation((dto: SendBookDto) => Promise.resolve(dto.bookIds ?? [])),
          },
        },
        {
          provide: EmailProviderResolver,
          useValue: { resolve: vi.fn().mockResolvedValue(mockProvider) },
        },
        {
          provide: EmailFileSelector,
          useValue: { select: vi.fn().mockResolvedValue(mockFile) },
        },
        {
          provide: EmailRecipientService,
          useValue: {
            getOwnedById: vi.fn().mockResolvedValue(mockRecipient),
            getOwnedByIds: vi.fn().mockResolvedValue([mockRecipient]),
          },
        },
        {
          provide: EmailRecipientGroupService,
          useValue: { expandOwnedGroupToRecipientIds: vi.fn().mockResolvedValue([10]) },
        },
        {
          provide: EmailTemplateService,
          useValue: { resolveTemplate: vi.fn().mockResolvedValue(mockTemplate) },
        },
        {
          provide: EmailTemplateContextService,
          useValue: {
            buildForBook: vi.fn().mockResolvedValue({ title: 'Book Title' }),
            buildForCatalogEbook: vi.fn().mockReturnValue({ title: 'Cloud Book' }),
          },
        },
        {
          provide: EmailPreferencesService,
          useValue: { getForUser: vi.fn() },
        },
        {
          provide: EmailSendLogService,
          useValue: {
            create: vi.fn().mockResolvedValue(mockLogEntry),
            markSent: vi.fn().mockResolvedValue(mockLogEntry),
            markFailed: vi.fn().mockResolvedValue({ isFinal: true }),
            getForResend: vi.fn(),
          },
        },
        {
          provide: EmailTransportService,
          useValue: { buildTransporter: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue({}) }) },
        },
        {
          provide: EmailBookAccessService,
          useValue: {
            assertUserCanAccessBook: vi.fn().mockResolvedValue(undefined),
            assertUserCanAccessBooks: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationService,
          useValue: { notify: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WarehouseCatalogService,
          useValue: {
            assertUserCanAccessEbook: vi.fn().mockResolvedValue(undefined),
            downloadEbook: vi.fn().mockResolvedValue({
              status: 200,
              contentType: 'application/epub+zip',
              contentLength: 1024,
              body: Buffer.from('epub bytes'),
              fileName: 'Cloud Book.epub',
            }),
            getEbook: vi.fn().mockResolvedValue({
              remoteId: 'ebook-1',
              title: 'Cloud Book',
              subtitle: 'Skybound',
              authors: ['Ada Author'],
              series: 'Cloud Series',
              seriesIndex: 2,
              publisher: 'Orbit Press',
              language: 'en',
              format: 'epub',
              identifiers: { isbn13: '9780000000001' },
              tags: ['sci-fi'],
            }),
          },
        },
      ],
    }).compile();

    orchestrator = module.get<EmailSendOrchestrator>(EmailSendOrchestrator);
    providerResolver = module.get<EmailProviderResolver>(EmailProviderResolver);
    recipientService = module.get<EmailRecipientService>(EmailRecipientService);
    groupService = module.get<EmailRecipientGroupService>(EmailRecipientGroupService);
    preferencesService = module.get<EmailPreferencesService>(EmailPreferencesService);
    sendLogService = module.get<EmailSendLogService>(EmailSendLogService);
    transportService = module.get<EmailTransportService>(EmailTransportService);
    bookAccessService = module.get<EmailBookAccessService>(EmailBookAccessService);
    bookService = module.get<BookService>(BookService);
    templateService = module.get<EmailTemplateService>(EmailTemplateService);
    warehouseCatalogService = module.get<WarehouseCatalogService>(WarehouseCatalogService);

    (fs.createReadStream as vi.Mock).mockReturnValue('mock-stream');
  });

  describe('send', () => {
    it('should queue emails for recipients', async () => {
      const dto: SendBookDto = { bookIds: [1], recipientIds: [10], providerId: 300 };
      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(1);
      expect(providerResolver.resolve).toHaveBeenCalledWith(mockUser, 300);
      expect(sendLogService.create).toHaveBeenCalled();
      expect(bookAccessService.assertUserCanAccessBooks).toHaveBeenCalledWith([1], mockUser);
      expect(recipientService.getOwnedByIds).toHaveBeenCalledWith([10], mockUser);
    });

    it('should resolve query selections and queue every matching book', async () => {
      const dto: SendBookDto = { query: { libraryId: 5, q: 'dune' }, recipientIds: [10], providerId: 300 };
      (bookService.resolveSelectionToIds as vi.Mock).mockResolvedValue([1, 2, 2]);

      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(2);
      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(dto, mockUser);
      expect(bookAccessService.assertUserCanAccessBooks).toHaveBeenCalledWith([1, 2], mockUser);
      expect(sendLogService.create).toHaveBeenCalledTimes(2);
      expect(sendLogService.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ bookId: 1 }));
      expect(sendLogService.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ bookId: 2 }));
    });

    it('should expand groups and queue emails', async () => {
      const dto: SendBookDto = { bookIds: [1], groupIds: [5] };
      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(1);
      expect(groupService.expandOwnedGroupToRecipientIds).toHaveBeenCalledWith(5, mockUser);
      expect(recipientService.getOwnedByIds).toHaveBeenCalledWith([10], mockUser);
    });

    it('should throw BadRequestException if no recipients', async () => {
      const dto: SendBookDto = { bookIds: [1], recipientIds: [], groupIds: [] };
      await expect(orchestrator.send(dto, mockUser)).rejects.toThrow(BadRequestException);
    });

    it('should fail if user cannot access requested books', async () => {
      (bookAccessService.assertUserCanAccessBooks as vi.Mock).mockRejectedValue(new Error('No access to this library'));
      const dto: SendBookDto = { bookIds: [1], recipientIds: [10] };
      await expect(orchestrator.send(dto, mockUser)).rejects.toThrow('No access to this library');
    });

    it('should prefer explicit templateId over recipient default template', async () => {
      (recipientService.getOwnedByIds as vi.Mock).mockResolvedValue([{ ...mockRecipient, defaultTemplateId: 999 }]);

      await orchestrator.send(
        {
          bookIds: [1],
          recipientIds: [10],
          templateId: 123,
        },
        mockUser,
      );

      expect(templateService.resolveTemplate).toHaveBeenCalledWith(123, mockUser);
    });

    it('should fall back to user preference defaultTemplateId when recipient and request templates are missing', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue({ defaultTemplateId: 777 });
      (recipientService.getOwnedByIds as vi.Mock).mockResolvedValue([{ ...mockRecipient, defaultTemplateId: null }]);

      await orchestrator.send(
        {
          bookIds: [1],
          recipientIds: [10],
        },
        mockUser,
      );

      expect(templateService.resolveTemplate).toHaveBeenCalledWith(777, mockUser);
    });

    it('queues source-backed ebook refs without treating remote ids as local book ids', async () => {
      const result = await orchestrator.send(
        {
          catalogEbooks: [{ remoteId: 'ebook-1' }],
          recipientIds: [10],
          providerId: 300,
        } as never,
        mockUser,
      );

      expect(result.queued).toBe(1);
      expect(bookAccessService.assertUserCanAccessBooks).not.toHaveBeenCalled();
      expect(warehouseCatalogService.downloadEbook).toHaveBeenCalledWith(mockUser, 'ebook-1');
      expect(sendLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          bookId: null,
          bookFileId: null,
          catalogMediaType: 'ebook',
          catalogRemoteId: 'ebook-1',
          toEmail: mockRecipient.email,
          subject: KINDLE_CONVERT_SUBJECT,
        }),
      );
      expect(transportService.buildTransporter().sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: 'Cloud Book.epub',
              content: Buffer.from('epub bytes'),
            }),
          ],
        }),
      );
    });
  });

  describe('quickSend', () => {
    it('should use default recipient from preferences', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue({ defaultRecipientId: 10 });

      const result = await orchestrator.quickSend(1, mockUser);

      expect(result.queued).toBe(1);
      expect(bookAccessService.assertUserCanAccessBook).toHaveBeenCalledWith(1, mockUser);
      expect(recipientService.getOwnedById).toHaveBeenCalledWith(10, mockUser);
    });

    it('should throw if no default recipient', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue(null);
      await expect(orchestrator.quickSend(1, mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resend', () => {
    it('should queue a resend of an existing log entry', async () => {
      const existingLog = {
        userId: mockUser.id,
        bookId: 1,
        bookFileId: 100,
        catalogMediaType: null,
        catalogRemoteId: null,
        providerId: 300,
        templateId: 200,
        toEmail: 'resend@test.com',
        toName: 'Resend',
        subject: 'Original Subject',
      };
      (sendLogService.getForResend as vi.Mock).mockResolvedValue(existingLog);

      const result = await orchestrator.resend(400, mockUser);

      expect(result.queued).toBe(1);
      expect(bookAccessService.assertUserCanAccessBook).toHaveBeenCalledWith(1, mockUser);
      expect(sendLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toEmail: 'resend@test.com',
        }),
      );
    });

    it('should queue a resend of a source-backed ebook log entry', async () => {
      const existingLog = {
        userId: mockUser.id,
        bookId: null,
        bookFileId: null,
        catalogMediaType: 'ebook',
        catalogRemoteId: 'ebook-1',
        providerId: 300,
        templateId: 200,
        toEmail: 'cloud-resend@test.com',
        toName: 'Cloud Resend',
        subject: 'Original Cloud Subject',
      };
      (sendLogService.getForResend as vi.Mock).mockResolvedValue(existingLog);

      const result = await orchestrator.resend(400, mockUser);

      expect(result.queued).toBe(1);
      expect(bookAccessService.assertUserCanAccessBook).not.toHaveBeenCalled();
      expect(warehouseCatalogService.assertUserCanAccessEbook).toHaveBeenCalledWith(mockUser, 'ebook-1');
      expect(warehouseCatalogService.getEbook).toHaveBeenCalledWith('ebook-1');
      expect(sendLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          bookId: null,
          bookFileId: null,
          catalogMediaType: 'ebook',
          catalogRemoteId: 'ebook-1',
          toEmail: 'cloud-resend@test.com',
          toName: 'Cloud Resend',
          subject: 'Subject Cloud Book',
        }),
      );
      expect(warehouseCatalogService.downloadEbook).toHaveBeenCalledWith(mockUser, 'ebook-1');
      await vi.waitFor(() => {
        expect(transportService.buildTransporter().sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'cloud-resend@test.com',
            attachments: [
              expect.objectContaining({
                filename: 'Cloud Book.epub',
                content: Buffer.from('epub bytes'),
              }),
            ],
          }),
        );
      });
    });

    it('should not queue a source-backed resend when the ebook is no longer accessible', async () => {
      const existingLog = {
        userId: mockUser.id,
        bookId: null,
        bookFileId: null,
        catalogMediaType: 'ebook',
        catalogRemoteId: 'ebook-1',
        providerId: 300,
        templateId: 200,
        toEmail: 'cloud-resend@test.com',
        toName: 'Cloud Resend',
        subject: 'Original Cloud Subject',
      };
      const accessError = new Error('Library item not available');
      (sendLogService.getForResend as vi.Mock).mockResolvedValue(existingLog);
      (warehouseCatalogService.assertUserCanAccessEbook as vi.Mock).mockRejectedValue(accessError);

      await expect(orchestrator.resend(400, mockUser)).rejects.toThrow(accessError);

      expect(sendLogService.create).not.toHaveBeenCalled();
      expect(warehouseCatalogService.downloadEbook).not.toHaveBeenCalled();
    });
  });

  describe('dispatchSend', () => {
    let mockTransporter: { sendMail: vi.Mock };

    beforeEach(() => {
      mockTransporter = { sendMail: vi.fn().mockResolvedValue({ messageId: '123' }) };
      (transportService.buildTransporter as vi.Mock).mockReturnValue(mockTransporter);
    });

    it('should send email and mark log as sent', async () => {
      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@test.com',
          subject: 'Subject',
          text: 'Body',
        }),
      );
      expect(sendLogService.markSent).toHaveBeenCalledWith(400);
    });

    it('should retry on failure', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error'));
      (sendLogService.markFailed as vi.Mock).mockResolvedValue({ isFinal: false });

      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(sendLogService.markFailed).toHaveBeenCalledWith(400, 'SMTP Error', 0);
      expect(setTimeout).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should reload source-backed attachment streams for retry attempts', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error')).mockResolvedValueOnce({ messageId: 'retry-ok' });
      (sendLogService.markFailed as vi.Mock).mockResolvedValue({ isFinal: false });
      const firstStream = Readable.from(['first attempt']);
      const retryStream = Readable.from(['retry attempt']);
      const load = vi
        .fn()
        .mockResolvedValueOnce({ fileName: 'cloud.epub', contentLength: null, contentType: 'application/epub+zip', body: firstStream })
        .mockResolvedValueOnce({ fileName: 'cloud.epub', contentLength: null, contentType: 'application/epub+zip', body: retryStream });
      const task = { recipientEmail: 'test@test.com', userId: 1 } as any;
      const attachment = { kind: 'catalog', fallbackFilename: 'cloud.epub', load };

      await (orchestrator as any).dispatchSend(400, {}, task, attachment, 'Subject', 'Body', 0);
      await vi.runOnlyPendingTimersAsync();

      expect(load).toHaveBeenCalledTimes(2);
      expect(mockTransporter.sendMail).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          attachments: [expect.objectContaining({ content: firstStream })],
        }),
      );
      expect(mockTransporter.sendMail).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          attachments: [expect.objectContaining({ content: retryStream })],
        }),
      );
      vi.useRealTimers();
    });

    it('should set subject to "convert" if task deviceType is kindle', async () => {
      const task = { recipientEmail: 'test@test.com', deviceType: 'kindle' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Original', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: KINDLE_CONVERT_SUBJECT,
        }),
      );
    });

    it('should include from header when provider sender fields are configured', async () => {
      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, { fromName: 'BookOrbit Bot', fromAddress: 'bot@example.com' }, task, file, 'Subject', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'BookOrbit Bot <bot@example.com>',
        }),
      );
    });

    it('should use "convert" subject in resend if original was "convert"', async () => {
      const existingLog = {
        userId: mockUser.id,
        bookId: 1,
        bookFileId: 100,
        providerId: 300,
        templateId: 200,
        toEmail: 'resend@test.com',
        toName: 'Resend',
        subject: KINDLE_CONVERT_SUBJECT,
      };
      (sendLogService.getForResend as vi.Mock).mockResolvedValue(existingLog);

      await orchestrator.resend(400, mockUser);

      expect(sendLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: KINDLE_CONVERT_SUBJECT,
        }),
      );
    });

    it('should not retry if isFinal is true', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error'));
      (sendLogService.markFailed as vi.Mock).mockResolvedValue({ isFinal: true });

      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(sendLogService.markFailed).toHaveBeenCalledWith(400, 'SMTP Error', 0);
      expect(setTimeout).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('buildAttachmentFilename', () => {
    it('should build filename from relPath and format', () => {
      const file = { relPath: 'Library/Author/Book.epub', format: 'EPUB' } as any;
      const filename = (orchestrator as any).buildAttachmentFilename(file);
      expect(filename).toBe('Book.epub');
    });

    it('should use "book" if relPath is missing', () => {
      const file = { relPath: null, format: 'PDF' } as any;
      const filename = (orchestrator as any).buildAttachmentFilename(file);
      expect(filename).toBe('book.pdf');
    });

    it('should handle missing format', () => {
      const file = { relPath: 'some/book', format: null } as any;
      const filename = (orchestrator as any).buildAttachmentFilename(file);
      expect(filename).toBe('book');
    });
  });
});
