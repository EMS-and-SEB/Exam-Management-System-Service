import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createCohortSchema = z.object({ name: z.string().min(1), coordinatorId: z.uuid() });
export class CreateCohortDto extends createZodDto(createCohortSchema) {}

const updateCohortSchema = z.object({
  name: z.string().min(1).optional(),
  coordinatorId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
})
export class UpdateCohortDto extends createZodDto(updateCohortSchema) {}

const addMemberSchema = z.object({ studentId: z.string().min(1), name: z.string().min(1) });
export class AddMemberDto extends createZodDto(addMemberSchema) {}

const addMembersSelectedSchema = z.object({
  studentIds: z.array(z.uuid()).min(1),
});
export class AddMembersSelectedDto extends createZodDto(addMembersSelectedSchema) {}
  