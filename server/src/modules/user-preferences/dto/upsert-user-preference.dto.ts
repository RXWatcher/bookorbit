import { IsNotEmptyObject, IsObject } from 'class-validator';

export class UpsertUserPreferenceDto {
  @IsObject()
  @IsNotEmptyObject()
  settings!: Record<string, unknown>;
}
