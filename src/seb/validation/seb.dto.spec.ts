import { verifyExitSchema } from './seb.dto.js';

describe('SEB exit authorization request', () => {
  const staff = { email: 'invigilator@example.test', password: 'valid-password' };

  it('accepts a session scoped exit request', () => {
    expect(verifyExitSchema.safeParse({
      ...staff,
      sessionToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
    }).success).toBe(true);
  });

  it('accepts a pre-login request scoped by a six-digit exam code', () => {
    expect(verifyExitSchema.safeParse({ ...staff, examOtp: '012345' }).success).toBe(true);
  });

  it('rejects missing, conflicting, and malformed exam authorization contexts', () => {
    expect(verifyExitSchema.safeParse(staff).success).toBe(false);
    expect(verifyExitSchema.safeParse({
      ...staff,
      sessionToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
      examOtp: '012345',
    }).success).toBe(false);
    expect(verifyExitSchema.safeParse({ ...staff, examOtp: 'expired' }).success).toBe(false);
  });
});
