import { BookDockProcessingStateService } from './book-dock-processing-state.service';

function makeService() {
  const appSettings = {
    isBookDockPaused: vi.fn().mockResolvedValue(false),
    setBookDockPaused: vi.fn().mockResolvedValue(undefined),
    isLibraryReadOnly: vi.fn().mockResolvedValue(false),
  };
  const service = new BookDockProcessingStateService(appSettings as never);
  return { service, appSettings };
}

describe('BookDockProcessingStateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads persisted paused state once and exposes a cached value', async () => {
    const { service, appSettings } = makeService();
    appSettings.isBookDockPaused.mockResolvedValue(true);

    await expect(service.isPaused()).resolves.toBe(true);
    await expect(service.isPaused()).resolves.toBe(true);

    expect(appSettings.isBookDockPaused).toHaveBeenCalledTimes(1);
    expect(service.getCachedPaused()).toBe(true);
  });

  // The watcher ingests without an HTTP request, so the guard cannot reach it.
  it('reports paused on a read-only instance even when the dock is running', async () => {
    const { service, appSettings } = makeService();
    appSettings.isBookDockPaused.mockResolvedValue(false);
    appSettings.isLibraryReadOnly.mockResolvedValue(true);

    await expect(service.isPaused()).resolves.toBe(true);
  });

  it('picks up a read-only toggle without a restart', async () => {
    const { service, appSettings } = makeService();
    appSettings.isBookDockPaused.mockResolvedValue(false);

    await expect(service.isPaused()).resolves.toBe(false);
    appSettings.isLibraryReadOnly.mockResolvedValue(true);
    await expect(service.isPaused()).resolves.toBe(true);
  });

  it('persists pause and resume updates', async () => {
    const { service, appSettings } = makeService();

    await service.pause();
    expect(service.getCachedPaused()).toBe(true);
    expect(appSettings.setBookDockPaused).toHaveBeenCalledWith(true);

    await service.resume();
    expect(service.getCachedPaused()).toBe(false);
    expect(appSettings.setBookDockPaused).toHaveBeenCalledWith(false);
  });
});
