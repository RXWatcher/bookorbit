import { Allow, IsInt, Min } from 'class-validator';

export class CustomMetadataValueDto {
  @IsInt()
  @Min(1)
  fieldId!: number;

  @Allow()
  value!: unknown;
}
