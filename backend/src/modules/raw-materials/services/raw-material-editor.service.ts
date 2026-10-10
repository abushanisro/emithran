import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { Logger } from '../../../common/logger/logger.service';
import { RawMaterialsService } from '../raw-materials.service';
import { MaterialStockPricesService } from './material-stock-prices.service';
import { SaveRawMaterialEditorDto } from '../dto/raw-material-editor.dto';

// The single backend surface for the raw material edit form. Load returns everything
// the form shows in one response; save applies everything in one transaction
// (save_raw_material_editor, migration 862). No other write path for these fields.
@Injectable()
export class RawMaterialEditorService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly logger: Logger,
    private readonly rawMaterials: RawMaterialsService,
    private readonly stockPrices: MaterialStockPricesService,
  ) {}

  async load(id: string, userId: string, accessToken: string) {
    const [material, properties, stockPrices] = await Promise.all([
      this.rawMaterials.findOne(id, userId, accessToken),
      this.rawMaterials.getProperties(id, accessToken),
      this.stockPrices.listForMaterial(id, accessToken),
    ]);
    return { material, properties, stockPrices, stockForms: this.stockPrices.stockForms() };
  }

  async save(id: string, dto: SaveRawMaterialEditorDto, userId: string, accessToken: string, organizationId: string | undefined) {
    // Throws NotFound unless the caller can see this material.
    await this.rawMaterials.findOne(id, userId, accessToken);

    // Seeing a material is not the right to change it: the save below runs with the
    // service role and bypasses RLS, so the ownership rule RLS applies to a plain
    // update (migration 621) is enforced here instead.
    const { data: owner, error: ownerError } = await this.supabase
      .getClient(accessToken)
      .from('raw_materials')
      .select('organization_id')
      .eq('id', id)
      .single();
    if (ownerError || !owner) throw new NotFoundException(`Raw material with ID ${id} not found`);
    assertCanEditMaterial(owner.organization_id, organizationId);

    const known = new Set((await this.rawMaterials.getProperties(id, accessToken)).map((p) => p.propertyKey));
    const unknown = dto.properties.map((p) => p.propertyKey).filter((k) => !known.has(k));
    if (unknown.length > 0) throw new BadRequestException(`Material has no property: ${unknown.join(', ')}`);

    // Writes need the service role: the tables are read-only for signed-in users (RLS).
    const db = this.supabase.getPrivilegedClient(`raw-material-editor: save ${id}`);
    const { error } = await db.rpc('save_raw_material_editor', {
      p_material_id: id,
      p_core: dto.core,
      p_properties: dto.properties,
      p_stock_prices: dto.stockPrices,
    });
    if (error) {
      if (error.code === 'P0002') throw new NotFoundException(error.message);
      throw new InternalServerErrorException(`Failed to save material: ${error.message}`);
    }
    this.logger.log(
      `Raw material ${id} saved: ${dto.properties.length} property value(s), ${dto.stockPrices.length} stock price(s)`,
      'RawMaterialEditorService',
    );
    return this.load(id, userId, accessToken);
  }
}

/**
 * Only the organization that owns a material may edit it. Global catalog rows
 * (no organization) and other organizations' rows are read-only here, exactly as
 * they are for a plain update under the row-level security policy.
 */
export function assertCanEditMaterial(materialOrganizationId: string | null, callerOrganizationId: string | undefined): void {
  if (materialOrganizationId === null || materialOrganizationId === undefined) {
    throw new ForbiddenException('Shared catalog materials cannot be edited. Create your own material from it instead.');
  }
  if (!callerOrganizationId || materialOrganizationId !== callerOrganizationId) {
    throw new ForbiddenException('This material belongs to another organization.');
  }
}
