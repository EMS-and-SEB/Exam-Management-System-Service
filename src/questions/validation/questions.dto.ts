import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const questionTypeSchema = z.enum([
  'TRUE_FALSE', 'MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'MATCHING', 'FILL_BLANK', 'WORKOUT',
]);

export const questionInputSchema = z.object({
  prompt: z.string().min(1),
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  points: z.number().int().positive(),
});

export const createQuestionsSchema = z.object({
  type: questionTypeSchema,
  questions: z.array(questionInputSchema).min(1),
});
export class CreateQuestionsDto extends createZodDto(createQuestionsSchema) {}

export const updateQuestionSchema = z.object({
  prompt: z.string().min(1).optional(),
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  points: z.number().int().positive().optional(),
}).strict();
export class UpdateQuestionDto extends createZodDto(updateQuestionSchema) {}
