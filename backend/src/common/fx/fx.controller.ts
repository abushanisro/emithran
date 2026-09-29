import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessToken } from '../decorators/access-token.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { SetExchangeRateDto } from './dto/set-exchange-rate.dto';
import { FxRateType, FxService } from './fx.service';

@ApiTags('fx')
@ApiBearerAuth()
@Controller({ path: 'api/fx', version: '1' })
export class FxController {
  constructor(
    private readonly fxService: FxService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  /** The active budget rates with their provenance — the Process page Exchange Rates panel. */
  @Get('exchange-rates')
  listExchangeRates(@AccessToken() accessToken: string | null) {
    return this.exchangeRateService.listRates(accessToken);
  }

  /** Sets a new budget rate for one currency; the replaced rate is kept as history. */
  @Put('exchange-rates/:currency')
  async setExchangeRate(
    @Param('currency') currency: string,
    @Body() body: SetExchangeRateDto,
    @CurrentUser() user: { id: string },
    @AccessToken() accessToken: string | null,
  ) {
    await this.exchangeRateService.setRate(currency, body.rate, body.reason.trim(), user.id);
    return this.exchangeRateService.listRates(accessToken);
  }

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
  listCurrencies(@AccessToken() accessToken: string | null) {
    return this.fxService.listCurrencies(accessToken);
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
