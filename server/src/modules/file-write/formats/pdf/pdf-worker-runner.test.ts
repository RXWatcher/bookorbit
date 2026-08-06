import { EventEmitter } from 'events';

import type { WriteResult } from '@bookorbit/types';
import type { PdfWorkerFactory, PdfWriteWorkerData } from './pdf-worker-runner';
import { writePdfMetadataInWorker } from './pdf-worker-runner';

describe('writePdfMetadataInWorker', () => {
  const workerData: PdfWriteWorkerData = {
    filePath: '/books/large.pdf',
    payload: { title: 'Dune' },
    fieldMask: ['title'],
  };

  function makeWorkerHarness() {
    const worker = new EventEmitter();
    const createWorker = vi.fn<PdfWorkerFactory>().mockReturnValue(worker as never);
    return { worker, createWorker };
  }

  it('resolves with the worker result message', async () => {
    const { worker, createWorker } = makeWorkerHarness();
    const result: WriteResult = { status: 'success', fieldsWritten: ['title'], durationMs: 50 };

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result });

    await expect(promise).resolves.toEqual(result);
    expect(createWorker).toHaveBeenCalledWith(workerData);
  });

  it('rejects with worker error messages and preserves the error class', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'error', errorClass: 'BadPdfError', errorMessage: 'bad pdf' });

    await expect(promise).rejects.toMatchObject({ name: 'BadPdfError', message: 'bad pdf' });
  });

  it('rejects invalid worker messages', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { nope: true });

    await expect(promise).rejects.toThrow('PDF write worker returned an invalid response');
  });

  it('rejects when the worker emits an error event', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('error', new Error('thread crashed'));

    await expect(promise).rejects.toThrow('thread crashed');
  });

  it('rejects when the worker exits non-zero before returning a result', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('exit', 1);

    await expect(promise).rejects.toThrow('PDF write worker exited with code 1');
  });

  it('ignores exit events after a result has settled the worker', async () => {
    const { worker, createWorker } = makeWorkerHarness();
    const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 12, reason: 'encrypted-pdf' };

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result });
    worker.emit('exit', 1);

    await expect(promise).resolves.toEqual(result);
  });
});
