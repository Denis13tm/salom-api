-- Chempionlar tab: admin banner rasmlari + karusel intervali
ALTER TABLE "PlatformSettings" ADD COLUMN "championsHomeBannerPathsJson" JSONB;
ALTER TABLE "PlatformSettings" ADD COLUMN "championsHomeCarouselIntervalSec" INTEGER NOT NULL DEFAULT 5;
