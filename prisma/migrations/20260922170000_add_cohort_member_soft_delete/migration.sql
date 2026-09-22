ALTER TABLE "CohortMember"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "CohortMember_cohortId_studentId_key";

CREATE UNIQUE INDEX "cohort_member_active_unique"
ON "CohortMember" ("cohortId", "studentId")
WHERE "deletedAt" IS NULL;
