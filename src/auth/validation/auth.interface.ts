import { StaffRole } from '../../generated/prisma/client.js';

export interface JwtPayload {
  sub: string;
  sid: string;
  role: StaffRole;
  orgUnitId: string;
}
