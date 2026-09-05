import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailProvider, SendEmailParams } from '../email.interface.js';
import { AppException } from '../../common/exceptions/app-exceptions.js'

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  private readonly from: string;

  constructor(configService: ConfigService) {
    this.client = new Resend(configService.getOrThrow<string>('email.resendApiKey'));
    this.from = configService.getOrThrow<string>('email.from');
  }

  async send({ to, subject, html }: SendEmailParams): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to, subject, html });
    if (error) throw AppException.internal(`Failed to send email: ${error.message}`);
  }
}