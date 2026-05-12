import { IsString, MinLength, MaxLength } from 'class-validator';

export class RejectDriverDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  reason!: string;
}
