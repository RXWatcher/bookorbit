import { readFile } from 'fs/promises';
import { parentPort, workerData } from 'worker_threads';

import { parsePdfBuffer, type PdfParseWarning } from './pdf-parser';
import type { PdfParseWorkerData, PdfParseWorkerMessage } from './pdf-parse-worker-runner';

async function run(): Promise<void> {
  if (!parentPort) {
    throw new Error('PDF parse worker requires a parent port');
  }

  const data = workerData as PdfParseWorkerData;
  const warnings: PdfParseWarning[] = [];

  try {
    const buffer = await readFile(data.absolutePath);
    const parsed = await parsePdfBuffer(data.absolutePath, buffer, {
      extractCover: data.extractCover,
      onWarning: (warning) => warnings.push(warning),
    });
    postMessage({ type: 'result', result: { parsed, warnings } });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    postMessage({
      type: 'error',
      errorClass: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
  }
}

function postMessage(message: PdfParseWorkerMessage): void {
  parentPort!.postMessage(message);
}

void run();
