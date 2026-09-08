import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createCohortSchema = z.object({ name: z.string().min(1), coordinatorId: z.uuid() });
export class CreateCohortDto extends createZodDto(createCohortSchema) {}

export const updateCohortSchema = z.object({
  name: z.string().min(1).optional(),
  coordinatorId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'At least one field is required.');
export class UpdateCohortDto extends createZodDto(updateCohortSchema) {}

export const addMemberSchema = z.object({ studentId: z.string().min(1), name: z.string().min(1) });
export class AddMemberDto extends createZodDto(addMemberSchema) {}

export const selectMembersSchema = z.object({
  studentIds: z.array(z.uuid()).min(1).refine((ids) => new Set(ids).size === ids.length, 'studentIds must be unique.'),
});
export class SelectMembersDto extends createZodDto(selectMembersSchema) {}
