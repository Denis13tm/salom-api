-- Admin override table for monthly leaderboard testing/corrections
CREATE TABLE IF NOT EXISTS "DriverLeaderboardOverride" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "driverId" uuid NOT NULL,
  "periodYm" varchar(7) NOT NULL,
  "score" integer NOT NULL,
  "trips" integer NOT NULL,
  "updatedByUserId" uuid NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverLeaderboardOverride_driverId_periodYm_key"
  ON "DriverLeaderboardOverride" ("driverId", "periodYm");

CREATE INDEX IF NOT EXISTS "DriverLeaderboardOverride_periodYm_idx"
  ON "DriverLeaderboardOverride" ("periodYm");

ALTER TABLE "DriverLeaderboardOverride"
  ADD CONSTRAINT "DriverLeaderboardOverride_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep updatedAt fresh
CREATE OR REPLACE FUNCTION set_updated_at_driver_leaderboard_override()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at_driver_leaderboard_override ON "DriverLeaderboardOverride";
CREATE TRIGGER trg_set_updated_at_driver_leaderboard_override
BEFORE UPDATE ON "DriverLeaderboardOverride"
FOR EACH ROW EXECUTE PROCEDURE set_updated_at_driver_leaderboard_override();

