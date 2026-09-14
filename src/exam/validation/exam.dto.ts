import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const createExamSchema = z.object({
  examType: z.enum(['QUIZ', 'MIDTERM', 'FINAL', 'MOCK_EXIT']),
  title: z.string().min(1),
  courseId: z.uuid().optional(),
  cohortId: z.uuid().optional(),
  durationMinutes: z.number().int().positive().optional(),
  scheduledStart: z.coerce.date().optional(),
}).superRefine((data, ctx) => {
  if (!!data.courseId === !!data.cohortId) {
    ctx.addIssue({ code: 'custom', message: 'Exactly one of courseId or cohortId must be provided.', path: ['courseId'] });
  }
});
export class CreateExamDto extends createZodDto(createExamSchema) {}

const updateExamSchema = z.object({
  title: z.string().min(1).optional(),
  durationMinutes: z.number().int().positive().optional(),
  scheduledStart: z.coerce.date().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided.' });
export class UpdateExamDto extends createZodDto(updateExamSchema) {}

const attachQuestionsSchema = z.object({ questionIds: z.array(z.uuid()).min(1) });
export class AttachQuestionsDto extends createZodDto(attachQuestionsSchema) {}

const assignInvigilatorSchema = z.object({ invigilatorId: z.uuid() });
export class AssignInvigilatorDto extends createZodDto(assignInvigilatorSchema) {}