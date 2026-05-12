import { IsObject } from 'class-validator';

/** Kalitlar: `STARTER`, `BRONZE`, … — har bir tier uchun bonus (so‘m). */
export class PatchDriverXpSettingsDto {
  @IsObject()
  tierBonusesUzs!: Record<string, unknown>;
}
