import { MetadataProviderKey, Permission } from '@bookorbit/types';
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateProviderConfigDto } from './dto/update-provider-config.dto';
import { ProviderConfigService } from './provider-config.service';

const KNOWN_PROVIDER_KEYS = new Set<MetadataProviderKey>(Object.values(MetadataProviderKey));

function parseProviderKey(value: string): MetadataProviderKey {
  if (KNOWN_PROVIDER_KEYS.has(value as MetadataProviderKey)) return value as MetadataProviderKey;
  throw new BadRequestException(`Unknown provider key: ${value}`);
}

@Controller('metadata-preferences/providers')
@RequirePermission(Permission.ManageMetadataConfig)
export class ProviderConfigController {
  constructor(private readonly service: ProviderConfigService) {}

  @Get()
  async getConfig() {
    const config = await this.service.getConfig();
    const statuses = await this.service.getProviderStatuses(config);
    return { config, statuses };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() dto: UpdateProviderConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Post(':key/test')
  @HttpCode(HttpStatus.OK)
  testProvider(@Param('key') key: string, @Body() dto: UpdateProviderConfigDto = {}) {
    return this.service.testProvider(parseProviderKey(key), dto);
  }
}
