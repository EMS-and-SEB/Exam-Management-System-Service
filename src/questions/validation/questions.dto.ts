import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optionSchema = z.object({ id: z.string(), text: z.string() });
const baseFields = { prompt: z.string().min(1), points: z.number().int().positive().default(1) };

export const questionTypeSchema = z.enum([
  'TRUE_FALSE', 'MULTIPLE_CHOICE', 'MATCHING', 'FILL_BLANK', 'WORKOUT',
]);

export const questionInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TRUE_FALSE'), ...baseFields, correctAnswer: z.boolean() }),

  z.object({
    type: z.literal('MULTIPLE_CHOICE'), ...baseFields,
    options: z.array(optionSchema).min(2),
    correctAnswerCount: z.number().int().min(1),
    correctAnswer: z.array(z.string()).min(1),
  }).refine((q) => q.correctAnswerCount <= q.options.length && q.correctAnswer.length === q.correctAnswerCount, {
    message: 'Select exactly the configured number of correct answers.', path: ['correctAnswer'],
  }).refine((q) => new Set(q.correctAnswer).size === q.correctAnswer.length && q.correctAnswer.every((id) => q.options.some((o) => o.id === id)), {
    message: 'correctAnswer must contain unique ids from the given options.', path: ['correctAnswer'],
  }),

  z.object({
    type: z.literal('MATCHING'), ...baseFields,
    options: z.object({ left: z.array(optionSchema).min(1), right: z.array(optionSchema).min(1) }),
    correctAnswer: z.array(z.object({ leftId: z.string(), rightId: z.string() })).min(1),
  }),

  z.object({
    type: z.literal('FILL_BLANK'), ...baseFields,
    correctAnswer: z.array(z.string().min(1)).min(1),
  }).refine((q) => (q.prompt.match(/\{\{\d+\}\}/g)?.length ?? 0) === q.correctAnswer.length, {
    message: 'Number of {{n}} blanks in the prompt must match correctAnswer length.', path: ['correctAnswer'],
  }),

  z.object({ type: z.literal('WORKOUT'), ...baseFields }),
]);

export type QuestionInput = z.infer<typeof questionInputSchema>;

export const createQuestionsSchema = z.object({
  type: questionTypeSchema,
  questions: z.array(questionInputSchema).min(1),
}).refine((data) => data.questions.every((q) => q.type === data.type), {
  message: 'All questions in this request must match the top-level type.',
  path: ['questions'],
});
export class CreateQuestionsDto extends createZodDto(createQuestionsSchema) {}

export const updateQuestionSchema = z.object({
  prompt: z.string().min(1).optional(),
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  correctAnswerCount: z.number().int().min(1).optional(),
  points: z.number().int().positive().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided.' });
export class UpdateQuestionDto extends createZodDto(updateQuestionSchema) {}
