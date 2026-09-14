import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export class AuditQueryDto extends createZodDto(auditQuerySchema) {}