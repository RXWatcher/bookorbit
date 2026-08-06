import { IsDateString } from 'class-validator';

export class UpdateBookReadingSessionDto {
  @IsDateString()
  startedAt!: string;

  @IsDateString()
  endedAt!: string;
}
