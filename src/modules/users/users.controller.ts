import { Body, Controller, Patch } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  async updateMe(@CurrentUser() principal: CurrentUserPayload, @Body() dto: UpdateProfileDto) {
    const user = await this.usersService.updateProfile(principal.userId, dto);
    return this.usersService.toPublicUser(user);
  }
}
