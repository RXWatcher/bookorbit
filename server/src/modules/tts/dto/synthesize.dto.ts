import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SynthesizeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsString()
  @IsOptional()
  voiceId?: string;

  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsNumber()
  @Min(0.25)
  @Max(4)
  speed!: number;

  @IsOptional()
  @IsString()
  @IsIn(['mp3', 'opus', 'flac', 'wav', 'pcm'])
  format?: string;
}

export class PreviewVoiceDto {
  @IsString()
  @IsNotEmpty()
  voiceId!: string;

  @IsString()
  @IsNotEmpty()
  providerId!: string;
}
