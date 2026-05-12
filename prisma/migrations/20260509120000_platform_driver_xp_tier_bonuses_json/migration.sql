-- Per-tier XP screen bonuses (UZS). Legacy single column seeds JSON when missing.
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "driverXpTierBonusesUzsJson" JSONB;

UPDATE "PlatformSettings" AS ps
SET "driverXpTierBonusesUzsJson" = jsonb_build_object(
  'STARTER', ps."driverXpBonusUzs",
  'BRONZE', ps."driverXpBonusUzs",
  'SILVER', ps."driverXpBonusUzs",
  'GOLD', ps."driverXpBonusUzs",
  'PLATINUM', ps."driverXpBonusUzs",
  'DIAMOND', ps."driverXpBonusUzs"
)
WHERE ps."id" = 'default'
  AND ("driverXpTierBonusesUzsJson" IS NULL OR "driverXpTierBonusesUzsJson" = 'null'::jsonb);
