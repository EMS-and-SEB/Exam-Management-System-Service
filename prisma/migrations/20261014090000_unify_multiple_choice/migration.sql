-- Convert legacy multiple-select questions into multiple choice with an explicit
-- count of correct answers. Supported legacy values are scalar JSON strings or
-- non-empty arrays of unique JSON strings. Reject other shapes before any DDL.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Question"
    WHERE "type"::text IN ('MULTIPLE_CHOICE', 'MULTIPLE_SELECT')
      AND (
        "correctAnswer" IS NULL
        OR CASE jsonb_typeof("correctAnswer"::jsonb)
          WHEN 'string' THEN false
          WHEN 'array' THEN
            jsonb_array_length("correctAnswer"::jsonb) = 0
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements("correctAnswer"::jsonb) AS item(value)
              WHERE jsonb_typeof(item.value) <> 'string'
            )
            OR (
              SELECT count(*) FROM jsonb_array_elements("correctAnswer"::jsonb)
            ) <> (
              SELECT count(DISTINCT item.value)
              FROM jsonb_array_elements("correctAnswer"::jsonb) AS item(value)
            )
          ELSE true
        END
        OR CASE
          WHEN jsonb_typeof("options"::jsonb) = 'array' THEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof("correctAnswer"::jsonb) = 'array' THEN "correctAnswer"::jsonb
                ELSE jsonb_build_array("correctAnswer"::jsonb)
              END
            ) AS selected(value)
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements("options"::jsonb) AS option_value(value)
              WHERE jsonb_typeof(option_value.value) = 'object'
                AND jsonb_typeof(option_value.value -> 'id') = 'string'
                AND option_value.value -> 'id' = selected.value
            )
          )
          ELSE true
        END
      )
  ) THEN
    RAISE EXCEPTION 'Cannot unify Question multiple-choice data: correctAnswer must be a non-null string or a non-empty array of unique strings. Resolve invalid legacy rows before retrying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ExamQuestion"
    WHERE "type"::text IN ('MULTIPLE_CHOICE', 'MULTIPLE_SELECT')
      AND (
        "correctAnswer" IS NULL
        OR CASE jsonb_typeof("correctAnswer"::jsonb)
          WHEN 'string' THEN false
          WHEN 'array' THEN
            jsonb_array_length("correctAnswer"::jsonb) = 0
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements("correctAnswer"::jsonb) AS item(value)
              WHERE jsonb_typeof(item.value) <> 'string'
            )
            OR (
              SELECT count(*) FROM jsonb_array_elements("correctAnswer"::jsonb)
            ) <> (
              SELECT count(DISTINCT item.value)
              FROM jsonb_array_elements("correctAnswer"::jsonb) AS item(value)
            )
          ELSE true
        END
        OR CASE
          WHEN jsonb_typeof("options"::jsonb) = 'array' THEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof("correctAnswer"::jsonb) = 'array' THEN "correctAnswer"::jsonb
                ELSE jsonb_build_array("correctAnswer"::jsonb)
              END
            ) AS selected(value)
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements("options"::jsonb) AS option_value(value)
              WHERE jsonb_typeof(option_value.value) = 'object'
                AND jsonb_typeof(option_value.value -> 'id') = 'string'
                AND option_value.value -> 'id' = selected.value
            )
          )
          ELSE true
        END
      )
  ) THEN
    RAISE EXCEPTION 'Cannot unify ExamQuestion multiple-choice data: correctAnswer must be a non-null string or a non-empty array of unique strings. Resolve invalid legacy rows before retrying this migration.';
  END IF;
END $$;

ALTER TABLE "Question" ADD COLUMN "correctAnswerCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ExamQuestion" ADD COLUMN "correctAnswerCount" INTEGER NOT NULL DEFAULT 1;

UPDATE "Question"
SET "correctAnswer" = CASE
      WHEN jsonb_typeof("correctAnswer"::jsonb) = 'array' THEN "correctAnswer"
      ELSE jsonb_build_array("correctAnswer"::jsonb)
    END,
    "correctAnswerCount" = CASE
      WHEN jsonb_typeof("correctAnswer"::jsonb) = 'array'
        THEN jsonb_array_length("correctAnswer"::jsonb)
      ELSE 1
    END
WHERE "type"::text IN ('MULTIPLE_CHOICE', 'MULTIPLE_SELECT');

UPDATE "ExamQuestion"
SET "correctAnswer" = CASE
      WHEN jsonb_typeof("correctAnswer"::jsonb) = 'array' THEN "correctAnswer"
      ELSE jsonb_build_array("correctAnswer"::jsonb)
    END,
    "correctAnswerCount" = CASE
      WHEN jsonb_typeof("correctAnswer"::jsonb) = 'array'
        THEN jsonb_array_length("correctAnswer"::jsonb)
      ELSE 1
    END
WHERE "type"::text IN ('MULTIPLE_CHOICE', 'MULTIPLE_SELECT');

ALTER TYPE "QuestionType" RENAME TO "QuestionType_old";
CREATE TYPE "QuestionType" AS ENUM ('TRUE_FALSE', 'MULTIPLE_CHOICE', 'MATCHING', 'FILL_BLANK', 'WORKOUT');

ALTER TABLE "Question"
  ALTER COLUMN "type" TYPE "QuestionType"
  USING (CASE WHEN "type"::text = 'MULTIPLE_SELECT' THEN 'MULTIPLE_CHOICE' ELSE "type"::text END)::"QuestionType";

ALTER TABLE "ExamQuestion"
  ALTER COLUMN "type" TYPE "QuestionType"
  USING (CASE WHEN "type"::text = 'MULTIPLE_SELECT' THEN 'MULTIPLE_CHOICE' ELSE "type"::text END)::"QuestionType";

DROP TYPE "QuestionType_old";

COMMIT;
