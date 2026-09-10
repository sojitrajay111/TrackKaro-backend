import { Body, Controller, Get, NotFoundException, Patch } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() principal: CurrentUserPayload) {
    const user = await this.usersService.findById(principal.userId);
    if (!user) throw new NotFoundException('User not found');
    return this.usersService.toPublicUser(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() principal: CurrentUserPayload, @Body() dto: UpdateProfileDto) {
    const user = await this.usersService.updateProfile(principal.userId, dto);
    return this.usersService.toPublicUser(user);
  }
}
