import { IsString, MinLength } from 'class-validator';

export class LogoutBodyDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
