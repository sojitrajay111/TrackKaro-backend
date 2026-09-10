import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  async findById(id: string | Types.ObjectId): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async create(data: { email: string; passwordHash: string; name: string }): Promise<UserDocument> {
    return this.userModel.create(data);
  }

  async updateProfile(userId: string, patch: UpdateProfileDto): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(userId, patch, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  toPublicUser(user: UserDocument): PublicUser {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      phone: user.phone,
    };
  }
}
