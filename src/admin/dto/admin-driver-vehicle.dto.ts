import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class AdminCreateVehicleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  plate!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @Matches(/^\d{2}$/, { message: 'plateRegionCode 2 ta raqam (masalan 01 yoki 10)' })
  plateRegionCode?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  makeModel!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1980)
  @Max(2035)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string | null;
}

export class AdminPatchVehicleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  plate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @Matches(/^\d{2}$/, { message: 'plateRegionCode 2 ta raqam (masalan 01 yoki 10)' })
  plateRegionCode?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  makeModel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1980)
  @Max(2035)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
