import { Module } from '@nestjs/common';
import {ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module.js';

import configuration from './config/configuration.js';
import { envSchema } from './config/env.validation.js';

// import { AuditModule } from './audit/audit.module';
// import { AuthModule } from './auth/auth.module';
// import { CohortsModule } from './cohorts/cohorts.module';
// import { CoursesModule } from './courses/courses.module';
// import { ExamModule } from './exam/exam.module';
// import { GradingModule } from './grading/grading.module';
// import { IncidentsModule } from './incidents/incidents.module';
// import { QuestionsModule } from './questions/questions.module';
// import { SessionsModule } from './sessions/sessions.module';
// import { StaffModule } from './staff/staff.module';
// import { StudentsModule } from './students/students.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envSchema,
    }),
    PrismaModule,
    // AuthModule,
    // StaffModule,
    // StudentsModule,
    // CohortsModule,
    // CoursesModule,
    // QuestionsModule,
    // ExamModule,
    // SessionsModule,
    // GradingModule,
    // IncidentsModule,
    // AuditModule,
  ],
})
export class AppModule {}