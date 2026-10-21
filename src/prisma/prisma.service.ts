import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, types } from 'pg';
import { Logger } from '@nestjs/common'
import { parsePostgresTimestampAsUtc } from './utc-timestamp.js';

// Prisma DateTime maps to PostgreSQL TIMESTAMP(3) without timezone in this
// schema. Persisted values represent UTC (the API sends ISO timestamps), so
// parse them consistently regardless of the machine timezone.
types.setTypeParser(1114, parsePostgresTimestampAsUtc);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const pool = new Pool({
      connectionString: configService.getOrThrow<string>('database.url'),
      options: '-c timezone=UTC',
    });
    super({ adapter: new PrismaPg(pool) });
  }

  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected successfully');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
