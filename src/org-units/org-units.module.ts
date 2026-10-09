import { Module } from '@nestjs/common';
import { OrgUnitsController } from './org-units.controller.js';
import { OrgUnitsService } from './org-units.service.js';

@Module({
  controllers: [OrgUnitsController],
  providers: [OrgUnitsService],
  exports: [OrgUnitsService],
})
export class OrgUnitsModule {}