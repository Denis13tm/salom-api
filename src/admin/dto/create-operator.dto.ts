import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { UserAccountStatus } from '@prisma/client';

export class CreateOperatorDto {
  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsUUID()
  serviceZoneId?: string | null;

  @IsOptional()
  @IsEnum(UserAccountStatus)
  status?: UserAccountStatus;

  /** Operator web panel: kamida 8 belgi (bcrypt). */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
