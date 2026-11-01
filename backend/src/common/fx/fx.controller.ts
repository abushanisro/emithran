import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessToken } from '../decorators/access-token.decorator';
import { CurrentOrganization } from '../decorators/current-organization.decorator';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { OrganizationContextGuard } from '../guards/organization-context.guard';
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

  /** The caller's organization's effective budget rates with their provenance — the Process page Exchange Rates panel. */
  @Get('exchange-rates')
  @UseGuards(OrganizationContextGuard)
  listExchangeRates(@AccessToken() accessToken: string | null, @CurrentOrganization() organizationId: string) {
    return this.exchangeRateService.listRates(accessToken, organizationId);
  }

  /**
   * Sets the caller's organization's own budget rate for one currency; the replaced rate is kept as history. Other organizations
   * and the global default are not affected.
   */
  @Put('exchange-rates/:currency')
  @UseGuards(OrganizationContextGuard)
  async setExchangeRate(
    @Param('currency') currency: string,
    @Body() body: SetExchangeRateDto,
    @AccessToken() accessToken: string | null,
    @CurrentOrganization() organizationId: string,
  ) {
    await this.exchangeRateService.setRate(accessToken, organizationId, currency, body.rate, body.reason.trim());
    return this.exchangeRateService.listRates(accessToken, organizationId);
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

  /** A budget rate is the caller's organization's effective rate, so this route resolves the organization. */
  @Get('rate')
  @UseGuards(OrganizationContextGuard)
  async getRate(
    @Query('base') base: string,
    @Query('quote') quote: string,
    @Query('rateType') rateType: FxRateType = 'reference',
    @Query('customRate') customRate: string | undefined,
    @Query('customReason') customReason: string | undefined,
    @AccessToken() accessToken: string | null,
    @CurrentOrganization() organizationId: string,
  ) {
    if (!base || !quote) throw new BadRequestException('base and quote query parameters are required');
    return this.fxService.getRate({
      base,
      quote,
      rateType,
      accessToken,
      organizationId,
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
