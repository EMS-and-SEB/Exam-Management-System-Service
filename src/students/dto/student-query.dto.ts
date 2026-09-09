import { createZodDto } from 'nestjs-zod';
import { studentQuerySchema } from '../validation/student.schema.js';

export class StudentQueryDto extends createZodDto(studentQuerySchema) {}
