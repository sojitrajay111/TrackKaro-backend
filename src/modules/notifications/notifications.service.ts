import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument } from '@/modules/users/schemas/user.schema';
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

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async create(
    userId: string,
    data: { title: string; message: string; type: NotificationType },
  ): Promise<void> {
    await this.notificationModel.create({ userId, ...data });

    // Asynchronously dispatch Expo push notification to user's registered devices
    void this.dispatchPushToUser(userId, data.title, data.message, { type: data.type }).catch(
      (err) => {
        this.logger.warn(`Failed to dispatch remote push: ${err.message}`);
      },
    );
  }

  async registerPushToken(userId: string, token: string): Promise<void> {
    if (!token || typeof token !== 'string') return;
    const cleanToken = token.trim();
    if (!cleanToken.startsWith('ExponentPushToken') && !cleanToken.startsWith('ExpoPushToken')) {
      return;
    }
    await this.userModel.updateOne(
      { _id: userId },
      { $addToSet: { pushTokens: cleanToken } },
    ).exec();
  }

  private async dispatchPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).select('pushTokens').lean().exec();
    if (!user || !user.pushTokens || user.pushTokens.length === 0) return;

    const validTokens = user.pushTokens.filter(
      (t) => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'),
    );
    if (validTokens.length === 0) return;

    const messages = validTokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data,
    }));

    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });
    } catch (err: any) {
      this.logger.warn(`Expo push dispatch network error: ${err.message}`);
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
