import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const gradeAnswerSchema = z.object({
  pointsAwarded: z.coerce.number().int().min(0, 'Points must be >= 0.'),
});
export class GradeAnswerDto extends createZodDto(gradeAnswerSchema) {}
