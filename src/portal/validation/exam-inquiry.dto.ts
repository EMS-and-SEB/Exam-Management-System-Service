import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const examInquirySchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters.').max(150, 'Subject must not exceed 150 characters.'),
  message: z.string().min(10, 'Message must be at least 10 characters.').max(2000, 'Message must not exceed 2000 characters.'),
});

export class ExamInquiryDto extends createZodDto(examInquirySchema) {}
