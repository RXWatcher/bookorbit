import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [AppInfoController],
  providers: [AppInfoService],
})
export class AppInfoModule {}
