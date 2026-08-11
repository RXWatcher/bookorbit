import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

import { AppSettingsService } from '../../modules/app-settings/app-settings.service';

/**
 * Refuses any route that writes to library storage while the instance is in
 * read-only mode.
 *
 * This is deliberately a guard rather than a permission: superusers bypass
 * permission checks entirely, so a permission could never hide these routes
 * from an admin, which is exactly who runs a read-only instance.
 */
@Injectable()
export class LibraryWriteGuard implements CanActivate {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  async canActivate(): Promise<boolean> {
    if (await this.appSettingsService.isLibraryReadOnly()) {
      throw new ForbiddenException('This instance is read-only: manage files directly and re-scan the library');
    }
    return true;
  }
}
