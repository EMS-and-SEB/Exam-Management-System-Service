DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudentDirectory"
    GROUP BY upper(trim("studentId"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize StudentDirectory.studentId: duplicate IDs differ only by case or whitespace';
  END IF;
END $$;

UPDATE "StudentDirectory"
SET "studentId" = upper(trim("studentId"))
WHERE "studentId" <> upper(trim("studentId"));
