-- Legacy: P3009 tuzatish endi `npm run start:render` ichida
-- `scripts/clearLegacyPrismaFailedMigrations.cjs` orqali avtomatik (Shell shart emas).
-- Bu faylni qo'lda ishlatish ixtiyoriy.

DELETE FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260207120000_platform_wallet_thresholds',
  '20260207170000_admin_news_broadcast',
  '20260208140000_admin_news_driver_read'
);
