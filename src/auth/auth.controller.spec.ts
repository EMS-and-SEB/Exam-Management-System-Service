import { AuthController } from './auth.controller.js';

describe('AuthController shared authentication API', () => {
  function makeController() {
    const authService = {
      login: vi.fn().mockResolvedValue({ accessToken: 'access-token', rawRefreshToken: 'refresh-token', staff: { role: 'STUDENT' } }),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      verifyPasswordReset: vi.fn().mockResolvedValue({ resetToken: 'reset-token' }),
      confirmPasswordReset: vi.fn().mockResolvedValue(undefined),
    };
    const configService = {
      getOrThrow: vi.fn((key: string) => key === 'app.environment' ? 'test' : 60_000),
    };
    return { controller: new AuthController(authService as never, configService as never), authService };
  }

  it('passes student IDs through the existing login handler and returns the normal login response', async () => {
    const { controller, authService } = makeController();
    const response = { cookie: vi.fn() };

    const result = await controller.login(
      { email: 'UGR/1212/16', password: 'student-password' } as never,
      response as never,
    );

    expect(authService.login).toHaveBeenCalledWith('UGR/1212/16', 'student-password');
    expect(result).toEqual({ jwt: 'access-token', staff: { role: 'STUDENT' } });
    expect(response.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', expect.objectContaining({
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth/staff',
    }));
  });

  it('keeps staff email login on the same handler', async () => {
    const { controller, authService } = makeController();

    await controller.login(
      { email: 'staff@aau.edu.et', password: 'staff-password' } as never,
      { cookie: vi.fn() } as never,
    );

    expect(authService.login).toHaveBeenCalledWith('staff@aau.edu.et', 'staff-password');
  });

  it('uses the existing password-reset request endpoint contract for student IDs', async () => {
    const { controller, authService } = makeController();

    await expect(controller.requestPasswordReset({ email: 'UGR/1212/16' } as never)).resolves.toEqual({ sent: true });
    expect(authService.requestPasswordReset).toHaveBeenCalledWith('UGR/1212/16');
    await expect(controller.verifyPasswordReset({ email: 'UGR/1212/16', code: '123456' } as never))
      .resolves.toEqual({ resetToken: 'reset-token' });
    expect(authService.verifyPasswordReset).toHaveBeenCalledWith('UGR/1212/16', '123456');
  });
});
