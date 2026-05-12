import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DriverSendChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsIn(['operator', 'admin'])
  channel?: 'operator' | 'admin';
}
