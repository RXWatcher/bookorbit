import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, ValidateNested, ArrayUnique } from 'class-validator';
import { BOOK_METADATA_LOCK_FIELDS, type BookMetadataLockField } from '@bookorbit/types';

import { UpdateBookMetadataDto } from './update-book-metadata.dto';

export class UpdateBookMetadataAndLocksDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBookMetadataDto)
  metadata?: UpdateBookMetadataDto;

  @IsArray()
  @ArrayUnique()
  @IsIn(BOOK_METADATA_LOCK_FIELDS, { each: true })
  lockedFields!: BookMetadataLockField[];
}
