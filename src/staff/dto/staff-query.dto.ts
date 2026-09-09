import { createZodDto } from 'nestjs-zod';
import { staffQuerySchema } from '../validation/staff.schema.js';

export class StaffQueryDto extends createZodDto(staffQuerySchema) {}
