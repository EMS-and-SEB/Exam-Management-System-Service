import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcrypt';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { EmailService } from '../src/email/email.service.js';

const STUDENT_ID = 'UGR/0001/20';
const STUDENT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EXAM_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COURSE_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SESSION_UUID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const STAFF_UUID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const PASSWORD = 'TestPass123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);

const STUDENT_FIXTURE = {
  id: STUDENT_UUID,
  studentId: STUDENT_ID,
  name: 'Jane Doe',
  email: 'jane@uni.edu',
  passwordHash: PASSWORD_HASH,
  isActive: true,
  createdAt: new Date(),
};

function buildPrismaMock() {
  return {
    staffAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    studentDirectory: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    enrollment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    cohortMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    exam: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    },
    examSession: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    examRoster: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockResolvedValue([[], 0]),
  };
}

const emailMock = {
  sendExamInquiry: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined),
  sendStaffInvitation: vi.fn().mockResolvedValue(undefined),
};

describe('Student Portal and Unified Auth (e2e)', () => {
  let app: INestApplication;
  let prismaMock: ReturnType<typeof buildPrismaMock>;

  async function bootstrap() {
    prismaMock = buildPrismaMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  async function loginAndGetTokens() {
    prismaMock.staffAccount.findUnique.mockResolvedValue(null);
    prismaMock.studentDirectory.findFirst.mockResolvedValue(STUDENT_FIXTURE);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: STUDENT_ID, password: PASSWORD })
      .expect(200);

    const cookies = res.headers['set-cookie'] as string[] | string | undefined;
    const cookieArray = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));
    const rawRefreshToken = refreshCookie?.split(';')[0]?.split('=')[1];

    return {
      jwt: res.body.jwt as string,
      rawRefreshToken,
      cookieHeader: refreshCookie,
    };
  }

  it('student login with studentId and password via POST /api/v1/auth/login', async () => {
    await bootstrap();
    prismaMock.staffAccount.findUnique.mockResolvedValue(null);
    prismaMock.studentDirectory.findFirst.mockResolvedValue(STUDENT_FIXTURE);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: STUDENT_ID, password: PASSWORD })
      .expect(200);

    expect(res.body.jwt).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.studentId).toBe(STUDENT_ID);
    expect(res.body.student).toBeDefined();

    const cookies = res.headers['set-cookie'] as string[] | string | undefined;
    const cookieArray = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('Path=/api/v1/auth');
    expect(refreshCookie).toContain('HttpOnly');
  });

  it('token refresh via POST /api/v1/auth/refresh', async () => {
    await bootstrap();
    const { cookieHeader } = await loginAndGetTokens();

    prismaMock.refreshToken.findFirst.mockResolvedValue({
      id: 'token-uuid',
      tokenHash: 'somehash',
      staffId: null,
      studentId: STUDENT_UUID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
    });
    prismaMock.studentDirectory.findUniqueOrThrow.mockResolvedValue(STUDENT_FIXTURE);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [cookieHeader || ''])
      .expect(200);

    expect(res.body.jwt).toBeDefined();
    expect(typeof res.body.jwt).toBe('string');
  });

  it('GET /api/v1/portal/courses returns enrolled courses and cohorts', async () => {
    await bootstrap();
    const { jwt } = await loginAndGetTokens();

    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        course: {
          id: COURSE_UUID,
          name: 'Computer Networks',
          status: 'ACTIVE',
          instructor: { id: STAFF_UUID, name: 'Prof. Turing', email: 'turing@uni.edu' },
        },
      },
    ]);
    prismaMock.cohortMember.findMany.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .get('/api/v1/portal/courses')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(res.body.courses).toHaveLength(1);
    expect(res.body.courses[0].name).toBe('Computer Networks');
    expect(res.body.cohorts).toHaveLength(0);
  });

  it('GET /api/v1/portal/exams/incoming accurately flags isOnRoster: false when missing from ExamRoster', async () => {
    await bootstrap();
    const { jwt } = await loginAndGetTokens();

    prismaMock.enrollment.findMany.mockResolvedValue([{ courseId: COURSE_UUID }]);
    prismaMock.cohortMember.findMany.mockResolvedValue([]);
    prismaMock.exam.findMany.mockResolvedValue([
      {
        id: EXAM_UUID,
        title: 'Networks Midterm',
        examType: 'MIDTERM',
        scheduledStart: new Date(),
        durationMinutes: 90,
        status: 'RELEASED',
        course: {
          name: 'Computer Networks',
          instructor: { name: 'Prof. Turing', email: 'turing@uni.edu', role: 'INSTRUCTOR' },
        },
        cohort: null,
      },
    ]);
    prismaMock.examRoster.findMany.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .get('/api/v1/portal/exams/incoming')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Networks Midterm');
    expect(res.body[0].isOnRoster).toBe(false);
  });

  it('GET /api/v1/portal/exams/results masks score as PENDING_GRADING when WORKOUT answers are ungraded, and reveals total score once graded', async () => {
    await bootstrap();
    const { jwt } = await loginAndGetTokens();

    prismaMock.examSession.findMany.mockResolvedValueOnce([
      {
        id: SESSION_UUID,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        exam: {
          id: EXAM_UUID,
          title: 'Algorithms Midterm',
          course: { name: 'Algorithms' },
          cohort: null,
          examQuestions: [
            { id: 'q1', points: 10, type: 'MULTIPLE_CHOICE' },
            { id: 'q2', points: 20, type: 'WORKOUT' },
          ],
        },
        answers: [
          { pointsAwarded: 10, gradedAt: new Date(), examQuestion: { type: 'MULTIPLE_CHOICE' } },
          { pointsAwarded: null, gradedAt: null, examQuestion: { type: 'WORKOUT' } },
        ],
      },
    ]);

    const resUngraded = await request(app.getHttpServer())
      .get('/api/v1/portal/exams/results')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(resUngraded.body[0].status).toBe('PENDING_GRADING');
    expect(resUngraded.body[0].score).toBeNull();
    expect(resUngraded.body[0].maxScore).toBe(30);

    prismaMock.examSession.findMany.mockResolvedValueOnce([
      {
        id: SESSION_UUID,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        exam: {
          id: EXAM_UUID,
          title: 'Algorithms Midterm',
          course: { name: 'Algorithms' },
          cohort: null,
          examQuestions: [
            { id: 'q1', points: 10, type: 'MULTIPLE_CHOICE' },
            { id: 'q2', points: 20, type: 'WORKOUT' },
          ],
        },
        answers: [
          { pointsAwarded: 10, gradedAt: new Date(), examQuestion: { type: 'MULTIPLE_CHOICE' } },
          { pointsAwarded: 18, gradedAt: new Date(), examQuestion: { type: 'WORKOUT' } },
        ],
      },
    ]);

    const resGraded = await request(app.getHttpServer())
      .get('/api/v1/portal/exams/results')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(resGraded.body[0].status).toBe('GRADED');
    expect(resGraded.body[0].score).toBe(28);
    expect(resGraded.body[0].maxScore).toBe(30);
    expect(resGraded.body[0].percentage).toBeCloseTo(93.33, 1);
  });

  it('student JWT receives 403 Forbidden when accessing staff-only routes', async () => {
    await bootstrap();
    const { jwt } = await loginAndGetTokens();

    await request(app.getHttpServer())
      .get('/api/v1/staff')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(403);
  });
});
