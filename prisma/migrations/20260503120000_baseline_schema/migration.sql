-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'DRIVER');

-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DriverOperationalStatus" AS ENUM ('OFFLINE', 'ONLINE_IDLE', 'ORDER_OFFERED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'IN_TRIP', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'BROADCASTED', 'ACCEPTED', 'DRIVER_ARRIVING', 'PASSENGER_ONBOARD', 'COMPLETED', 'CANCELLED_BY_OPERATOR', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_PASSENGER', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderAssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'COMPLETED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripEventType" AS ENUM ('TRIP_RESERVED', 'DRIVER_ARRIVED_AT_PICKUP', 'PASSENGER_ONBOARD', 'TRIP_STARTED', 'TRIP_ENDED', 'FARE_FINALIZED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'NOTE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "FareMode" AS ENUM ('FIXED_CITY', 'OPERATOR_ENTERED', 'DISTANCE_BASED', 'METERED');

-- CreateEnum
CREATE TYPE "DriverDocumentType" AS ENUM ('LICENSE', 'VEHICLE_REG', 'PHOTO', 'OTHER', 'LICENSE_FRONT', 'LICENSE_BACK', 'LICENSE_HOLD');

-- CreateEnum
CREATE TYPE "DriverDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EarningsLedgerType" AS ENUM ('TOP_UP', 'TRIP_COMMISSION_DEBIT', 'MANUAL_ADJUSTMENT_PLUS', 'MANUAL_ADJUSTMENT_MINUS', 'MONTHLY_SETTLEMENT', 'REFUND', 'BONUS_CREDIT', 'TRIP_EARNINGS', 'BONUS', 'ADJUSTMENT', 'SUBSCRIPTION_FEE', 'PAYOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "DriverSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'IN_APP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatMessageSender" AS ENUM ('DRIVER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "DriverOnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DriverMonthSettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WAIVED', 'CHARGED_MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserAccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "serviceZoneId" UUID,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceZone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "centerLat" DECIMAL(9,6),
    "centerLng" DECIMAL(9,6),
    "starterFeeUzs" DECIMAL(18,2),
    "waitingFreeMinutes" INTEGER,
    "waitingFeePerMinuteUzs" DECIMAL(18,2),
    "meterBaseUzs" DECIMAL(18,2),
    "meterPerKmUzs" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultOperatorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingProfile" (
    "id" UUID NOT NULL,
    "serviceZoneId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cityKmRateUzs" DECIMAL(18,2) NOT NULL DEFAULT 2500,
    "outsideKmRateUzs" DECIMAL(18,2) NOT NULL DEFAULT 3500,
    "freeWaitMinutes" INTEGER NOT NULL DEFAULT 10,
    "waitPerMinuteUzs" DECIMAL(18,2) NOT NULL DEFAULT 1000,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PricingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRing" (
    "id" UUID NOT NULL,
    "pricingProfileId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" TEXT NOT NULL,
    "radiusFromKm" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "radiusToKm" DECIMAL(8,2),
    "starterFeeUzs" DECIMAL(18,2) NOT NULL,
    "distanceRateUzs" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PricingRing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "serviceZoneId" UUID,
    "operationalStatus" "DriverOperationalStatus" NOT NULL DEFAULT 'OFFLINE',
    "balanceUzs" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ratingAvg" DECIMAL(3,2),
    "fcmToken" TEXT,
    "clientDeviceId" TEXT,
    "payoutIban" VARCHAR(64),
    "payoutAccountName" VARCHAR(200),
    "onboardingStatus" "DriverOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "firstName" VARCHAR(120),
    "lastName" VARCHAR(120),
    "passportOrId" VARCHAR(64),
    "referralNote" VARCHAR(200),
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "activationCode" VARCHAR(12),
    "activationCodeIssuedAt" TIMESTAMPTZ(3),
    "appActivatedAt" TIMESTAMPTZ(3),
    "adminNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverOperatorChatThread" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "lastMessageAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverOperatorChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverOperatorChatMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "sender" "ChatMessageSender" NOT NULL,
    "operatorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverOperatorChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpLoginChallenge" (
    "id" UUID NOT NULL,
    "phoneNorm" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "driverId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OtpLoginChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "serviceZoneId" UUID,
    "plate" TEXT NOT NULL,
    "makeModel" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverDocument" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "status" "DriverDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPackage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priorityWeight" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "priceUzs" DECIMAL(18,2) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverSubscription" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "serviceZoneId" UUID,
    "status" "DriverSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusCampaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BonusCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusReward" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "amountUzs" DECIMAL(18,2) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BonusReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationReason" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "labelUz" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "serviceZoneId" UUID,
    "pricingProfileId" UUID,
    "pricingRingId" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "customerPhone" TEXT NOT NULL,
    "pickupLandmark" TEXT NOT NULL,
    "pickupLat" DECIMAL(9,6),
    "pickupLng" DECIMAL(9,6),
    "dropoffText" TEXT,
    "notes" TEXT,
    "paymentType" "PaymentType" NOT NULL DEFAULT 'CASH',
    "fareMode" "FareMode" NOT NULL DEFAULT 'OPERATOR_ENTERED',
    "operatorEnteredFareUzs" DECIMAL(18,2),
    "pickupPricingZoneName" TEXT,
    "pickupDistanceFromCenterKm" DECIMAL(10,2),
    "starterFeeUzs" DECIMAL(18,2),
    "distanceRateUzs" DECIMAL(18,2),
    "freeWaitMinutes" INTEGER,
    "waitingFeePerMinuteUzs" DECIMAL(18,2),
    "pricingOverridden" BOOLEAN NOT NULL DEFAULT false,
    "pricingOverrideReason" TEXT,
    "createdByOperatorId" UUID,
    "assignedDriverId" UUID,
    "cancellationReasonId" UUID,
    "cancelNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "broadcastedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "expiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAssignment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "OrderAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "round" INTEGER NOT NULL DEFAULT 0,
    "offeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "rejectNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "grossUzs" DECIMAL(18,2),
    "commissionUzs" DECIMAL(18,2),
    "netUzs" DECIMAL(18,2),
    "disputeNote" TEXT,
    "waitingStartedAt" TIMESTAMPTZ(3),
    "waitingEndedAt" TIMESTAMPTZ(3),
    "freeWaitMinutes" INTEGER,
    "paidWaitMinutes" INTEGER,
    "starterFeeUzs" DECIMAL(18,2),
    "waitingFeePerMinuteUzs" DECIMAL(18,2),
    "waitingFeeUzs" DECIMAL(18,2),
    "manualFareUzs" DECIMAL(18,2),
    "distanceMeters" DECIMAL(12,2),
    "distanceRateUzs" DECIMAL(18,2),
    "distanceFeeUzs" DECIMAL(18,2),
    "finalFareUzs" DECIMAL(18,2),
    "pricingPlanId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "type" "TripEventType" NOT NULL,
    "payload" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "orderId" UUID,
    "tripId" UUID,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT DEFAULT 'gps',
    "metadata" JSONB,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsTemplate" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "bodyUz" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsLedger" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "EarningsLedgerType" NOT NULL,
    "amountUzs" DECIMAL(18,2) NOT NULL,
    "balanceAfterUzs" DECIMAL(18,2),
    "orderId" UUID,
    "tripId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarningsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLedger" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "tripId" UUID,
    "amountUzs" DECIMAL(18,2) NOT NULL,
    "rateBps" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "CommissionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverMonthSettlement" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "periodYm" VARCHAR(7) NOT NULL,
    "tripCount" INTEGER NOT NULL,
    "commissionDueUzs" DECIMAL(18,2) NOT NULL,
    "status" "DriverMonthSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "confirmedAt" TIMESTAMPTZ(3),
    "chargedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverMonthSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "orderId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SMSLog" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SmsDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "providerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "SMSLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRefreshSession_tokenHash_key" ON "AuthRefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthRefreshSession_userId_revokedAt_idx" ON "AuthRefreshSession"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_userId_key" ON "Operator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceZone_slug_key" ON "ServiceZone"("slug");

-- CreateIndex
CREATE INDEX "ServiceZone_isActive_slug_idx" ON "ServiceZone"("isActive", "slug");

-- CreateIndex
CREATE INDEX "PricingProfile_serviceZoneId_isDefault_isActive_idx" ON "PricingProfile"("serviceZoneId", "isDefault", "isActive");

-- CreateIndex
CREATE INDEX "PricingRing_pricingProfileId_sortOrder_idx" ON "PricingRing"("pricingProfileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRing_pricingProfileId_code_key" ON "PricingRing"("pricingProfileId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_activationCode_key" ON "Driver"("activationCode");

-- CreateIndex
CREATE INDEX "Driver_operationalStatus_serviceZoneId_idx" ON "Driver"("operationalStatus", "serviceZoneId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverOperatorChatThread_driverId_key" ON "DriverOperatorChatThread"("driverId");

-- CreateIndex
CREATE INDEX "DriverOperatorChatThread_lastMessageAt_idx" ON "DriverOperatorChatThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "DriverOperatorChatMessage_threadId_createdAt_idx" ON "DriverOperatorChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpLoginChallenge_phoneNorm_createdAt_idx" ON "OtpLoginChallenge"("phoneNorm", "createdAt");

-- CreateIndex
CREATE INDEX "OtpLoginChallenge_driverId_createdAt_idx" ON "OtpLoginChallenge"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Vehicle_driverId_isActive_idx" ON "Vehicle"("driverId", "isActive");

-- CreateIndex
CREATE INDEX "DriverDocument_driverId_type_idx" ON "DriverDocument"("driverId", "type");

-- CreateIndex
CREATE INDEX "DriverSubscription_driverId_status_endAt_idx" ON "DriverSubscription"("driverId", "status", "endAt");

-- CreateIndex
CREATE INDEX "DriverSubscription_endAt_status_idx" ON "DriverSubscription"("endAt", "status");

-- CreateIndex
CREATE INDEX "BonusCampaign_isActive_startAt_endAt_idx" ON "BonusCampaign"("isActive", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "BonusReward_driverId_campaignId_idx" ON "BonusReward"("driverId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReason_code_key" ON "CancellationReason"("code");

-- CreateIndex
CREATE INDEX "Order_status_serviceZoneId_createdAt_idx" ON "Order"("status", "serviceZoneId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_customerPhone_createdAt_idx" ON "Order"("customerPhone", "createdAt");

-- CreateIndex
CREATE INDEX "OrderAssignment_orderId_status_offeredAt_idx" ON "OrderAssignment"("orderId", "status", "offeredAt");

-- CreateIndex
CREATE INDEX "OrderAssignment_driverId_status_offeredAt_idx" ON "OrderAssignment"("driverId", "status", "offeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_orderId_key" ON "Trip"("orderId");

-- CreateIndex
CREATE INDEX "Trip_driverId_status_startedAt_idx" ON "Trip"("driverId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_createdAt_idx" ON "TripEvent"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationPing_driverId_recordedAt_idx" ON "LocationPing"("driverId", "recordedAt");

-- CreateIndex
CREATE INDEX "LocationPing_tripId_recordedAt_idx" ON "LocationPing"("tripId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsTemplate_code_key" ON "SmsTemplate"("code");

-- CreateIndex
CREATE INDEX "EarningsLedger_driverId_createdAt_idx" ON "EarningsLedger"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "EarningsLedger_orderId_tripId_idx" ON "EarningsLedger"("orderId", "tripId");

-- CreateIndex
CREATE INDEX "CommissionLedger_orderId_tripId_idx" ON "CommissionLedger"("orderId", "tripId");

-- CreateIndex
CREATE INDEX "DriverMonthSettlement_periodYm_status_idx" ON "DriverMonthSettlement"("periodYm", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DriverMonthSettlement_driverId_periodYm_key" ON "DriverMonthSettlement"("driverId", "periodYm");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_orderId_createdAt_idx" ON "NotificationLog"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "SMSLog_orderId_createdAt_idx" ON "SMSLog"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthRefreshSession" ADD CONSTRAINT "AuthRefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operator" ADD CONSTRAINT "Operator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operator" ADD CONSTRAINT "Operator_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceZone" ADD CONSTRAINT "ServiceZone_defaultOperatorId_fkey" FOREIGN KEY ("defaultOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingProfile" ADD CONSTRAINT "PricingProfile_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRing" ADD CONSTRAINT "PricingRing_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "PricingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverOperatorChatThread" ADD CONSTRAINT "DriverOperatorChatThread_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverOperatorChatMessage" ADD CONSTRAINT "DriverOperatorChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DriverOperatorChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverOperatorChatMessage" ADD CONSTRAINT "DriverOperatorChatMessage_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpLoginChallenge" ADD CONSTRAINT "OtpLoginChallenge_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSubscription" ADD CONSTRAINT "DriverSubscription_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSubscription" ADD CONSTRAINT "DriverSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSubscription" ADD CONSTRAINT "DriverSubscription_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusReward" ADD CONSTRAINT "BonusReward_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BonusCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusReward" ADD CONSTRAINT "BonusReward_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "PricingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pricingRingId_fkey" FOREIGN KEY ("pricingRingId") REFERENCES "PricingRing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByOperatorId_fkey" FOREIGN KEY ("createdByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancellationReasonId_fkey" FOREIGN KEY ("cancellationReasonId") REFERENCES "CancellationReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "OrderAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "OrderAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsLedger" ADD CONSTRAINT "EarningsLedger_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsLedger" ADD CONSTRAINT "EarningsLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsLedger" ADD CONSTRAINT "EarningsLedger_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverMonthSettlement" ADD CONSTRAINT "DriverMonthSettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SMSLog" ADD CONSTRAINT "SMSLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

