import { IsString, MinLength, MaxLength } from 'class-validator';

export class ActivateDriverCodeDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(20)
  activationCode!: string;
}
