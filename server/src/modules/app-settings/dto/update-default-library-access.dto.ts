import { ArrayUnique, IsArray, IsInt, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { Type } from 'class-transformer';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

const SOURCE_BACKED_LIBRARY_IDS = new Set([CLOUD_EBOOK_LIBRARY_ID, CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID]);

@ValidatorConstraint({ name: 'isDefaultLibraryId', async: false })
class IsDefaultLibraryIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'number' && Number.isInteger(value) && (value > 0 || SOURCE_BACKED_LIBRARY_IDS.has(value));
  }

  defaultMessage(): string {
    return 'each value in libraryIds must be a positive library ID or a source-backed library ID';
  }
}

export class UpdateDefaultLibraryAccessDto {
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Validate(IsDefaultLibraryIdConstraint, { each: true })
  libraryIds: number[] = [];
}
