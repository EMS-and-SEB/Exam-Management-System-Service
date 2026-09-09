CREATE UNIQUE INDEX enrollment_course_student_active_unique
ON "Enrollment" ("courseId", "studentId")
WHERE "deletedAt" IS NULL;