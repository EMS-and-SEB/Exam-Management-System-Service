import { randomBytes, randomInt } from 'crypto';

export const generateOtp = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');
export const generateOpaqueToken = (): string => randomBytes(64).toString('hex');