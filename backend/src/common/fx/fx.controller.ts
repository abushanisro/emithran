import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessToken } from '../decorators/access-token.decorator';
import { FxRateType, FxService } from './fx.service';

@ApiTags('fx')
@ApiBearerAuth()
@Controller({ path: 'api/fx', version: '1' })
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('factory-currency')
  getFactoryCurrency(@Query('location') location: string) {
    if (!location) throw new BadRequestException('location query parameter is required');
    return this.fxService.resolveFactoryCurrency(location);
  }

  @Get('factories')
  listFactories() {
    return this.fxService.listFactories();
  }

  @Get('currencies')
  listCurrencies() {
    return this.fxService.listCurrencies();
  }

  @Get('rate')
  async getRate(
    @Query('base') base: string,
    @Query('quote') quote: string,
    @Query('rateType') rateType: FxRateType = 'reference',
    @Query('customRate') customRate: string | undefined,
    @Query('customReason') customReason: string | undefined,
    @AccessToken() accessToken: string | null,
  ) {
    if (!base || !quote) throw new BadRequestException('base and quote query parameters are required');
    return this.fxService.getRate({
      base,
      quote,
      rateType,
      accessToken,
      customRate: customRate != null ? Number(customRate) : undefined,
      customReason,
    });
  }

  @Post('refresh')
  async refresh(@Body() body: { base?: string; quote?: string }) {
    if (!body?.base || !body?.quote) throw new BadRequestException('base and quote are required');
    return this.fxService.refresh(body.base, body.quote);
  }
}
