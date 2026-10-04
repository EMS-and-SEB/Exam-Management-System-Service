import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const examInquirySchema = z.object({
  subject: z.string().min(3).max(150),
  message: z.string().min(10).max(2000),
});

export class ExamInquiryDto extends createZodDto(examInquirySchema) {}
