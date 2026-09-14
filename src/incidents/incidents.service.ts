import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { IncidentCategory, IncidentResolution, SessionStatus } from '../generated/prisma/client.js';

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  async openIncident(sessionId: string, category: IncidentCategory) {
    const session = await this.prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw AppException.notFound('Exam session not found.');

    const existingOpen = await this.prisma.incident.findFirst({ where: { sessionId, resolvedAt: null } });
    if (existingOpen) throw AppException.conflict('This session already has an unresolved incident.');

    const incident = await this.prisma.$transaction(async (tx) => {
      const created = await tx.incident.create({ data: { sessionId, category } });
      await this.auditService.log(
        { action: AuditAction.INCIDENT_OPENED, entityType: 'Incident', entityId: created.id, metadata: { sessionId, category } },
        tx,
      );
      return created;
    });

    return { incident };
  }

  async resolveIncident(
    incidentId: string,
    sessionId: string,
    dto: { password: string; category?: IncidentCategory; resolution: IncidentResolution; resolutionReason?: string },
  ) {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId }, include: { session: true } });
    if (!incident) throw AppException.notFound('Incident not found.');
    if (incident.sessionId !== sessionId) throw AppException.forbidden();
    if (incident.resolvedAt) throw AppException.conflict('This incident has already been resolved.');

    const staff = await this.authService.identifyAssignedInvigilator(incident.session.examId, dto.password);
    const newSessionStatus = dto.resolution === 'TERMINATED' ? SessionStatus.FORCE_SUBMITTED : SessionStatus.IN_PROGRESS;

    const [updatedIncident, updatedSession] = await this.prisma.$transaction(async (tx) => {
      const resolvedIncident = await tx.incident.update({
        where: { id: incidentId },
        data: {
          category: dto.category ?? incident.category,
          resolvedById: staff.id,
          resolution: dto.resolution,
          resolutionReason: dto.resolutionReason,
          resolvedAt: new Date(),
        },
      });
      const resolvedSession = await tx.examSession.update({
        where: { id: incident.sessionId },
        data: { status: newSessionStatus, submittedAt: dto.resolution === 'TERMINATED' ? new Date() : undefined },
      });

      await this.auditService.log(
        { actorId: staff.id, action: AuditAction.INCIDENT_RESOLVED, entityType: 'Incident', entityId: incidentId, metadata: { resolution: dto.resolution } },
        tx,
      );
      if (dto.resolution === 'TERMINATED') {
        await this.auditService.log(
          { actorId: staff.id, action: AuditAction.FORCE_SUBMIT, entityType: 'ExamSession', entityId: incident.sessionId, metadata: { incidentId } },
          tx,
        );
      }

      return [resolvedIncident, resolvedSession];
    });

    return { incident: updatedIncident, session: updatedSession };
  }
}