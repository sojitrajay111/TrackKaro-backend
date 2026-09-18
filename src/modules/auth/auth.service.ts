import { randomBytes, randomInt, randomUUID, createHash } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';

import { AppConfig } from '@/config/configuration';
import { parseDurationMs } from '@/common/utils/duration.util';
import { MailService } from '@/common/mail/mail.service';
import { DealsService } from '@/modules/deals/deals.service';
import { PublicUser, UsersService } from '@/modules/users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshToken, RefreshTokenDocument } from './schemas/refresh-token.schema';
import { MAX_VERIFY_ATTEMPTS, PasswordResetOtp, PasswordResetOtpDocument } from './schemas/password-reset-otp.schema';

const OTP_TTL_MS = 10 * 60 * 1000;

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
    @InjectModel(PasswordResetOtp.name) private readonly passwordResetOtpModel: Model<PasswordResetOtpDocument>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig>,
    private readonly dealsService: DealsService,
    private readonly mailService: MailService,
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

  async logoutAll(userId: string): Promise<{ success: true }> {
    await this.refreshTokenModel.updateMany({ userId: new Types.ObjectId(userId) }, { revoked: true }).exec();
    return { success: true };
  }

  /** Always reports success regardless of whether the email exists, so this endpoint can't be
   * used to enumerate registered accounts. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ success: true }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(email);

    if (user) {
      const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await this.passwordResetOtpModel.deleteMany({ email }).exec();
      await this.passwordResetOtpModel.create({
        email,
        otpHash: this.hashToken(otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      });
      await this.mailService.sendPasswordResetOtp(email, otp);
    }

    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
    const email = dto.email.toLowerCase().trim();
    const record = await this.passwordResetOtpModel.findOne({ email }).exec();

    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This code is invalid or has expired. Request a new one.');
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      await record.deleteOne();
      throw new HttpException('Too many incorrect attempts. Request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (record.otpHash !== this.hashToken(dto.otp)) {
      record.attempts += 1;
      await record.save();
      throw new BadRequestException('Incorrect code. Please try again.');
    }

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // The OTP was issued for this email, so the user existed a moment ago — treat as invalid
      // rather than leaking anything more specific.
      throw new BadRequestException('This code is invalid or has expired. Request a new one.');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await user.save();

    await record.deleteOne();
    // Resetting the password signs every device out — otherwise a stolen refresh token would
    // survive the very reset meant to lock an attacker out.
    await this.refreshTokenModel.updateMany({ userId: user._id }, { revoked: true }).exec();

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
