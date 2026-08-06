import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import type { WarehouseMediaType, WarehouseRequestStatus } from '@bookorbit/types';

const WAREHOUSE_REQUEST_STATUSES: WarehouseRequestStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'unknown'];
const WAREHOUSE_REQUEST_MEDIA_TYPES: WarehouseMediaType[] = ['ebook', 'audiobook', 'comic'];

@ValidatorConstraint({ name: 'HasEbookRequestTarget', async: false })
class HasEbookRequestTargetConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as SubmitWarehouseEbookRequestDto;
    return hasNonEmptyString(dto.isbn) || hasSearchResultTarget(dto.searchResult);
  }

  defaultMessage(): string {
    return 'Either isbn or searchResult is required.';
  }
}

@ValidatorConstraint({ name: 'IsOptionalSearchResultTarget', async: false })
class IsOptionalSearchResultTargetConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return value === undefined || hasSearchResultTarget(value);
  }

  defaultMessage(): string {
    return 'searchResult must include a title or ISBN.';
  }
}

export class SubmitWarehouseEbookRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  isbn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  preferredFormat?: string;

  @Validate(HasEbookRequestTargetConstraint)
  @Validate(IsOptionalSearchResultTargetConstraint)
  searchResult?: Record<string, unknown>;
}

export class SubmitWarehouseAudiobookRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  title!: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  author?: string;
}

export class SubmitWarehouseComicRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  seriesTitle!: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  issueNumber?: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  publisher?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1800)
  @Max(3000)
  year?: number;
}

export class ListWarehouseRequestsDto {
  @IsOptional()
  @IsIn(WAREHOUSE_REQUEST_MEDIA_TYPES)
  mediaType?: WarehouseMediaType;

  @IsOptional()
  @IsIn(WAREHOUSE_REQUEST_STATUSES)
  status?: WarehouseRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSearchResultTarget(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }

  return hasNonEmptyString(value.title) || hasNonEmptyString(value.isbn) || hasNonEmptyString(value.isbn13) || hasNonEmptyString(value.isbn_13);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
