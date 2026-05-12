-- Haydovchi XP: admin bonus (so'm) va haydovchi XP override
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "driverXpBonusUzs" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "DriverLifetimeXpOverride" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driverId" UUID NOT NULL,
    "xp" INTEGER NOT NULL,
    "baseComputedXp" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverLifetimeXpOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverLifetimeXpOverride_driverId_key" ON "DriverLifetimeXpOverride"("driverId");

DO $$
BEGIN
  ALTER TABLE "DriverLifetimeXpOverride" ADD CONSTRAINT "DriverLifetimeXpOverride_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
