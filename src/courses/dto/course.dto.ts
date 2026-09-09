import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const createCourseSchema = z.object({
  name: z.string().min(1),
  instructorId: z.uuid(),
});
export class CreateCourseDto extends createZodDto(createCourseSchema) {}

export const updateCourseSchema = z.object({
  name: z.string().min(1).optional(),
  instructorId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export class UpdateCourseDto extends createZodDto(updateCourseSchema) {}

export const enrollStudentSchema = z.object({
  studentId: z.string().min(1),
  name: z.string().min(1),
});
export class EnrollStudentDto extends createZodDto(enrollStudentSchema) {}

export const enrollSelectedSchema = z.object({
  studentIds: z.array(z.uuid()).min(1),
});
export class EnrollSelectedDto extends createZodDto(enrollSelectedSchema) {}