-- Komissiya hamyoni min / pastki ogohlantirish — admin panel va mobil Daromad bilan mos.
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "commissionWalletMinBroadcastBalanceUzs" INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "commissionWalletLowBalanceUzs" INTEGER NOT NULL DEFAULT 30000;
