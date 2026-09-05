import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const SALT_ROUNDS = 10;

export const bcryptHash = (value: string) => bcrypt.hash(value, SALT_ROUNDS);
export const bcryptCompare = (value: string, hash: string) => bcrypt.compare(value, hash);
export const sha256Hash = (value: string) => createHash('sha256').update(value).digest('hex');