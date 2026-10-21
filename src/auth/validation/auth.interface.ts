import { StaffRole } from '../../generated/prisma/client.js';

export interface JwtPayload {
  sub: string;
  sid: string;
  role: StaffRole;
  orgUnitId: string;
  userType?: 'staff';
}

export interface StudentJwtPayload {
  sub: string;
  sid: string;
  role: 'STUDENT';
  userType: 'student';
}

export type AuthenticatedUser = JwtPayload | StudentJwtPayload;
