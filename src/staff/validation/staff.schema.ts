import { z } from 'zod';
import { StaffRole } from '../../generated/prisma/client.js';

export const createStaffSchema = z
  .object({
    name: z.string().min(1, 'Name is required.'),
    email: z.string().email('Invalid email format.'),
    role: z.enum(StaffRole),
    orgUnitId: z.string().uuid().optional(),
    newOrgUnitName: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.orgUnitId) !== Boolean(v.newOrgUnitName), {
    message: 'Provide exactly one of orgUnitId or newOrgUnitName.',
    path: ['orgUnitId'],
  });

export const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
});

export const updateProfileSchema = updateStaffSchema.pick({ name: true, email: true });

export const staffQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: z.union([z.enum(StaffRole), z.array(z.enum(StaffRole)).min(1)]).optional(),
  orgUnitId: z.string().uuid().optional(),
  isActive: z.preprocess(
    (value) => (value === 'true' ? true : value === 'false' ? false : value),
    z.boolean().optional(),
  ),
});