import { SebController } from './seb.controller.js';
import type { VerifyExitDto } from './validation/seb.dto.js';

describe('SEB invigilator return authorization', () => {
  it('authorizes return for an active exam session without force-submitting it', async () => {
    const authService = { authenticateAssignedInvigilator: vi.fn().mockResolvedValue({ id: 'invigilator-id' }) };
    const sessionsService = { exitByAuthorizedInvigilator: vi.fn() };
    const controller = new SebController(authService as never, sessionsService as never);

    await expect(controller.verifyReturn({
      sessionToken: 'session-id',
      email: 'invigilator@example.test',
      password: 'password',
    } as VerifyExitDto)).resolves.toEqual({ authorized: true });

    expect(authService.authenticateAssignedInvigilator).toHaveBeenCalledWith(
      'session-id', 'invigilator@example.test', 'password', 'return-to-login',
    );
    expect(sessionsService.exitByAuthorizedInvigilator).not.toHaveBeenCalled();
  });

  it('authorizes return before login using the exam access code', async () => {
    const authService = { authenticateAssignedInvigilatorForExamOtp: vi.fn().mockResolvedValue({ id: 'invigilator-id' }) };
    const controller = new SebController(authService as never, {} as never);

    await expect(controller.verifyReturn({
      examOtp: '123456',
      email: 'invigilator@example.test',
      password: 'password',
    } as VerifyExitDto)).resolves.toEqual({ authorized: true });

    expect(authService.authenticateAssignedInvigilatorForExamOtp).toHaveBeenCalledWith(
      '123456', 'invigilator@example.test', 'password', 'return-to-login',
    );
  });
});
