import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CUSTOM_METADATA_FIELD_TYPES, type CustomMetadataFieldType } from '@bookorbit/types';

export class CreateCustomMetadataFieldDto {
  @IsString()
  @MaxLength(255)
  label!: string;

  @IsIn(CUSTOM_METADATA_FIELD_TYPES)
  type!: CustomMetadataFieldType;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  enabledLibraryIds?: number[];
}
