-- Haydovchi yangilikni o‘qiganini saqlash (mobil badge)
CREATE TABLE "AdminNewsDriverRead" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driverId" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNewsDriverRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminNewsDriverRead_driverId_broadcastId_key" ON "AdminNewsDriverRead"("driverId", "broadcastId");

ALTER TABLE "AdminNewsDriverRead" ADD CONSTRAINT "AdminNewsDriverRead_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminNewsDriverRead" ADD CONSTRAINT "AdminNewsDriverRead_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "AdminNewsBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AdminNewsDriverRead_driverId_idx" ON "AdminNewsDriverRead"("driverId");
