import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { KoreaderModule } from '../koreader/koreader.module';
import { UserModule } from '../user/user.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsBookService } from './opds-book.service';
import { OpdsController } from './opds.controller';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsModule } from './opds.module';
import { OpdsService } from './opds.service';
import { OpdsUserController } from './opds-user.controller';
import { OpdsUserService } from './opds-user.service';

describe('OpdsModule', () => {
  it('registers expected module wiring', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, OpdsModule);
    expect(imports.slice(0, 5)).toEqual([AppSettingsModule, BookModule, UserModule, CommonModule, WarehouseModule]);
    expect(imports[5].forwardRef()).toBe(KoreaderModule);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OpdsModule)).toEqual([OpdsController, OpdsUserController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, OpdsModule)).toEqual([
      OpdsService,
      OpdsBookService,
      OpdsUserService,
      OpdsAuthGuard,
      OpdsEnabledGuard,
    ]);
  });
});
