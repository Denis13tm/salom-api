import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { UserAccountStatus } from '@prisma/client';

export class UpdateOperatorDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsUUID()
  serviceZoneId?: string | null;

  @IsOptional()
  @IsEnum(UserAccountStatus)
  status?: UserAccountStatus;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
