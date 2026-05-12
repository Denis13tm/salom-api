-- Admin yangiliklar tarixi (haydovchi mobil ro'yxati)
CREATE TABLE "AdminNewsBroadcast" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "audience" VARCHAR(32) NOT NULL,
    "serviceZoneId" UUID,
    "targetDriverId" UUID,
    "targetedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminNewsBroadcast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminNewsBroadcast_createdAt_idx" ON "AdminNewsBroadcast" ("createdAt" DESC);
