ALTER TABLE "Course" ALTER COLUMN "instructorId" DROP NOT NULL;
ALTER TABLE "Cohort" ALTER COLUMN "coordinatorId" DROP NOT NULL;

ALTER TABLE "Course"
  DROP CONSTRAINT IF EXISTS "Course_instructorId_fkey",
  ADD CONSTRAINT "Course_instructorId_fkey"
    FOREIGN KEY ("instructorId") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Cohort"
  DROP CONSTRAINT IF EXISTS "Cohort_coordinatorId_fkey",
  ADD CONSTRAINT "Cohort_coordinatorId_fkey"
    FOREIGN KEY ("coordinatorId") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;