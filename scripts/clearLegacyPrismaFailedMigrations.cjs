/**
 * Render free: Postgres Shell yo'q — P3009 (eski failed migration nomlari) deployni to'xtatadi.
 * `start:render` boshida bir marta ishlaydi: faqat repoda qayta nomlangan migratsiya qatorlarini o'chiradi.
 * Idempotent: keyingi ishga tushirishda 0 qator o'chadi.
 *
 * O'chirish: env `SALOM_SKIP_CLEAR_LEGACY_MIGRATIONS=true` (kamdan-kam hollarda).
 */
const { PrismaClient } = require('@prisma/client');

const LEGACY_NAMES = [
  '20260207120000_platform_wallet_thresholds',
  '20260207170000_admin_news_broadcast',
  '20260208140000_admin_news_driver_read',
];

async function main() {
  if (process.env.SALOM_SKIP_CLEAR_LEGACY_MIGRATIONS === 'true') {
    console.log('clearLegacyPrismaFailedMigrations: skipped (SALOM_SKIP_CLEAR_LEGACY_MIGRATIONS=true)');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_prisma_migrations'
      ) AS e
    `);
    const exists = Boolean(rows?.[0]?.e);
    if (!exists) {
      console.log('clearLegacyPrismaFailedMigrations: no _prisma_migrations table yet, skip');
      return;
    }

    const list = LEGACY_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name IN (${list})`,
    );
    console.log('clearLegacyPrismaFailedMigrations: removed legacy rows', n);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('clearLegacyPrismaFailedMigrations:', err);
  process.exit(1);
});
