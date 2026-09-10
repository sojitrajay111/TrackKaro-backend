import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

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
  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async create(
    userId: string,
    data: { title: string; message: string; type: NotificationType },
  ): Promise<void> {
    await this.notificationModel.create({ userId, ...data });
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
