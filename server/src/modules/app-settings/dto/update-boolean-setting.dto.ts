import { IsBoolean } from 'class-validator';

export class UpdateBooleanSettingDto {
  @IsBoolean()
  enabled: boolean;
}
