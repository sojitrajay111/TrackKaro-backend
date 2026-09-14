import { Body, Controller, Post } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
import { ScanBillDto } from './dto/scan-bill.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SmartParseDto } from './dto/smart-parse.dto';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('messages')
  sendMessage(@CurrentUser() user: CurrentUserPayload, @Body() dto: SendMessageDto) {
    return this.assistantService.generateReply(user.userId, dto.text);
  }

  @Post('scan-bill')
  scanBill(@CurrentUser() _user: CurrentUserPayload, @Body() dto: ScanBillDto) {
    return this.assistantService.scanBill(dto.imageBase64, dto.mimeType);
  }

  @Post('smart-parse')
  smartParse(@CurrentUser() user: CurrentUserPayload, @Body() dto: SmartParseDto) {
    return this.assistantService.parseAndProcessVoice(user.userId, dto.text, dto.mode, dto.autoSave);
  }
}
