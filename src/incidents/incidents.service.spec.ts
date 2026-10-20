import { ExamStatus, IncidentResolution, SessionStatus } from '../generated/prisma/client.js';
import { IncidentsService } from './incidents.service.js';

function makeHarness(options?: { examStatus?: ExamStatus; sessionStatus?: SessionStatus; resolvedAt?: Date | null; endsAt?: Date; staffActive?: boolean }) {
  const incident = {
    id: 'incident-id',
    sessionId: 'session-id',
    category: 'OTHER',
    resolvedAt: options?.resolvedAt ?? null,
    session: { examId: 'exam-id' },
  };
  const session = {
    id: 'session-id',
    examId: 'exam-id',
    status: options?.sessionStatus ?? SessionStatus.IN_PROGRESS,
    endsAt: options?.endsAt ?? new Date(Date.now() + 60_000),
  };
  const tx = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: 'exam-id' }])
      .mockResolvedValueOnce([{ id: 'session-id' }])
      .mockResolvedValueOnce([{ id: 'invigilator-id' }])
      .mockResolvedValueOnce([{ now: options?.endsAt ?? new Date() }]),
    exam: { findUnique: vi.fn().mockResolvedValue({ status: options?.examStatus ?? ExamStatus.RELEASED }) },
    examSession: { findUnique: vi.fn().mockResolvedValue(session) },
    staffAccount: { findUnique: vi.fn().mockResolvedValue({ isActive: options?.staffActive ?? true }) },
    incident: {
      findUnique: vi.fn().mockResolvedValue(incident),
      update: vi.fn().mockResolvedValue({ ...incident, resolvedAt: new Date() }),
    },
  };
  const prisma = {
    incident: { findUnique: vi.fn().mockResolvedValue(incident) },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
  const authService = { identifyAssignedInvigilator: vi.fn().mockResolvedValue({ id: 'invigilator-id' }) };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const sessionsService = {
    forceSubmitForIncident: vi.fn().mockResolvedValue({ ...session, status: SessionStatus.FORCE_SUBMITTED }),
  };
  const service = new IncidentsService(
    prisma as never,
    authService as never,
    auditService as never,
    sessionsService as never,
  );
  return { service, prisma, tx, authService, auditService, sessionsService };
}

describe('IncidentsService lifecycle coordination', () => {
  const resolve = (service: IncidentsService, resolution: IncidentResolution) =>
    service.resolveIncident('incident-id', 'session-id', {
      password: 'password',
      resolution,
    });

  it('locks exam before session and transactionally delegates termination grading', async () => {
    const { service, tx, sessionsService, auditService } = makeHarness();

    await expect(resolve(service, IncidentResolution.TERMINATED)).resolves.toMatchObject({
      session: { status: SessionStatus.FORCE_SUBMITTED },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]);
    expect(sessionsService.forceSubmitForIncident).toHaveBeenCalledWith('session-id', tx);
    expect(auditService.log).toHaveBeenCalledTimes(2);
  });

  it('does not reopen a terminal session or resolve the incident', async () => {
    const { service, tx, sessionsService } = makeHarness({ sessionStatus: SessionStatus.FORCE_SUBMITTED });

    await expect(resolve(service, IncidentResolution.RESUMED)).rejects.toThrow('terminal or inactive');
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(sessionsService.forceSubmitForIncident).not.toHaveBeenCalled();
  });

  it('does not change a session when its exam is already closed', async () => {
    const { service, tx, sessionsService } = makeHarness({ examStatus: ExamStatus.CLOSED });

    await expect(resolve(service, IncidentResolution.TERMINATED)).rejects.toThrow('after its exam has closed');
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(sessionsService.forceSubmitForIncident).not.toHaveBeenCalled();
  });

  it('uses the database clock and rejects incident resolution at the exact deadline', async () => {
    const deadline = new Date('2026-10-14T12:00:00.000Z');
    const { service, tx, sessionsService } = makeHarness({ endsAt: deadline });

    await expect(resolve(service, IncidentResolution.TERMINATED)).rejects.toThrow('reached its deadline');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(sessionsService.forceSubmitForIncident).not.toHaveBeenCalled();
  });

  it('rechecks invigilator activation under a lock before resolving', async () => {
    const { service, tx, sessionsService } = makeHarness({ staffActive: false });

    await expect(resolve(service, IncidentResolution.TERMINATED)).rejects.toThrow('account is inactive');
    expect(tx.staffAccount.findUnique).toHaveBeenCalledWith({
      where: { id: 'invigilator-id' },
      select: { isActive: true },
    });
    expect(sessionsService.forceSubmitForIncident).not.toHaveBeenCalled();
    expect(tx.incident.update).not.toHaveBeenCalled();
  });

  it('rejects a repeated resolution after re-reading the incident under locks', async () => {
    const { service, tx, sessionsService } = makeHarness({ resolvedAt: new Date() });

    await expect(resolve(service, IncidentResolution.RESUMED)).rejects.toThrow('already been resolved');
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(sessionsService.forceSubmitForIncident).not.toHaveBeenCalled();
  });
});
