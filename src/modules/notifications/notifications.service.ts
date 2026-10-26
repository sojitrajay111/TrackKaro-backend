import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { Model } from 'mongoose';

import type { AppConfig } from '@/config/configuration';
import { PushPlatform, User, UserDocument } from '@/modules/users/schemas/user.schema';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

export interface PublicNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
}

/** Devices remembered per user (phones, reinstalls). */
const MAX_TOKENS = 10;
/** FCM errors that mean the token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Firebase app used for FCM; null when the service account isn't configured (push off). */
  private readonly firebase: App | null;

  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    // Optional so modules built without ConfigModule (e.g. unit tests) still resolve; push is then off.
    @Optional() configService?: ConfigService<AppConfig>,
  ) {
    this.firebase = this.initFirebase(configService?.get('firebase', { infer: true }));
  }

  private initFirebase(creds?: AppConfig['firebase']): App | null {
    if (!creds?.projectId || !creds.clientEmail || !creds.privateKey) return null;
    try {
      // Serverless instances can construct this service more than once; reuse the app.
      return getApps().length ? getApp() : initializeApp({ credential: cert(creds) });
    } catch (err: any) {
      this.logger.warn(`Push disabled, Firebase credentials rejected: ${err.message}`);
      return null;
    }
  }

  async create(
    userId: string,
    data: { title: string; message: string; type: NotificationType },
  ): Promise<void> {
    await this.notificationModel.create({ userId, ...data });

    // Push to the user's devices. Awaited (not fire-and-forget) because a serverless instance
    // may be frozen once the response is sent; a push failure never fails the caller.
    await this.dispatchPushToUser(userId, data.title, data.message, { type: data.type }).catch(
      (err) => {
        this.logger.warn(`Failed to dispatch remote push: ${err.message}`);
      },
    );
  }

  /** Saves this device's FCM token (one entry per token; the newest few are kept). */
  async registerPushToken(
    userId: string,
    token: string,
    platform: PushPlatform = 'android',
  ): Promise<void> {
    const clean = token?.trim();
    if (!clean) return;
    // A device belongs to whoever signed in on it last: take the token off every account
    // (including an older copy on this one) before adding it here.
    await this.userModel
      .updateMany({ 'fcmTokens.token': clean }, { $pull: { fcmTokens: { token: clean } } })
      .exec();
    await this.userModel
      .updateOne(
        { _id: userId },
        // $slice keeps the newest MAX_TOKENS so a long-lived account can't grow this forever.
        {
          $push: {
            fcmTokens: {
              $each: [{ token: clean, platform, updatedAt: new Date() }],
              $slice: -MAX_TOKENS,
            },
          },
        },
      )
      .exec();
  }

  /** Forgets a device's token (log out, or the user turned notifications off). */
  async removePushToken(userId: string, token: string): Promise<void> {
    if (!token) return;
    await this.userModel
      .updateOne({ _id: userId }, { $pull: { fcmTokens: { token: token.trim() } } })
      .exec();
  }

  private async dispatchPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.firebase) return;
    const user = await this.userModel.findById(userId).select('fcmTokens').lean().exec();
    const tokens = (user?.fcmTokens ?? []).map((t) => t.token).filter(Boolean);
    if (tokens.length === 0) return;

    const res = await getMessaging(this.firebase).sendEachForMulticast({
      tokens,
      notification: { title, body },
      // `open` tells the app what to show when the notification is tapped.
      data: { ...data, open: 'notifications' },
      android: {
        priority: 'high',
        notification: { channelId: 'default', color: '#10B981', sound: 'default' },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    // Forget tokens FCM says are dead (app uninstalled, token rotated).
    const dead = res.responses
      .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code ?? '') ? tokens[i] : null))
      .filter((t): t is string => Boolean(t));
    if (dead.length) {
      await this.userModel
        .updateOne({ _id: userId }, { $pull: { fcmTokens: { token: { $in: dead } } } })
        .exec();
    }
    if (res.failureCount > dead.length) {
      this.logger.warn(
        `FCM: ${res.failureCount - dead.length} of ${tokens.length} sends failed for user ${userId}`,
      );
    }
  }

  async findAll(userId: string): Promise<PublicNotification[]> {
    const docs = await this.notificationModel.find({ userId }).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async markRead(userId: string, id: string): Promise<PublicNotification> {
    const doc = await this.notificationModel
      .findOneAndUpdate({ _id: id, userId }, { read: true }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException('Notification not found');
    return this.toPublic(doc);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany({ userId, read: false }, { read: true }).exec();
  }

  async clearAll(userId: string): Promise<void> {
    await this.notificationModel.deleteMany({ userId }).exec();
  }

  private toPublic(doc: NotificationDocument): PublicNotification {
    return {
      id: doc._id.toString(),
      title: doc.title,
      message: doc.message,
      type: doc.type,
      read: doc.read,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
