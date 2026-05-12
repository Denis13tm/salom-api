import { IsString, IsUUID, Length, MinLength, MaxLength } from 'class-validator';

export class OtpVerifyDto {
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @Length(4, 8)
  code!: string;
}
