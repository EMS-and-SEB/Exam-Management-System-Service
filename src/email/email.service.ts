import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email.interface.js';

@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  async sendPasswordResetOtp(to: string, otp: string): Promise<void> {
    await this.provider.send({
      to,
      subject: 'Your password reset code',
      html: `<p>Your password reset code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    });
  }

  async sendStaffInvitation(to: string, name: string, invitationUrl: string): Promise<void> {
    const safeName = name.replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    })[character] ?? character);
    await this.provider.send({
      to,
      subject: 'Set up your exam management account',
      html: `<p>Hello ${safeName},</p><p>Your exam management account has been created. Use the link below to set your password:</p><p><a href="${invitationUrl}">Set your password</a></p><p>This link expires in 24 hours and can only be used once.</p>`,
    });
  }
}