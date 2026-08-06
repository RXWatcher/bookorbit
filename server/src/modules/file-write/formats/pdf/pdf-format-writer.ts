import { Injectable } from '@nestjs/common';
import { stat } from 'fs/promises';

import type { WriteResult } from '@bookorbit/types';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../../interfaces/format-writer.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { resolvePdfFieldsWritten, writePdfMetadataInProcess } from './pdf-write-core';
import { writePdfMetadataInWorker } from './pdf-worker-runner';

export const PDF_WORKER_WRITE_THRESHOLD_BYTES = 25 * 1024 * 1024;

@Injectable()
export class PdfFormatWriter implements FormatWriter {
  readonly format = 'pdf';

  async write(filePath: string, payload: BookWritePayload, options: FormatWriteOptions): Promise<WriteResult> {
    const start = Date.now();
    const { fieldMask, dryRun } = options;
    const { fieldsWritten, pdfFieldMask } = resolvePdfFieldsWritten(payload, fieldMask);

    if (dryRun) {
      return { status: 'skipped', reason: 'dry-run', fieldsWritten, durationMs: Date.now() - start };
    }

    const fileStats = await stat(filePath);
    if (fileStats.size >= PDF_WORKER_WRITE_THRESHOLD_BYTES) {
      const result = await writePdfMetadataInWorker({
        filePath,
        payload,
        fieldMask: [...pdfFieldMask],
      });
      return { ...result, durationMs: Date.now() - start };
    }

    return writePdfMetadataInProcess(filePath, payload, pdfFieldMask, start);
  }
}
