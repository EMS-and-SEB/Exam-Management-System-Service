import { Module } from '@nestjs/common';

import { RosterMembershipService } from './roster-membership.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Module({
  providers: [
    PrismaService,
    RosterMembershipService,
  ],
  exports: [
    RosterMembershipService,
  ],
})
export class RosterMembershipModule {}