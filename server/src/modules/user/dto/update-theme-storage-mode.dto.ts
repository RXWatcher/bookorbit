import { IsBoolean } from 'class-validator';

export class UpdateThemeStorageModeDto {
  @IsBoolean()
  sync!: boolean;
}
