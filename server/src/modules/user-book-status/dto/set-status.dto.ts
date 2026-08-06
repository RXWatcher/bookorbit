import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { ReadStatus } from '@bookorbit/types';
import { READ_STATUSES } from '../user-book-status.constants';

export class SetStatusDto {
  @IsOptional()
  @IsIn(READ_STATUSES)
  status?: ReadStatus;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$|^\d{4}-\d{2}-\d{2}T.+$/)
  startedAt?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$|^\d{4}-\d{2}-\d{2}T.+$/)
  finishedAt?: string | null;
}
