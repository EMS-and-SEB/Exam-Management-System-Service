import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const openIncidentSchema = z.object({
  category: z.enum(['VIOLATION', 'MEDICAL', 'WITHDRAWAL', 'TECHNICAL', 'OTHER']),
});
export class OpenIncidentDto extends createZodDto(openIncidentSchema) {}

const resolveIncidentSchema = z.object({
  password: z.string().min(1),
  category: z.enum(['VIOLATION', 'MEDICAL', 'WITHDRAWAL', 'TECHNICAL', 'OTHER']).optional(),
  resolution: z.enum(['RESUMED', 'TERMINATED']),
  resolutionReason: z.string().min(1).optional(),
});
export class ResolveIncidentDto extends createZodDto(resolveIncidentSchema) {}