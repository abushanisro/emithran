import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { Logger } from '../../../common/logger/logger.service';
import { STOCK_FORMS } from '../dto/material-stock-price.dto';

export interface MaterialStockPrice {
  stockForm: string;
  location: string;
  pricePerKg: number;
  currencyCode: string;
  source: string;
}

// A stock price belongs to the reference alloy (name, falling back to the grade
// material name), the same key the price table and the costing lookup use. An
// edit here is therefore the price every row of that alloy is costed with.
@Injectable()
export class MaterialStockPricesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly logger: Logger,
  ) {}

  stockForms(): readonly string[] {
    return STOCK_FORMS;
  }

  private async referenceOf(materialId: string, accessToken: string): Promise<string> {
    const { data, error } = await this.supabase
      .getUserClient(accessToken)
      .from('raw_materials')
      .select('grade, name')
      .eq('id', materialId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`Failed to read material: ${error.message}`);
    if (!data) throw new NotFoundException(`Raw material ${materialId} not found`);
    return (data.name || data.grade) as string;
  }

  async listForMaterial(materialId: string, accessToken: string): Promise<MaterialStockPrice[]> {
    const reference = await this.referenceOf(materialId, accessToken);
    const { data, error } = await this.supabase
      .getUserClient(accessToken)
      .from('material_stock_prices')
      .select('stock_form, location, price_per_kg, currency_code, source')
      .eq('reference_material', reference)
      .order('location', { ascending: true })
      .order('stock_form', { ascending: true });
    if (error) throw new InternalServerErrorException(`Failed to read stock prices: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      stockForm: r.stock_form,
      location: r.location,
      pricePerKg: Number(r.price_per_kg),
      currencyCode: r.currency_code,
      source: r.source,
    }));
  }

}
