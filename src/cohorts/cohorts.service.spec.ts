import { CohortStatus, StaffRole } from '../generated/prisma/client.js';
import { CohortsService } from './cohorts.service.js';

function makeHarness(status: CohortStatus) {
  const cohort = {
    id: 'cohort-id',
    name: '2026 Cohort',
    status,
    coordinatorId: 'coordinator-id',
    orgUnitId: 'unit-id',
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: cohort.id }]),
    cohort: {
      findUnique: vi.fn().mockResolvedValue(cohort),
      update: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...cohort, ...data })),
    },
  };
  const prisma = {
    cohort: { findUnique: vi.fn().mockResolvedValue(cohort) },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new CohortsService(
    prisma as never,
    auditService as never,
    {} as never,
    { getScopedIds: vi.fn().mockResolvedValue(['unit-id']) } as never,
  );
  return { service, tx, auditService };
}

describe('CohortsService archived cohort updates', () => {
  const caller = { staffId: 'admin-id', role: StaffRole.SUPER_ADMIN, orgUnitId: 'unit-id' };

  it('rejects edits to an archived cohort while keeping the update behind the row lock', async () => {
    const { service, tx, auditService } = makeHarness(CohortStatus.ARCHIVED);

    await expect(service.update('cohort-id', { name: 'Renamed cohort' }, caller))
      .rejects.toThrow('Archived cohorts are read-only');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.cohort.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('allows an archived cohort to be restored without changing other fields', async () => {
    const { service, tx, auditService } = makeHarness(CohortStatus.ARCHIVED);

    await expect(service.update('cohort-id', { status: CohortStatus.ACTIVE }, caller))
      .resolves.toMatchObject({ status: CohortStatus.ACTIVE });

    expect(tx.cohort.update).toHaveBeenCalledWith({ where: { id: 'cohort-id' }, data: { status: CohortStatus.ACTIVE } });
    expect(auditService.log).toHaveBeenCalledTimes(1);
  });
});
