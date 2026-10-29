import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface User { id: string; email: string; [key: string]: unknown }

@ApiTags('Auth')
@ApiBearerAuth()
@Controller({ path: 'api/auth', version: '1' })
export class AuthController {
  /**
   * Who am I. The app-wide guard has already refused anyone who is not signed in or not invited (401/403), so reaching this
   * means the login is good: the sign-in callback calls it to learn whether to let the person in.
   */
  @Get('me')
  @ApiOperation({ summary: 'The signed-in, authorised user' })
  me(@CurrentUser() user: User): { id: string; email: string } {
    return { id: user.id, email: user.email };
  }
}
