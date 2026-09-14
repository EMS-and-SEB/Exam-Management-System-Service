import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const updateRetentionPolicySchema = z.object({ resultRetentionDays: z.number().int().min(30) });
export class UpdateRetentionPolicyDto extends createZodDto(updateRetentionPolicySchema) {}