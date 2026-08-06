import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ListMetadataProvidersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bookId?: number;
}
