import { Module } from '@nestjs/common';
import { RetentionPolicyController } from './retention.controller.js';
import { RetentionPolicyService } from './retention.service.js';

@Module({
  controllers: [RetentionPolicyController],
  providers: [RetentionPolicyService],
})
export class RetentionPolicyModule {}