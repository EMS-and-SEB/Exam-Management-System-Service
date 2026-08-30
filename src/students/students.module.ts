import { Module } from '@nestjs/common';

@Module({
  controllers: [],
  providers: [],
  exports: [],
})
export class StudentsModule {}

/*
students module (owns the create-if-unknown logic others call into)

POST /api/students
POST /api/students/bulk
GET /api/students
GET /api/students/:id
PATCH /api/students/:id

exposes the methods that back those APIs for courses and cohorts to call
*/
