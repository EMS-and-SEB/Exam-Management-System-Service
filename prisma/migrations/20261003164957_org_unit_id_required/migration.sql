/*
  Warnings:

  - Made the column `orgUnitId` on table `Cohort` required. This step will fail if there are existing NULL values in that column.
  - Made the column `orgUnitId` on table `Course` required. This step will fail if there are existing NULL values in that column.
  - Made the column `orgUnitId` on table `StaffAccount` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Cohort" DROP CONSTRAINT "Cohort_orgUnitId_fkey";

-- DropForeignKey
ALTER TABLE "Course" DROP CONSTRAINT "Course_orgUnitId_fkey";

-- DropForeignKey
ALTER TABLE "StaffAccount" DROP CONSTRAINT "StaffAccount_orgUnitId_fkey";

-- AlterTable
ALTER TABLE "Cohort" ALTER COLUMN "orgUnitId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Course" ALTER COLUMN "orgUnitId" SET NOT NULL;

-- AlterTable
ALTER TABLE "StaffAccount" ALTER COLUMN "orgUnitId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
