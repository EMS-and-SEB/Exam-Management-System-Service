import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').startsWith('postgresql://', {
    message: 'DATABASE_URL must be a PostgreSQL connection string (postgresql://...)',
  }),
});