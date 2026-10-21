import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const handshakeSchema = z.object({ clientVersion: z.string().min(1) });
export class HandshakeDto extends createZodDto(handshakeSchema) {}

export const verifyExitSchema = z.object({
  sessionToken: z.uuid().optional(),
  examOtp: z.string().regex(/^\d{6}$/).optional(),
  email: z.email(),
  password: z.string().min(1).max(256),
}).refine((value) => Boolean(value.sessionToken) !== Boolean(value.examOtp), {
  message: 'Provide either a session token or an exam access code.',
});
export class VerifyExitDto extends createZodDto(verifyExitSchema) {}
