import { IsNotEmptyObject, IsObject } from 'class-validator';

export class UpdateMeSettingsDto {
  @IsObject()
  @IsNotEmptyObject()
  settings!: Record<string, unknown>;
}
