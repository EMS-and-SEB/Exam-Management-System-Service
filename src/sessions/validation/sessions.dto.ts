import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const studentLoginSchema = z.object({
  studentId: z.string().min(1, 'Student ID is required.'),
  otp: z.string().min(1, 'OTP is required.'),
});
export class StudentLoginDto extends createZodDto(studentLoginSchema) {}

export const saveAnswerSchema = z.object({
  examQuestionId: z.string().uuid('Invalid examQuestionId.'),
  responseData: z.any().nullable(),
});
export class SaveAnswerDto extends createZodDto(saveAnswerSchema) {}
