import { IsString, MaxLength, MinLength } from 'class-validator';

export class OperatorPasswordLoginDto {
  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
