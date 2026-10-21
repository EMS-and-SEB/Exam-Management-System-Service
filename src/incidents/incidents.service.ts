import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { ExamStatus, IncidentCategory, IncidentResolution, Prisma, SessionStatus } from '../generated/prisma/client.js';
import { SessionsService } from '../sessions/sessions.service.js';

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly sessionsService: SessionsService,
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
    const result = await this.prisma.$transaction(async (tx) => {
      // Keep the lifecycle lock order shared with save, submit, expiry, and close:
      // exam first, then session. Closure's exam UPDATE lock therefore serializes
      // incident resolution before the session state is evaluated.
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Exam" WHERE id = ${incident.session.examId} FOR SHARE`,
      );
      const exam = await tx.exam.findUnique({ where: { id: incident.session.examId }, select: { status: true } });
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "ExamSession" WHERE id = ${sessionId} FOR UPDATE`,
      );
      const session = await tx.examSession.findUnique({ where: { id: sessionId } });
      const currentIncident = await tx.incident.findUnique({ where: { id: incidentId } });
      if (!exam || !session || session.examId !== incident.session.examId) {
        throw AppException.conflict('The exam session changed while resolving this incident.');
      }
      if (!currentIncident || currentIncident.sessionId !== sessionId) {
        throw AppException.notFound('Incident not found.');
      }
      // Serialize the final authorization check with account deactivation.
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "StaffAccount" WHERE id = ${staff.id} FOR SHARE`,
      );
      const currentStaff = await tx.staffAccount.findUnique({
        where: { id: staff.id },
        select: { isActive: true },
      });
      if (!currentStaff?.isActive) {
        throw AppException.unauthorized('The assigned invigilator account is inactive.');
      }
      if (currentIncident.resolvedAt) {
        throw AppException.conflict('This incident has already been resolved.');
      }
      if (exam.status !== ExamStatus.RELEASED) {
        throw AppException.conflict('An incident cannot change a session after its exam has closed.');
      }
      if (session.status !== SessionStatus.IN_PROGRESS) {
        throw AppException.conflict('An incident cannot change a terminal or inactive exam session.');
      }
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS "now"`);
      if (!clock?.now) throw AppException.internal('Could not determine the exam server time.');
      if (session.endsAt && clock.now >= session.endsAt) {
        throw AppException.conflict('The exam session has reached its deadline and must be finalized before resolving this incident.');
      }

      const resolvedSession = dto.resolution === 'TERMINATED'
        ? await this.sessionsService.forceSubmitForIncident(sessionId, tx)
        : session;
      const resolvedIncident = await tx.incident.update({
        where: { id: incidentId },
        data: {
          category: dto.category ?? currentIncident.category,
          resolvedById: staff.id,
          resolution: dto.resolution,
          resolutionReason: dto.resolutionReason,
          resolvedAt: new Date(),
        },
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

      return { incident: resolvedIncident, session: resolvedSession };
    });

    return { incident: result.incident, session: result.session };
  }
}
