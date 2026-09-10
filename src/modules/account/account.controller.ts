import { Controller, Delete, HttpCode, HttpStatus } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { AccountService } from './account.service';

@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Delete('data')
  @HttpCode(HttpStatus.OK)
  async deleteAllData(@CurrentUser() user: CurrentUserPayload) {
    await this.accountService.deleteAllData(user.userId);
    return { success: true };
  }
}
