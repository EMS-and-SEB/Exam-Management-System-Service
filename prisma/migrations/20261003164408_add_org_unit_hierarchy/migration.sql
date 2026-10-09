-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "orgUnitId" UUID;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "orgUnitId" UUID;

-- AlterTable
ALTER TABLE "StaffAccount" ADD COLUMN     "canCreateAdmins" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orgUnitId" UUID,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnitClosure" (
    "ancestorId" UUID NOT NULL,
    "descendantId" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "OrgUnitClosure_pkey" PRIMARY KEY ("ancestorId","descendantId")
);

-- CreateIndex
CREATE INDEX "OrgUnitClosure_descendantId_idx" ON "OrgUnitClosure"("descendantId");

-- AddForeignKey
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "StaffAccount_orgUnitId_idx" ON "StaffAccount"("orgUnitId");
CREATE INDEX "Course_orgUnitId_idx" ON "Course"("orgUnitId");
CREATE INDEX "Cohort_orgUnitId_idx" ON "Cohort"("orgUnitId");

-- Seed the root org unit and backfill every existing row.
DO $$
DECLARE
  root_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO "OrgUnit" ("id", "parentId", "name") VALUES (root_id, NULL, 'Institution');
  INSERT INTO "OrgUnitClosure" ("ancestorId", "descendantId", "depth") VALUES (root_id, root_id, 0);

  UPDATE "StaffAccount" SET "orgUnitId" = root_id WHERE "orgUnitId" IS NULL;
  UPDATE "Course" SET "orgUnitId" = root_id WHERE "orgUnitId" IS NULL;
  UPDATE "Cohort" SET "orgUnitId" = root_id WHERE "orgUnitId" IS NULL;

  -- Your existing EXAM_ADMIN becomes SUPER_ADMIN automatically.
  UPDATE "StaffAccount" SET "role" = 'SUPER_ADMIN', "canCreateAdmins" = true WHERE "role" = 'EXAM_ADMIN';
END $$;