-- Chempionlar: admin test uchun oy yakunini qo‘lda simulyatsiya qilish (YYYY-MM override)
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "championsPeriodYmOverride" VARCHAR(7);

