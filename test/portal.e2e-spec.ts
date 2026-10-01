/**
 * portal.e2e-spec.ts
 *
 * End-to-end integration tests for the Student Portal subsystem.
 *
 * Strategy
 * ─────────
 * These tests spin up the full NestJS application using the Testing module
 * but replace database and email I/O with lightweight in-memory fakes so
 * the suite runs without a live PostgreSQL instance or SMTP server.
 *
 * Coverage
 *   1. Student login – valid credentials  → 200 + JWT + httpOnly cookie
 *   2. Student login – wrong password     → 401
 *   3. GET /portal/courses                → returns enrolled courses/cohorts
 *   4. GET /portal/exams/incoming         → isOnRoster: false when not rostered
 *   5. GET /portal/exams/results          → PENDING_GRADING / GRADED masking
 *   6. Student token on staff endpoint    → 403
 */

import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcrypt';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { EmailService } from '../src/email/email.service.js';
import { AuditService } from '../src/audit/audit.service.js';

// ─── Shared Test Fixtures ────────────────────────────────────────────────────

const STUDENT_ID = 'UGR/0001/20';
const STUDENT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EXAM_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COURSE_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SESSION_UUID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const STAFF_UUID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const PASSWORD = 'TestPass123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);

/** Minimal PrismaService mock — each test overrides specific methods as needed. */
function buildPrismaMock() {
  return {
    studentDirectory: {
      findUnique: vi.fn(),
    },
    studentRefreshToken: {
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
    },
    examSession: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockResolvedValue([[], 0]),
  };
}

/** Minimal EmailService mock. */
const emailMock = {
  sendExamInquiry: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined),
  sendStaffInvitation: vi.fn().mockResolvedValue(undefined),
};

/** Minimal AuditService mock. */
const auditMock = {
  log: vi.fn().mockResolvedValue(undefined),
};

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Student Portal (e2e)', () => {
  let app: INestApplication;
  let prismaMock: ReturnType<typeof buildPrismaMock>;

  async function bootstrap(prismaOverrides?: Partial<ReturnType<typeof buildPrismaMock>>) {
    prismaMock = { ...buildPrismaMock(), ...prismaOverrides };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .overrideProvider(AuditService)
      .useValue(auditMock)
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

  // ── Test 1: Valid Login ────────────────────────────────────────────────────
  describe('POST /api/v1/portal/auth/login', () => {
    it('returns 200 with JWT and sets portal_refresh_token cookie on valid credentials', async () => {
      await bootstrap();

      prismaMock.studentDirectory.findUnique.mockResolvedValue({
        id: STUDENT_UUID,
        studentId: STUDENT_ID,
        name: 'Jane Doe',
        email: 'jane@uni.edu',
        passwordHash: PASSWORD_HASH,
        isActive: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/portal/auth/login')
        .send({ studentId: STUDENT_ID, password: PASSWORD })
        .expect(200);

      expect(res.body.jwt).toBeDefined();
      expect(typeof res.body.jwt).toBe('string');
      expect(res.body.student.studentId).toBe(STUDENT_ID);
      expect(res.body.student.passwordHash).toBeUndefined();

      const cookies: string[] = res.headers['set-cookie'] ?? [];
      const refreshCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c: string) =>
        c.startsWith('portal_refresh_token='),
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/api/v1/portal/auth');
    });
  });

  // ── Test 2: Wrong Password → 401 ──────────────────────────────────────────
  describe('POST /api/v1/portal/auth/login — invalid password', () => {
    it('returns 401 when the password does not match', async () => {
      await bootstrap();

      prismaMock.studentDirectory.findUnique.mockResolvedValue({
        id: STUDENT_UUID,
        studentId: STUDENT_ID,
        name: 'Jane Doe',
        email: null,
        passwordHash: PASSWORD_HASH,
        isActive: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/portal/auth/login')
        .send({ studentId: STUDENT_ID, password: 'WrongPassword!' })
        .expect(401);
    });
  });

  // ── Helper: Obtain a valid student JWT ────────────────────────────────────
  async function loginAndGetJwt(): Promise<string> {
    prismaMock.studentDirectory.findUnique.mockResolvedValue({
      id: STUDENT_UUID,
      studentId: STUDENT_ID,
      name: 'Jane Doe',
      email: 'jane@uni.edu',
      passwordHash: PASSWORD_HASH,
      isActive: true,
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/login')
      .send({ studentId: STUDENT_ID, password: PASSWORD })
      .expect(200);

    return res.body.jwt as string;
  }

  // ── Test 3: GET /portal/courses ───────────────────────────────────────────
  describe('GET /api/v1/portal/courses', () => {
    it('returns enrolled courses and cohorts for the authenticated student', async () => {
      await bootstrap();
      const jwt = await loginAndGetJwt();

      prismaMock.enrollment.findMany.mockResolvedValue([
        {
          course: {
            id: COURSE_UUID,
            name: 'Database Systems',
            status: 'ACTIVE',
            instructor: { id: STAFF_UUID, name: 'Dr. Turing', email: 'turing@uni.edu' },
          },
        },
      ]);
      prismaMock.cohortMember.findMany.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/portal/courses')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);

      expect(res.body.courses).toHaveLength(1);
      expect(res.body.courses[0].name).toBe('Database Systems');
      expect(res.body.courses[0].instructor.email).toBe('turing@uni.edu');
      expect(res.body.cohorts).toHaveLength(0);
    });
  });

  // ── Test 4: Incoming exams — isOnRoster: false ────────────────────────────
  describe('GET /api/v1/portal/exams/incoming', () => {
    it('returns isOnRoster: false when student is not on ExamRoster', async () => {
      await bootstrap();
      const jwt = await loginAndGetJwt();

      prismaMock.enrollment.findMany.mockResolvedValue([{ courseId: COURSE_UUID }]);
      prismaMock.cohortMember.findMany.mockResolvedValue([]);

      prismaMock.exam.findMany.mockResolvedValue([
        {
          id: EXAM_UUID,
          title: 'Database Systems Final',
          examType: 'FINAL',
          scheduledStart: new Date('2026-12-01T09:00:00Z'),
          durationMinutes: 120,
          status: 'RELEASED',
          course: {
            name: 'Database Systems',
            instructor: { name: 'Dr. Turing', email: 'turing@uni.edu' },
          },
          cohort: null,
          examRosters: [], // ← student NOT on roster
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/portal/exams/incoming')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].isOnRoster).toBe(false);
      expect(res.body[0].title).toBe('Database Systems Final');
    });
  });

  // ── Test 5: Exam results — PENDING_GRADING / GRADED masking ──────────────
  describe('GET /api/v1/portal/exams/results', () => {
    it('returns PENDING_GRADING with score: null when a WORKOUT answer is ungraded', async () => {
      await bootstrap();
      const jwt = await loginAndGetJwt();

      prismaMock.examSession.findMany.mockResolvedValue([
        {
          id: SESSION_UUID,
          status: 'SUBMITTED',
          submittedAt: new Date('2026-11-01T10:00:00Z'),
          exam: {
            id: EXAM_UUID,
            title: 'Midterm',
            examType: 'MIDTERM',
            examQuestions: [
              { type: 'MULTIPLE_CHOICE', points: 5 },
              { type: 'WORKOUT', points: 20 },
            ],
            course: { name: 'Algorithms' },
            cohort: null,
          },
          answers: [
            { pointsAwarded: 5, gradedAt: new Date(), examQuestion: { type: 'MULTIPLE_CHOICE' } },
            { pointsAwarded: null, gradedAt: null, examQuestion: { type: 'WORKOUT' } }, // ← ungraded
          ],
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/portal/exams/results')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);

      expect(res.body[0].status).toBe('PENDING_GRADING');
      expect(res.body[0].score).toBeNull();
      expect(res.body[0].maxScore).toBe(25);
      expect(res.body[0].gradingStatusMessage).toBeDefined();
    });

    it('returns GRADED with combined score once all WORKOUT answers are graded', async () => {
      await bootstrap();
      const jwt = await loginAndGetJwt();

      prismaMock.examSession.findMany.mockResolvedValue([
        {
          id: SESSION_UUID,
          status: 'SUBMITTED',
          submittedAt: new Date('2026-11-01T10:00:00Z'),
          exam: {
            id: EXAM_UUID,
            title: 'Midterm',
            examType: 'MIDTERM',
            examQuestions: [
              { type: 'MULTIPLE_CHOICE', points: 5 },
              { type: 'WORKOUT', points: 20 },
            ],
            course: { name: 'Algorithms' },
            cohort: null,
          },
          answers: [
            { pointsAwarded: 5, gradedAt: new Date(), examQuestion: { type: 'MULTIPLE_CHOICE' } },
            { pointsAwarded: 16, gradedAt: new Date(), examQuestion: { type: 'WORKOUT' } }, // ← graded
          ],
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/portal/exams/results')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);

      expect(res.body[0].status).toBe('GRADED');
      expect(res.body[0].score).toBe(21);
      expect(res.body[0].maxScore).toBe(25);
      expect(res.body[0].percentage).toBe(84);
    });
  });

  // ── Test 6: Student token on staff endpoint → 403 ────────────────────────
  describe('Access control — student token on staff endpoints', () => {
    it('returns 403 when a STUDENT JWT targets a staff-only route', async () => {
      await bootstrap();
      const jwt = await loginAndGetJwt();

      // POST /api/v1/staff is restricted to EXAM_ADMIN
      await request(app.getHttpServer())
        .get('/api/v1/staff')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(403);
    });
  });
});
