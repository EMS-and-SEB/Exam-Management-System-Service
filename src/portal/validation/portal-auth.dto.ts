import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const portalLoginSchema = z.object({
  studentId: z.string().min(1, 'Student ID is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export class PortalLoginDto extends createZodDto(portalLoginSchema) {}
