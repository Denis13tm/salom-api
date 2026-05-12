-- AlterEnum
ALTER TYPE "ChatMessageSender" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "operatorChatLastReadAt" TIMESTAMPTZ(3);
ALTER TABLE "Driver" ADD COLUMN "adminChatLastReadAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "DriverAdminChatThread" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "lastMessageAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverAdminChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAdminChatMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "sender" "ChatMessageSender" NOT NULL,
    "adminId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverAdminChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverAdminChatThread_driverId_key" ON "DriverAdminChatThread"("driverId");

-- CreateIndex
CREATE INDEX "DriverAdminChatThread_lastMessageAt_idx" ON "DriverAdminChatThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "DriverAdminChatMessage_threadId_createdAt_idx" ON "DriverAdminChatMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "DriverAdminChatThread" ADD CONSTRAINT "DriverAdminChatThread_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdminChatMessage" ADD CONSTRAINT "DriverAdminChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DriverAdminChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdminChatMessage" ADD CONSTRAINT "DriverAdminChatMessage_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
