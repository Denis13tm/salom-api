import { IsString, MinLength, MaxLength } from "class-validator";

export class OtpRequestDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone!: string;
}
