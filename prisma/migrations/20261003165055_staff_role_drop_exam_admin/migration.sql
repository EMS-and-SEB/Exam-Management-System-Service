/*
  Warnings:

  - The values [EXAM_ADMIN] on the enum `StaffRole` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "StaffRole_new" AS ENUM ('SUPER_ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'INVIGILATOR', 'EXIT_EXAM_COORDINATOR');
ALTER TABLE "StaffAccount" ALTER COLUMN "role" TYPE "StaffRole_new" USING ("role"::text::"StaffRole_new");
ALTER TYPE "StaffRole" RENAME TO "StaffRole_old";
ALTER TYPE "StaffRole_new" RENAME TO "StaffRole";
DROP TYPE "public"."StaffRole_old";
COMMIT;
