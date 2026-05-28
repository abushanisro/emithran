interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RequestLogsService } from '../services/request-logs.service';
import { QueryLogsDto, RequestLogDto, LogStatsDto } from '../dto/request-log.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';

@ApiTags('Developer - Logs')
@ApiBearerAuth()
@Controller({ path: 'api/developer/logs', version: '1' })
export class RequestLogsController {
  constructor(private readonly requestLogsService: RequestLogsService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated request logs for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Logs retrieved' })
  async findAll(
    @Query() query: QueryLogsDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<{ logs: RequestLogDto[]; total: number }> {
    return this.requestLogsService.findAll(user.id, token, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get request statistics for the last 30 days' })
  @ApiResponse({ status: 200, description: 'Stats retrieved' })
  async getStats(
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<LogStatsDto> {
    return this.requestLogsService.getStats(user.id, token);
  }
}
