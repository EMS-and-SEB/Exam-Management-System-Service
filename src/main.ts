import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/exceptions/all-exception.filter.js';
import cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('app.port');
  const environment = configService.getOrThrow<string>('app.environment');
  
  app.use(cookieParser());
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter())

  await app.listen(port);
  console.log(`Application running in ${environment} mode on port ${port}`);
}

await bootstrap();