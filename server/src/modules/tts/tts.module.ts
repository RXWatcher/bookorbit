import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { TtsAdminController } from './tts-admin.controller';
import { TtsAdminService } from './tts-admin.service';
import { TtsController } from './tts.controller';
import { TtsRepository } from './tts.repository';
import { TtsService } from './tts.service';
import { TtsSynthesisService } from './tts-synthesis.service';
import { TtsTextExtractorService } from './tts-text-extractor.service';
import { EdgeTtsProvider } from './providers/edge-tts.provider';
import { TtsProviderFactory } from './providers/tts-provider.factory';

@Module({
  imports: [AppSettingsModule, BookModule],
  controllers: [TtsController, TtsAdminController],
  providers: [TtsRepository, TtsService, TtsAdminService, TtsSynthesisService, TtsTextExtractorService, EdgeTtsProvider, TtsProviderFactory],
})
export class TtsModule {}
