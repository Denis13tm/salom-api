import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class PatchSmsTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  bodyUz?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
