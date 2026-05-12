import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDriverDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;
}
