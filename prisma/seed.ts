import { PrismaClient, StaffRole } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME ?? 'Super Admin';
  const institutionName = process.env.INSTITUTION_NAME;

  if (!email || !password) {
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set to seed the root account.');
  }
  if (!institutionName) {
    throw new Error('INSTITUTION_NAME must be set to seed the root org unit.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const existingAdmin = await prisma.staffAccount.findFirst({ where: { role: StaffRole.SUPER_ADMIN } });
  if (existingAdmin) {
    console.log(`Super Admin already exists (${existingAdmin.email}) — skipping.`);
    await prisma.$disconnect();
    return;
  }

  const rootOrgUnit = await getOrCreateRootOrgUnit(prisma, institutionName);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const admin = await prisma.staffAccount.create({
    data: {
      name,
      email,
      passwordHash,
      role: StaffRole.SUPER_ADMIN,
      orgUnitId: rootOrgUnit.id,
      isActive: true,
    },
  });

  console.log(`Super Admin seeded: ${admin.email} (${institutionName})`);
  await prisma.$disconnect();
}

async function getOrCreateRootOrgUnit(prisma: PrismaClient, institutionName: string) {
  const existingRoot = await prisma.orgUnit.findFirst({ where: { parentId: null } });

  if (existingRoot) {
    if (existingRoot.name !== institutionName) {
      return prisma.orgUnit.update({ where: { id: existingRoot.id }, data: { name: institutionName } });
    }
    return existingRoot;
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.orgUnit.create({ data: { parentId: null, name: institutionName } });
    await tx.orgUnitClosure.create({ data: { ancestorId: created.id, descendantId: created.id, depth: 0 } });
    return created;
  });
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});