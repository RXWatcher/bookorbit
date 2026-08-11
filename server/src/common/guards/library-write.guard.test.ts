import { ForbiddenException } from '@nestjs/common';

import type { AppSettingsService } from '../../modules/app-settings/app-settings.service';
import { LibraryWriteGuard } from './library-write.guard';

function makeGuard(readOnly: boolean) {
  const appSettings = { isLibraryReadOnly: vi.fn().mockResolvedValue(readOnly) };
  return { guard: new LibraryWriteGuard(appSettings as unknown as AppSettingsService), appSettings };
}

describe('LibraryWriteGuard', () => {
  it('allows writes when the instance is not read-only', async () => {
    const { guard } = makeGuard(false);
    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('refuses writes when the instance is read-only', async () => {
    const { guard } = makeGuard(true);
    await expect(guard.canActivate()).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Superusers bypass permission checks, so read-only cannot be modelled as a
  // permission. The guard must refuse regardless of who is calling, which is
  // why it never looks at the request user at all.
  it('refuses without consulting the request', async () => {
    const { guard, appSettings } = makeGuard(true);
    await expect(guard.canActivate()).rejects.toThrow(/read-only/i);
    expect(appSettings.isLibraryReadOnly).toHaveBeenCalledTimes(1);
    expect(guard.canActivate.length).toBe(0);
  });
});
