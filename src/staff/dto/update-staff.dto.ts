import { createZodDto } from 'nestjs-zod';
import { updateStaffSchema } from '../validation/staff.schema.js';

export class UpdateStaffDto extends createZodDto(updateStaffSchema) {}
