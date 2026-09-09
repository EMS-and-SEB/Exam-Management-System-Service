import { createZodDto } from 'nestjs-zod';
import { updateStudentSchema } from '../validation/student.schema.js';

export class UpdateStudentDto extends createZodDto(updateStudentSchema) {}
