import { PrismaClient, StaffRole } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.EXAM_ADMIN_EMAIL;
  const password = process.env.EXAM_ADMIN_PASSWORD;
  const name = process.env.EXAM_ADMIN_NAME ?? 'Exam Administrator';

  if (!email || !password) {
    throw new Error('EXAM_ADMIN_EMAIL and EXAM_ADMIN_PASSWORD must be set to seed the root account.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const existing = await prisma.staffAccount.findFirst({ where: { role: StaffRole.EXAM_ADMIN } });
  if (existing) {
    console.log(`Exam Administrator already exists (${existing.email}) — skipping.`);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const admin = await prisma.staffAccount.create({
    data: { name, email, passwordHash, role: StaffRole.EXAM_ADMIN, isActive: true },
  });

  console.log(`Exam Administrator seeded: ${admin.email}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});