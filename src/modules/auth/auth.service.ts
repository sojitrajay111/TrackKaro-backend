import { randomBytes, randomUUID, createHash } from 'crypto';

import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';

import { AppConfig } from '@/config/configuration';
import { parseDurationMs } from '@/common/utils/duration.util';
import { DealsService } from '@/modules/deals/deals.service';
import { PublicUser, UsersService } from '@/modules/users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshToken, RefreshTokenDocument } from './schemas/refresh-token.schema';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: PublicUser;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(RefreshToken.name) private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig>,
    private readonly dealsService: DealsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      phone: dto.phone,
    });
    await this.dealsService.seedDefaultDeals(user._id.toString());

    return this.issueTokenPair(user._id.toString(), this.usersService.toPublicUser(user));
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.issueTokenPair(user._id.toString(), this.usersService.toPublicUser(user));
  }

  async refresh(refreshTokenValue: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshTokenValue);
    const record = await this.refreshTokenModel.findOne({ tokenHash }).exec();

    if (!record) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (record.revoked) {
      // A revoked token being presented again means it was stolen/replayed — kill the whole
      // lineage descended from that login so every device on it is forced to log in again.
      await this.refreshTokenModel
        .updateMany({ familyId: record.familyId }, { revoked: true })
        .exec();
      throw new UnauthorizedException(
        'Refresh token reuse detected. All sessions have been signed out.',
      );
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    const user = await this.usersService.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const tokens = await this.issueTokenPair(
      user._id.toString(),
      this.usersService.toPublicUser(user),
      record.familyId,
    );

    record.revoked = true;
    record.replacedByHash = this.hashToken(tokens.refreshToken);
    await record.save();

    return tokens;
  }

  async logout(refreshTokenValue: string): Promise<{ success: true }> {
    const tokenHash = this.hashToken(refreshTokenValue);
    await this.refreshTokenModel.updateOne({ tokenHash }, { revoked: true }).exec();
    return { success: true };
  }

  private async issueTokenPair(
    userId: string,
    publicUser: PublicUser,
    familyId?: string,
  ): Promise<AuthTokens> {
    const jwtConfig = this.config.get('jwt', { infer: true })!;

    const accessTokenExpiresAt = new Date(Date.now() + parseDurationMs(jwtConfig.accessTtl));
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email: publicUser.email },
      { secret: jwtConfig.accessSecret, expiresIn: jwtConfig.accessTtl },
    );

    const refreshTokenValue = randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(refreshTokenValue);
    const expiresAt = new Date(Date.now() + parseDurationMs(jwtConfig.refreshTtl));

    await this.refreshTokenModel.create({
      userId,
      tokenHash,
      familyId: familyId ?? randomUUID(),
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      user: publicUser,
    };
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
