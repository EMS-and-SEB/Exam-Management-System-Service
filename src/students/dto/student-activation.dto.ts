import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const studentActivationSchema = z.object({ email: z.email() });
export class StudentActivationDto extends createZodDto(studentActivationSchema) {}
