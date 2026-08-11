import { Logger } from '@nestjs/common';

import { SearchIndexDrainJob } from './search-index-drain.job';

function makeJob(enabled = true) {
  const indexer = { drain: vi.fn().mockResolvedValue({ applied: 0, failed: 0 }) };
  const settings = {
    get: vi.fn().mockResolvedValue({ enabled, url: 'http://m:7700', activeIndex: 'books', hasApiKey: true }),
  };
  return { job: new SearchIndexDrainJob(indexer as never, settings as never), indexer, settings };
}

describe('SearchIndexDrainJob', () => {
  it('drains the outbox when the integration is enabled', async () => {
    const { job, indexer } = makeJob();

    await job.runDrain();

    expect(indexer.drain).toHaveBeenCalledTimes(1);
  });

  it('does not drain when the integration is disabled', async () => {
    const { job, indexer } = makeJob(false);

    await job.runDrain();

    expect(indexer.drain).not.toHaveBeenCalled();
  });

  it('does not start a second run while the first is still in flight', async () => {
    const { job, indexer } = makeJob();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    indexer.drain.mockImplementation(async () => {
      await gate;
      return { applied: 0, failed: 0 };
    });

    const first = job.runDrain();
    const second = job.runDrain();
    release();
    await Promise.all([first, second]);

    expect(indexer.drain).toHaveBeenCalledTimes(1);
  });

  it('runs again on the next tick once the previous run finished', async () => {
    const { job, indexer } = makeJob();

    await job.runDrain();
    await job.runDrain();

    expect(indexer.drain).toHaveBeenCalledTimes(2);
  });

  it('keeps draining while batches come back full', async () => {
    const { job, indexer } = makeJob();
    indexer.drain.mockResolvedValueOnce({ applied: 500, failed: 0 }).mockResolvedValueOnce({ applied: 12, failed: 0 });

    await job.runDrain();

    expect(indexer.drain).toHaveBeenCalledTimes(2);
  });

  it('logs a drain failure and clears the in-flight flag rather than throwing', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { job, indexer } = makeJob();
    indexer.drain.mockRejectedValue(new Error('meili down'));

    await expect(job.runDrain()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[search_index\.drain_job\] \[fail\] durationMs=\d+ errorClass=Error error="meili down" - /),
    );

    indexer.drain.mockResolvedValue({ applied: 0, failed: 0 });
    await job.runDrain();
    expect(indexer.drain).toHaveBeenCalledTimes(2);

    errorSpy.mockRestore();
  });
});
