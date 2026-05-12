import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class TestSmsDto {
  @IsString()
  @MinLength(8)
  @MaxLength(24)
  toPhone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;
}
