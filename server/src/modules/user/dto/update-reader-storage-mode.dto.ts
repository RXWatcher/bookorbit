import { IsBoolean } from 'class-validator';

export class UpdateReaderStorageModeDto {
  @IsBoolean()
  sync!: boolean;
}
