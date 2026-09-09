import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StaffModule } from './staff/staff.module.js';
import { StudentsModule } from './students/students.module.js';

import configuration from './config/configuration.js';
import { envSchema } from './config/env.validation.js';

import { CohortsModule } from './cohorts/cohorts.module.js';
import { QuestionsModule } from './questions/questions.module.js';

// Future modules
// import { CoursesModule } from './courses/courses.module.js';
// import { ExamModule } from './exam/exam.module.js';
// import { GradingModule } from './grading/grading.module.js';
// import { IncidentsModule } from './incidents/incidents.module.js';
// import { SessionsModule } from './sessions/sessions.module.js';
// import { AuditModule } from './audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: (config) => envSchema.parse(config),
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('throttle.ttlMs'),
          limit: config.getOrThrow<number>('throttle.limit'),
        },
      ],
    }),

    PrismaModule,

    AuthModule,

    // Staff and Student modules
    StaffModule,
    StudentsModule,

    // Cohorts and Questions modules
    CohortsModule,
    QuestionsModule,

    // Future modules
    // CoursesModule,
    // ExamModule,
    // SessionsModule,
    // GradingModule,
    // IncidentsModule,
    // AuditModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
