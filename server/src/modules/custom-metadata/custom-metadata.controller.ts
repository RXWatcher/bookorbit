import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateCustomMetadataFieldDto } from './dto/create-custom-metadata-field.dto';
import { ReorderCustomMetadataFieldsDto } from './dto/reorder-custom-metadata-fields.dto';
import { UpdateCustomMetadataFieldDto } from './dto/update-custom-metadata-field.dto';
import { CustomMetadataService } from './custom-metadata.service';

@Controller('custom-metadata')
export class CustomMetadataController {
  constructor(private readonly service: CustomMetadataService) {}

  @Get('fields/active')
  listActiveFields() {
    return this.service.listFieldSummaries();
  }

  @Get('fields')
  @RequirePermission(Permission.ManageLibraries)
  listFields(@Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe) includeArchived: boolean) {
    return this.service.listFields(includeArchived);
  }

  @Post('fields')
  @RequirePermission(Permission.ManageLibraries)
  createField(@Body() dto: CreateCustomMetadataFieldDto) {
    return this.service.createField(dto);
  }

  @Patch('fields/reorder')
  @RequirePermission(Permission.ManageLibraries)
  reorderFields(@Body() dto: ReorderCustomMetadataFieldsDto) {
    return this.service.reorderFields(dto.orderedIds);
  }

  @Patch('fields/:id')
  @RequirePermission(Permission.ManageLibraries)
  updateField(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomMetadataFieldDto) {
    return this.service.updateField(id, dto);
  }

  @Delete('fields/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageLibraries)
  archiveField(@Param('id', ParseIntPipe) id: number) {
    return this.service.archiveField(id);
  }

  @Post('fields/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageLibraries)
  restoreField(@Param('id', ParseIntPipe) id: number) {
    return this.service.restoreField(id);
  }

  @Delete('fields/:id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageLibraries)
  deleteFieldPermanently(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteField(id);
  }
}
