import { StudentsService } from './students.service.js';

function makeHarness() {
  const createdStudent = {
    id: 'student-row-id',
    studentId: 'UGR/1212/16',
    name: 'elbethel ambachew',
    email: null,
    passwordHash: 'student-secret-hash',
    isActive: false,
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
  };
  const studentDirectory = {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue(createdStudent),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    studentDirectory,
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const service = new StudentsService(prisma as never, {} as never);

  return { service, studentDirectory, createdStudent };
}

describe('StudentsService registration compatibility', () => {
  it('creates an individual student using only the normalized ID and name', async () => {
    const { service, studentDirectory, createdStudent } = makeHarness();
    studentDirectory.findUnique.mockResolvedValue(null);

    await expect(service.create({ studentId: ' ugr/1212/16 ', name: 'elbethel ambachew' }))
      .resolves.toEqual({
        id: createdStudent.id,
        studentId: createdStudent.studentId,
        name: createdStudent.name,
        email: createdStudent.email,
        isActive: createdStudent.isActive,
        createdAt: createdStudent.createdAt,
      });

    expect(studentDirectory.create).toHaveBeenCalledWith({
      data: { studentId: 'UGR/1212/16', name: 'elbethel ambachew' },
    });
  });

  it('imports CSV rows with only studentId and name without requiring account fields', async () => {
    const { service, studentDirectory } = makeHarness();
    const csv = Buffer.from('studentId,name\nUGR/1212/16,elbethel ambachew\n');

    await expect(service.importStudents(csv)).resolves.toMatchObject({
      created: 1,
      alreadyExisted: 0,
      nameMismatches: [],
      errors: [],
    });

    expect(studentDirectory.createMany).toHaveBeenCalledWith({
      data: [{ studentId: 'UGR/1212/16', name: 'elbethel ambachew' }],
      skipDuplicates: true,
    });
  });

  it('does not expose the password hash in directory list or detail responses', async () => {
    const { service, studentDirectory, createdStudent } = makeHarness();
    studentDirectory.findMany.mockResolvedValue([{
      id: 'student-row-id',
      studentId: 'UGR/1212/16',
      name: 'elbethel ambachew',
      email: 'elbethel.ugr-1212-16@aau.edu.et',
      isActive: true,
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
    }]);
    studentDirectory.count.mockResolvedValue(1);
    studentDirectory.findUnique.mockResolvedValue({
      id: createdStudent.id,
      studentId: createdStudent.studentId,
      name: createdStudent.name,
      email: createdStudent.email,
      isActive: createdStudent.isActive,
      createdAt: createdStudent.createdAt,
    });

    const query = { page: 1, limit: 20 } as never;
    const list = await service.findAll(query);
    const detail = await service.findOne(createdStudent.id);

    expect(list.students[0]).not.toHaveProperty('passwordHash');
    expect(detail).not.toHaveProperty('passwordHash');
    expect(studentDirectory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ passwordHash: true }),
    }));
  });
});
