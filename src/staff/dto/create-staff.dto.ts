import { createZodDto } from 'nestjs-zod';
import { createStaffSchema } from '../validation/staff.schema.js';

export class CreateStaffDto extends createZodDto(createStaffSchema) {}
