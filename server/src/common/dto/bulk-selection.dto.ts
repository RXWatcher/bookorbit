import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsObject, IsOptional, IsString, Min, NotEquals, ValidateIf, ValidateNested } from 'class-validator';

import type { GroupRule, SortSpec } from '@bookorbit/types';
import { transformLibraryIdQueryValue } from '../utils/library-query-id-transform';

export class BulkQuerySelectionDto {
  @IsOptional()
  @Transform(({ value }) => transformLibraryIdQueryValue(value))
  @IsInt()
  @NotEquals(0)
  libraryId?: number;

  @IsOptional()
  @IsObject()
  filter?: GroupRule;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  sort?: SortSpec[];
}

/**
 * Selection DTO shared by bulk operations that can target either explicit book
 * IDs or the current "all matching books" query selection.
 */
export class BulkSelectionDto {
  @ValidateIf((dto: BulkSelectionDto) => !dto.query)
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  bookIds?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkQuerySelectionDto)
  query?: BulkQuerySelectionDto;
}
