import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const loginSchema = z.object({
  // Keep the established request property while allowing a student ID in it.
  email: z.string().refine(
    (identifier) => /^UGR\/\d{4}\/\d{2}$/i.test(identifier.trim()) || z.email().safeParse(identifier).success,
    'Enter a valid email address or undergraduate student ID.',
  ),
  password: z.string().min(1, 'Password is required.'),
});
export class LoginDto extends createZodDto(loginSchema) {}

const accountIdentifierSchema = z.string().refine(
  (identifier) => /^UGR\/\d{4}\/\d{2}$/i.test(identifier.trim()) || z.email().safeParse(identifier).success,
  'Enter a valid email address or undergraduate student ID.',
);

export const passwordResetRequestSchema = z.object({ email: accountIdentifierSchema });
export class PasswordResetRequestDto extends createZodDto(passwordResetRequestSchema) {}

export const passwordResetVerifySchema = z.object({
  email: accountIdentifierSchema,
  code: z.string().length(6),
});
export class PasswordResetVerifyDto extends createZodDto(passwordResetVerifySchema) {}

export const passwordResetConfirmSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
});
export class PasswordResetConfirmDto extends createZodDto(passwordResetConfirmSchema) {}

export const staffInvitationSchema = z.object({
  token: z.string().min(1),
});
export class StaffInvitationDto extends createZodDto(staffInvitationSchema) {}

export const staffInvitationCompleteSchema = staffInvitationSchema.extend({
  newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
});
export class StaffInvitationCompleteDto extends createZodDto(staffInvitationCompleteSchema) {}

export const studentActivationRequestSchema = z.object({
  studentId: z.string().trim().regex(/^UGR\/\d{4}\/\d{2}$/i, 'Enter a valid undergraduate student ID.'),
});
export class StudentActivationRequestDto extends createZodDto(studentActivationRequestSchema) {}
