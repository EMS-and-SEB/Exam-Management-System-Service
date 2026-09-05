import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EmailProvider, SendEmailParams } from '../email.interface.js';

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService) {
    this.from = configService.getOrThrow<string>('email.from');
    this.transporter = createTransport({
      host: configService.getOrThrow<string>('email.smtp.host'),
      port: configService.getOrThrow<number>('email.smtp.port'),
      secure: false,
    });
  }

  async send({ to, subject, html }: SendEmailParams): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, html });
  }
}