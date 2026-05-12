-- DriverLeaderboardOverride: store base snapshot to keep future trips/cancels reactive
ALTER TABLE "DriverLeaderboardOverride" ADD COLUMN IF NOT EXISTS "baseTrips" INTEGER DEFAULT 0;
ALTER TABLE "DriverLeaderboardOverride" ADD COLUMN IF NOT EXISTS "baseCancels" INTEGER DEFAULT 0;

