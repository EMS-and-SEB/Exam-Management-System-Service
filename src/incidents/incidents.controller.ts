import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IncidentsService } from './incidents.service.js';
import { Public } from '../auth/decorators/auth.decorator.js';
import { StudentSessionGuard } from '../common/guards/student-session.guard.js';
import { OpenIncidentDto, ResolveIncidentDto } from './validation/incidents.dto.js';

@Controller('sessions/:sessionId/incidents')
@Public()
@UseGuards(StudentSessionGuard)
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  openIncident(@Param('sessionId') sessionId: string, @Body() dto: OpenIncidentDto) {
    return this.incidentsService.openIncident(sessionId, dto.category);
  }

  @Patch(':incidentId/resolve')
  resolveIncident(
    @Param('sessionId') sessionId: string,
    @Param('incidentId') incidentId: string,
    @Body() dto: ResolveIncidentDto,
  ) {
    return this.incidentsService.resolveIncident(incidentId, sessionId, dto);
  }
}