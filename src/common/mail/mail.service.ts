import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { AppConfig } from '@/config/configuration';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService<AppConfig>) {}

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const { user, passcode } = this.config.get('email', { infer: true })!;
    if (!user || !passcode) {
      throw new ServiceUnavailableException(
        'Email service is not configured. Set EMAIL_USER and EMAIL_PASSCODE in the backend .env.',
      );
    }

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass: passcode },
    });
    return this.transporter;
  }

  async sendPasswordResetOtp(to: string, otp: string): Promise<void> {
    const { user } = this.config.get('email', { infer: true })!;
    const transporter = this.getTransporter();

    await transporter.sendMail({
      from: `"TrackKaro" <${user}>`,
      to,
      subject: 'Your TrackKaro password reset code',
      text: `Your TrackKaro password reset code is ${otp}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px; color: #0F172A;">
          <h2 style="color: #059669; margin-bottom: 4px;">TrackKaro</h2>
          <p>Use this code to reset your password. It expires in <strong>10 minutes</strong>.</p>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; background: #E8F7F0; color: #059669; padding: 16px; border-radius: 12px; text-align: center; margin: 16px 0;">
            ${otp}
          </div>
          <p style="color: #64748B; font-size: 13px;">If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
        </div>
      `,
    });

    this.logger.log(`Password reset OTP sent to ${to}`);
  }
}
