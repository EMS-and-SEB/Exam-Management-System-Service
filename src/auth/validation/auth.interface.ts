import { StaffRole } from '../../generated/prisma/client.js';

export interface JwtPayload {
  sub: string;
  role: StaffRole;
}

