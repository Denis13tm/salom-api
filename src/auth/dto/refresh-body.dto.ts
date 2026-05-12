import { IsString, MinLength } from "class-validator";

export class RefreshBodyDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
