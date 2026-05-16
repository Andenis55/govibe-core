import { JwtService } from '@nestjs/jwt';
import { AuthAuditAction, SessionStatus } from '@prisma/client';
import request = require('supertest');
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
} from '../setup/operational-runtime';
import { SessionService } from '../../src/auth/session.service';
import { UsersService } from '../../src/users/users.service';

describe('Auth integration', () => {
  let runtime: OperationalRuntime | null = null;

  beforeAll(async () => {
    try {
      runtime = await createOperationalRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  async function signupAndLoginCustomer(
    email: string,
    deviceId = 'device-a',
  ): Promise<request.Response> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'Password1',
        deviceId,
      })
      .expect(201);

    return request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password: 'Password1',
        deviceId,
      })
      .expect(201);
  }

  it('signup creates customer session, tokens, and audit log while ignoring role escalation', async () => {
    if (!runtime) {
      return;
    }

    const signup = await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'customer@example.com',
        password: 'Password1',
        deviceId: 'signup-device',
        role: 'ADMIN',
      })
      .expect(201);

    expect(signup.body.user.role).toBe('CUSTOMER');
    expect(signup.body.session.id).toBeDefined();
    expect(signup.body.tokens.accessToken).toBeDefined();
    expect(signup.body.tokens.refreshToken).toBeDefined();

    const actions = await runtime.prisma.authAuditLog.findMany({
      where: {
        email: 'customer@example.com',
      },
    });

    expect(actions.some((item) => item.action === AuthAuditAction.SIGNUP)).toBe(true);
  });

  it('signs up, logs in, refreshes, and logs out', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('user@example.com');

    expect(login.body.tokens.accessToken).toBeDefined();
    expect(login.body.tokens.refreshToken).toBeDefined();

    const accessToken = login.body.tokens.accessToken as string;
    const refreshToken = login.body.tokens.refreshToken as string;

    await request(runtime.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.user.email).toBe('user@example.com');
        expect(response.body.session.id).toBe(login.body.session.id);
      });

    const meLogs = await runtime.prisma.authAuditLog.findMany({
      where: {
        email: 'user@example.com',
        action: AuthAuditAction.ME_ACCESSED,
      },
    });

    expect(meLogs.length).toBeGreaterThan(0);

    const refresh = await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken,
        deviceId: 'device-a',
      })
      .expect(201);

    expect(refresh.body.tokens.accessToken).toBeDefined();
    expect(refresh.body.tokens.refreshToken).toBeDefined();

    const logout = await request(runtime.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${refresh.body.tokens.accessToken}`)
      .send({ reason: 'user_logout' })
      .expect(201);

    expect(logout.body.success).toBe(true);
  });

  it('blocks protected route without access token', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('invalid access token is rejected', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer bad.token.value')
      .expect(401);
  });

  it('expired access token is rejected', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('expire-access@example.com');
    const user = login.body.user as {
      id: string;
      email: string;
      role: string;
    };
    const sessionId = login.body.session.id as string;
    const jwtService = runtime.app.get(JwtService);

    const expiredToken = await jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        sessionId,
        jti: 'expired-jti',
        type: 'access',
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: -1,
      },
    );

    await request(runtime.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
  });

  it('invalid refresh token is rejected and audit logged', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: 'bad.token.value',
        deviceId: 'device-a',
      })
      .expect(401);

    const failureLogs = await runtime.prisma.authAuditLog.findMany({
      where: { action: AuthAuditAction.AUTH_FAILURE },
    });

    expect(failureLogs.length).toBeGreaterThan(0);
    expect(failureLogs.some((item) => item.reason === 'invalid refresh token')).toBe(true);
  });

  it('enforces role protection', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('rolecheck@example.com');

    await request(runtime.app.getHttpServer())
      .get('/auth/organizer-only')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(403);
  });

  it('permission-protected route passes correct user', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('perm@example.com');

    await request(runtime.app.getHttpServer())
      .get('/auth/customer-only')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(200);
  });

  it('device mismatch refresh is rejected', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('device@example.com');
    const sessionId = login.body.session.id as string;

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: login.body.tokens.refreshToken,
        deviceId: 'other-device',
      })
      .expect(401);

    const session = await runtime.prisma.session.findUnique({
      where: { id: sessionId },
    });
    const replayLogs = await runtime.prisma.authAuditLog.findMany({
      where: {
        action: AuthAuditAction.REFRESH_REPLAY_DETECTED,
        email: 'device@example.com',
      },
    });

    expect(session?.status).toBe(SessionStatus.REVOKED);
    expect(session?.revokedReason).toBe('device_mismatch');
    expect(
      replayLogs.some(
        (item) => (item.metadata as { reason?: string } | null)?.reason === 'device_mismatch',
      ),
    ).toBe(true);
  });

  it('revoked session refresh is rejected and audit logged', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('revoked@example.com');

    const accessToken = login.body.tokens.accessToken as string;
    const refreshToken = login.body.tokens.refreshToken as string;

    await request(runtime.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken,
        deviceId: 'device-a',
      })
      .expect(401);

    const failureLogs = await runtime.prisma.authAuditLog.findMany({
      where: {
        action: AuthAuditAction.AUTH_FAILURE,
        email: 'revoked@example.com',
      },
    });

    expect(failureLogs.length).toBeGreaterThan(0);
  });

  it('expired session refresh is rejected and session is marked EXPIRED', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('expired-session@example.com');
    const sessionId = login.body.session.id as string;
    const refreshToken = login.body.tokens.refreshToken as string;

    await runtime.prisma.session.update({
      where: { id: sessionId },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken,
        deviceId: 'device-a',
      })
      .expect(401);

    const session = await runtime.prisma.session.findUnique({
      where: { id: sessionId },
    });

    const expiredLogs = await runtime.prisma.authAuditLog.findMany({
      where: {
        email: 'expired-session@example.com',
        action: AuthAuditAction.EXPIRED_SESSION_DETECTED,
      },
    });

    expect(session?.status).toBe(SessionStatus.EXPIRED);
    expect(expiredLogs.length).toBeGreaterThan(0);
  });

  it('inactive user login is rejected', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'inactive@example.com',
        password: 'Password1',
        deviceId: 'device-a',
      })
      .expect(201);

    const user = await runtime.prisma.user.findUnique({
      where: { email: 'inactive@example.com' },
    });
    const usersService = runtime.app.get(UsersService);
    await usersService.setActive(user!.id, false);

    await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'inactive@example.com',
        password: 'Password1',
        deviceId: 'device-a',
      })
      .expect(401);
  });

  it('login without deviceId is rejected with 400', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'nodevice@example.com',
        password: 'Password1',
        deviceId: 'device-a',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'nodevice@example.com',
        password: 'Password1',
      })
      .expect(400);
  });

  it('expired session blocks access token and session is marked EXPIRED', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('expired-access-session@example.com');
    const sessionId = login.body.session.id as string;
    const accessToken = login.body.tokens.accessToken as string;

    await runtime.prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(runtime.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    const session = await runtime.prisma.session.findUnique({
      where: { id: sessionId },
    });

    expect(session?.status).toBe(SessionStatus.EXPIRED);
  });

  it('duplicate signup is rejected', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'dup@example.com',
        password: 'Password1',
        deviceId: 'device-a',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'dup@example.com',
        password: 'Password1',
        deviceId: 'device-b',
      })
      .expect(409);
  });

  it('explicit revoke-session works', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('revoke@example.com');
    const accessToken = login.body.tokens.accessToken as string;
    const sessionId = login.body.session.id as string;

    await request(runtime.app.getHttpServer())
      .post('/auth/revoke-session')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sessionId,
        reason: 'user_requested_revoke',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: login.body.tokens.refreshToken,
        deviceId: 'device-a',
      })
      .expect(401);
  });

  it('user can revoke a second session they own while current session remains valid', async () => {
    if (!runtime) {
      return;
    }

    const loginA = await signupAndLoginCustomer('multisession@example.com', 'device-a');
    const loginB = await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'multisession@example.com',
        password: 'Password1',
        deviceId: 'device-b',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/revoke-session')
      .set('Authorization', `Bearer ${loginA.body.tokens.accessToken}`)
      .send({
        sessionId: loginB.body.session.id,
        reason: 'revoke_second_session',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: loginB.body.tokens.refreshToken,
        deviceId: 'device-b',
      })
      .expect(401);

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: loginA.body.tokens.refreshToken,
        deviceId: 'device-a',
      })
      .expect(201);
  });

  it('repeated logout is deterministic', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('repeat-logout@example.com');
    const accessToken = login.body.tokens.accessToken as string;

    await request(runtime.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'repeat_logout' })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'repeat_logout' })
      .expect(401);
  });

  it('repeated revoke-session is deterministic', async () => {
    if (!runtime) {
      return;
    }

    const loginA = await signupAndLoginCustomer('repeat-revoke@example.com', 'device-a');
    const loginB = await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'repeat-revoke@example.com',
        password: 'Password1',
        deviceId: 'device-b',
      })
      .expect(201);

    const revokeRequest = {
      sessionId: loginB.body.session.id,
      reason: 'repeat_revoke',
    };

    await request(runtime.app.getHttpServer())
      .post('/auth/revoke-session')
      .set('Authorization', `Bearer ${loginA.body.tokens.accessToken}`)
      .send(revokeRequest)
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/revoke-session')
      .set('Authorization', `Bearer ${loginA.body.tokens.accessToken}`)
      .send(revokeRequest)
      .expect(201);
  });

  it('service-level repeated revoke is idempotent', async () => {
    if (!runtime) {
      return;
    }

    const loginA = await signupAndLoginCustomer('service-repeat@example.com', 'device-a');
    const loginB = await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'service-repeat@example.com',
        password: 'Password1',
        deviceId: 'device-b',
      })
      .expect(201);

    const sessionService = runtime.app.get(SessionService);
    const params = {
      requesterUserId: loginA.body.user.id as string,
      sessionId: loginB.body.session.id as string,
      reason: 'service_repeat_revoke',
    };

    await expect(sessionService.revokeSession(params)).resolves.toMatchObject({
      id: loginB.body.session.id,
    });
    await expect(sessionService.revokeSession(params)).resolves.toMatchObject({
      id: loginB.body.session.id,
    });
  });

  it('cross-user revoke is forbidden without elevated permission', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('owner-revoke@example.com', 'device-a');
    const attacker = await signupAndLoginCustomer('attacker-revoke@example.com', 'device-b');

    await request(runtime.app.getHttpServer())
      .post('/auth/revoke-session')
      .set('Authorization', `Bearer ${attacker.body.tokens.accessToken}`)
      .send({
        sessionId: owner.body.session.id,
        reason: 'cross_user_revoke',
      })
      .expect(403);
  });

  it('replay of previous refresh token revokes session and is audit logged', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('replay@example.com');
    const oldRefreshToken = login.body.tokens.refreshToken as string;
    const sessionId = login.body.session.id as string;

    // Rotate once to make oldRefreshToken the previous token
    const rotated = await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: oldRefreshToken,
        deviceId: 'device-a',
      })
      .expect(201);

    const newAccessToken = rotated.body.tokens.accessToken as string;

    // Replay the old refresh token — should revoke session
    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: oldRefreshToken,
        deviceId: 'device-a',
      })
      .expect(401);

    // Session should be REVOKED with replay reason and hashes cleared
    const session = await runtime.prisma.session.findUnique({
      where: { id: sessionId },
    });

    expect(session?.status).toBe(SessionStatus.REVOKED);
    expect(session?.revokedReason).toBe('rotated_refresh_token_reused');
    expect(session?.refreshTokenHash).toBeNull();
    expect(session?.previousRefreshTokenHash).toBeNull();

    // New access token from the rotation is also blocked (session revoked)
    await request(runtime.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(401);

    // Audit log should contain REFRESH_REPLAY_DETECTED
    const replayLogs = await runtime.prisma.authAuditLog.findMany({
      where: {
        action: AuthAuditAction.REFRESH_REPLAY_DETECTED,
        email: 'replay@example.com',
      },
    });

    expect(replayLogs.length).toBeGreaterThan(0);
    expect(
      replayLogs.some(
        (item) =>
          (item.metadata as { reason?: string } | null)?.reason ===
          'rotated_refresh_token_reused',
      ),
    ).toBe(true);
  });

  it('audit logs are created for success and failure flows', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'audit@example.com',
        password: 'Password1',
        deviceId: 'device-a',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'audit@example.com',
        password: 'WrongPassword1',
        deviceId: 'device-a',
      })
      .expect(401);

    const login = await request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'audit@example.com',
        password: 'Password1',
        deviceId: 'device-a',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: login.body.tokens.refreshToken,
        deviceId: 'device-a',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: login.body.tokens.refreshToken,
        deviceId: 'device-a',
      })
      .expect(401);

    const actions = await runtime.prisma.authAuditLog.findMany({
      where: {
        email: 'audit@example.com',
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(actions.some((item) => item.action === AuthAuditAction.SIGNUP)).toBe(true);
    expect(actions.some((item) => item.action === AuthAuditAction.AUTH_FAILURE)).toBe(true);
    expect(actions.some((item) => item.action === AuthAuditAction.LOGIN)).toBe(true);
    expect(actions.some((item) => item.action === AuthAuditAction.REFRESH)).toBe(true);
    expect(actions.some((item) => item.action === AuthAuditAction.LOGOUT)).toBe(true);
  });
});