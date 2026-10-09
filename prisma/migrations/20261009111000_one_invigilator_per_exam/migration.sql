-- Preserve the application's single-assignment invariant before adding the constraint.
DELETE FROM "ExamInvigilator" a
USING "ExamInvigilator" b
WHERE a."examId" = b."examId"
  AND a."id" > b."id";

DROP INDEX "ExamInvigilator_examId_invigilatorId_key";

CREATE UNIQUE INDEX "ExamInvigilator_examId_key"
  ON "ExamInvigilator"("examId");

CREATE INDEX "ExamInvigilator_invigilatorId_idx"
  ON "ExamInvigilator"("invigilatorId");
