import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';

import configuration from './config/configuration.js';
import { envSchema } from './config/env.validation.js';

import { CohortsModule } from './cohorts/cohorts.module.js';
import { QuestionsModule } from './questions/questions.module.js';

// Future modules
// import { CoursesModule } from './courses/courses.module.js';
// import { QuestionsModule } from './questions/questions.module.js';
// import { ExamModule } from './exam/exam.module.js';
// import { GradingModule } from './grading/grading.module.js';
// import { IncidentsModule } from './incidents/incidents.module.js';
// import { SessionsModule } from './sessions/sessions.module.js';
// import { StaffModule } from './staff/staff.module.js';
// import { StudentsModule } from './students/students.module.js';
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

    CohortsModule,

    // Questions module is currently active
    QuestionsModule,

    // Future modules
    // StaffModule,
    // StudentsModule,
    // CoursesModule,
    // QuestionsModule,
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