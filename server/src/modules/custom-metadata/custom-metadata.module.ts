import { Module } from '@nestjs/common';

import { CustomMetadataController } from './custom-metadata.controller';
import { CustomMetadataRepository } from './custom-metadata.repository';
import { CustomMetadataService } from './custom-metadata.service';

@Module({
  controllers: [CustomMetadataController],
  providers: [CustomMetadataService, CustomMetadataRepository],
  exports: [CustomMetadataService, CustomMetadataRepository],
})
export class CustomMetadataModule {}
