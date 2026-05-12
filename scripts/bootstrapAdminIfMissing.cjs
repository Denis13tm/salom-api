/**
 * Production (Render): to'liq `db:seed` ishlamasa ham admin panel uchun
 * `User` (SUPER_ADMIN) + `Admin` qatorini bir marta yaratadi (seed bilan bir xil UUID).
 * `Admin` allaqachon bo'lsa — hech narsa qilmaydi.
 */
const { PrismaClient, UserRole, UserAccountStatus } = require('@prisma/client');

const USER_ADMIN_ID = 'a0000000-0000-4000-8000-000000000010';
const ADMIN_ROW_ID = 'a0000000-0000-4000-8000-000000000020';

async function main() {
  if (process.env.SALOM_SKIP_BOOTSTRAP_ADMIN === 'true') {
    console.log('bootstrapAdminIfMissing: skipped (SALOM_SKIP_BOOTSTRAP_ADMIN=true)');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const n = await prisma.admin.count();
    if (n > 0) {
      console.log('bootstrapAdminIfMissing: admin row exists, skip');
      return;
    }
    console.log('bootstrapAdminIfMissing: creating User + Admin for web panel');
    await prisma.user.upsert({
      where: { phone: '+998900000000' },
      create: {
        id: USER_ADMIN_ID,
        phone: '+998900000000',
        role: UserRole.SUPER_ADMIN,
        status: UserAccountStatus.ACTIVE,
      },
      update: { status: UserAccountStatus.ACTIVE, role: UserRole.SUPER_ADMIN },
    });
    await prisma.admin.upsert({
      where: { userId: USER_ADMIN_ID },
      create: { id: ADMIN_ROW_ID, userId: USER_ADMIN_ID, title: 'Bootstrap' },
      update: {},
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('bootstrapAdminIfMissing:', err);
  process.exit(1);
});
