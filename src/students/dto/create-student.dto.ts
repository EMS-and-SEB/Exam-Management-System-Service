import { createZodDto } from 'nestjs-zod';
import { createStudentSchema } from '../validation/student.schema.js';

export class CreateStudentDto extends createZodDto(createStudentSchema) {}
