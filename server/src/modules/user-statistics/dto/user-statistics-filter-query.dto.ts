import { Transform } from 'class-transformer';
import { IsArray, IsInt, IsOptional } from 'class-validator';
import { transformLibraryIdsQueryValue } from '../../../common/utils/library-query-id-transform';

export class UserStatisticsFilterQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformLibraryIdsQueryValue(value))
  @IsArray()
  @IsInt({ each: true })
  libraryIds?: number[];
}
