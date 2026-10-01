import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email.interface.js';

/** Escapes characters that have special meaning in HTML. */
function escapeHtml(raw: string): string {
  return raw.replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[ch] ?? ch);
}

export interface ExamInquiryParams {
  to: string;
  recipientName: string;
  studentName: string;
  studentId: string;
  examTitle: string;
  courseOrCohortName: string;
  isOnRoster: boolean;
  subject: string;
  message: string;
}

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
    const safeName = escapeHtml(name);
    await this.provider.send({
      to,
      subject: 'Set up your exam management account',
      html: `<p>Hello ${safeName},</p><p>Your exam management account has been created. Use the link below to set your password:</p><p><a href="${invitationUrl}">Set your password</a></p><p>This link expires in 24 hours and can only be used once.</p>`,
    });
  }

  async sendExamInquiry(params: ExamInquiryParams): Promise<void> {
    const {
      to,
      recipientName,
      studentName,
      studentId,
      examTitle,
      courseOrCohortName,
      isOnRoster,
      subject,
      message,
    } = params;

    // Sanitize all user-supplied strings before embedding in HTML.
    const safeRecipient = escapeHtml(recipientName);
    const safeStudentName = escapeHtml(studentName);
    const safeStudentId = escapeHtml(studentId);
    const safeExamTitle = escapeHtml(examTitle);
    const safeContext = escapeHtml(courseOrCohortName);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    const rosterBadge = isOnRoster
      ? `<span style="color:#16a34a;font-weight:bold;">✓ On Roster</span>`
      : `<span style="color:#dc2626;font-weight:bold;">✗ NOT on Roster</span>`;

    const html = `
<p>Dear ${safeRecipient},</p>

<p>A student has submitted an inquiry regarding an upcoming exam. Details are below.</p>

<table style="border-collapse:collapse;width:100%;max-width:560px;font-family:sans-serif;font-size:14px;">
  <tr>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:40%;">Student Name</td>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;">${safeStudentName}</td>
  </tr>
  <tr>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;">Student ID</td>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;">${safeStudentId}</td>
  </tr>
  <tr>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;">Exam</td>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;">${safeExamTitle}</td>
  </tr>
  <tr>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;">Course / Cohort</td>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;">${safeContext}</td>
  </tr>
  <tr>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;">Roster Status</td>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;">${rosterBadge}</td>
  </tr>
  <tr>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;">Subject</td>
    <td style="padding:6px 12px;border:1px solid #e5e7eb;">${safeSubject}</td>
  </tr>
</table>

<p style="margin-top:16px;font-weight:bold;">Student Message:</p>
<blockquote style="margin:8px 0;padding:12px 16px;border-left:4px solid #6b7280;background:#f9fafb;font-family:sans-serif;font-size:14px;">
  ${safeMessage}
</blockquote>

<p style="color:#6b7280;font-size:12px;margin-top:24px;">
  This message was sent via the Student Portal. Please reply directly to the student
  if further information is needed.
</p>
`.trim();

    await this.provider.send({ to, subject: `[Student Inquiry] ${safeSubject}`, html });
  }
}