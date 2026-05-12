-- Viloyat kodi, pasport seriya/raqam, platform komissiyasi (DB)

ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "passportSeries" VARCHAR(16);
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "passportNumber" VARCHAR(32);

ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "plateRegionCode" VARCHAR(4);

CREATE TABLE IF NOT EXISTS "PlatformSettings" (
    "id" VARCHAR(32) NOT NULL,
    "platformCommissionBps" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSettings" ("id", "platformCommissionBps")
SELECT 'default', 1000
WHERE NOT EXISTS (SELECT 1 FROM "PlatformSettings" WHERE "id" = 'default');
