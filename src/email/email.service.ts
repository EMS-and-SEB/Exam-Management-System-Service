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

  async sendExamInquiry(params: {
    to: string;
    recipientName: string;
    studentName: string;
    studentId: string;
    examTitle: string;
    courseOrCohortName: string;
    isOnRoster: boolean;
    subject: string;
    message: string;
  }): Promise<void> {
    const escape = (str: string) =>
      str.replace(/[&<>'"]/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[ch] ?? ch);

    const safeRecipient = escape(params.recipientName);
    const safeStudent = escape(params.studentName);
    const safeStudentId = escape(params.studentId);
    const safeExam = escape(params.examTitle);
    const safeContext = escape(params.courseOrCohortName);
    const safeSubject = escape(params.subject);
    const safeMessage = escape(params.message).replace(/\n/g, '<br/>');
    const rosterStatus = params.isOnRoster ? 'Yes' : 'No';

    const html = `
      <p>Hello ${safeRecipient},</p>
      <p>A student has submitted an exam inquiry:</p>
      <ul>
        <li><strong>Student ID:</strong> ${safeStudentId}</li>
        <li><strong>Student Name:</strong> ${safeStudent}</li>
        <li><strong>Exam:</strong> ${safeExam}</li>
        <li><strong>Course / Cohort:</strong> ${safeContext}</li>
        <li><strong>On Roster:</strong> ${rosterStatus}</li>
      </ul>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Message:</strong></p>
      <blockquote>${safeMessage}</blockquote>
    `;

    await this.provider.send({
      to: params.to,
      subject: `[Exam Inquiry] ${safeSubject}`,
      html,
    });
  }
}