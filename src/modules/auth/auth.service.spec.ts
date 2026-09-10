import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';

import configuration from '@/config/configuration';
import { DealsModule } from '@/modules/deals/deals.module';
import { UsersModule } from '@/modules/users/users.module';
import { AuthService } from './auth.service';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';

describe('AuthService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let authService: AuthService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_ACCESS_TTL = '15m';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_REFRESH_TTL = '30d';

    mongod = await MongoMemoryServer.create();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }]),
        JwtModule.register({ secret: 'test-access-secret', signOptions: { expiresIn: '15m' } }),
        UsersModule,
        DealsModule,
      ],
      providers: [AuthService],
    }).compile();

    authService = moduleRef.get(AuthService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  const credentials = { email: 'demo@trackkaro.app', password: 'password123', name: 'Demo User' };

  it('registers a new user and issues a token pair', async () => {
    const tokens = await authService.register(credentials);

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.user.email).toBe(credentials.email);
  });

  it('rejects registering the same email twice', async () => {
    await expect(authService.register(credentials)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects login with the wrong password', async () => {
    await expect(
      authService.login({ email: credentials.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logs in with correct credentials and issues a fresh token pair', async () => {
    const tokens = await authService.login({
      email: credentials.email,
      password: credentials.password,
    });
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('rotates the refresh token on refresh, invalidating the old one', async () => {
    const initial = await authService.login({
      email: credentials.email,
      password: credentials.password,
    });

    const rotated = await authService.refresh(initial.refreshToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);

    // The old (now-revoked) token must no longer work at all.
    await expect(authService.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('detects refresh-token reuse and revokes the entire token family', async () => {
    const initial = await authService.login({
      email: credentials.email,
      password: credentials.password,
    });
    const rotated = await authService.refresh(initial.refreshToken);

    // Replaying the already-consumed `initial` token simulates a stolen token being used
    // after the legitimate client already rotated past it.
    await expect(authService.refresh(initial.refreshToken)).rejects.toThrow(/reuse detected/i);

    // Reuse detection must also revoke the token that was legitimately issued from rotation —
    // the whole family is burned, not just the replayed token.
    await expect(authService.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logout revokes the refresh token', async () => {
    const tokens = await authService.login({
      email: credentials.email,
      password: credentials.password,
    });
    await authService.logout(tokens.refreshToken);

    await expect(authService.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
