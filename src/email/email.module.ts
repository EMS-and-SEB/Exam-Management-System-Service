import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';
import { EMAIL_PROVIDER } from './email.interface.js';
import { SmtpEmailProvider } from './providers/smtp.provider.js';
import { ResendEmailProvider } from './providers/resend.provider.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('app.environment') === 'production'
          ? new ResendEmailProvider(config)
          : new SmtpEmailProvider(config),
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}