import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminWebLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
