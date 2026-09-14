import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const handshakeSchema = z.object({ clientVersion: z.string().min(1) });
export class HandshakeDto extends createZodDto(handshakeSchema) {}