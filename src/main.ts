import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/exceptions/all-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('app.port');
  const environment = configService.getOrThrow<string>('app.environment');
  
  app.useGlobalFilters(new AllExceptionsFilter())

  await app.listen(port);
  console.log(`Application running in ${environment} mode on port ${port}`);
}

await bootstrap();