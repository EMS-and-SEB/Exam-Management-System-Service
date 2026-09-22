import { createZodDto } from 'nestjs-zod';
import { updateProfileSchema, updateStaffSchema } from '../validation/staff.schema.js';

export class UpdateStaffDto extends createZodDto(updateStaffSchema) {}
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
