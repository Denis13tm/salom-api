import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SetFcmTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  /** Bo‘sh yoki null — token o‘chirish. */
  fcmToken?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  /** Mobil qurilma identifikatori (nazorat, ixtiyoriy). */
  clientDeviceId?: string | null;
}
