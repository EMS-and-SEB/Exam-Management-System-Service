import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required.'),
});
export class LoginDto extends createZodDto(loginSchema) {}

export const passwordResetRequestSchema = z.object({ email: z.email() });
export class PasswordResetRequestDto extends createZodDto(passwordResetRequestSchema) {}

export const passwordResetVerifySchema = z.object({
  email: z.email(),
  code: z.string().length(6),
});
export class PasswordResetVerifyDto extends createZodDto(passwordResetVerifySchema) {}

export const passwordResetConfirmSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
});
export class PasswordResetConfirmDto extends createZodDto(passwordResetConfirmSchema) {}