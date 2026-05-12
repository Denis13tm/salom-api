-- Chempionlar (haydovchi + admin) matn va sovrin — admin orqali boshqarish
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "championsSeasonTitleUz" VARCHAR(200);
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "championsPrizeDescriptionUz" TEXT;
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "championsCadenceHintUz" VARCHAR(800);
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "championsPrizeUsd" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "championsPeriodEndTemplateUz" VARCHAR(800);
