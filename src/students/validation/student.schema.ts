import { z } from 'zod';

export const createStudentSchema = z.object({
  studentId: z.string().min(1, 'Student ID is required.'),
  name: z.string().min(1, 'Name is required.'),
});

export const updateStudentSchema = z.object({
  studentId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export const studentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});
