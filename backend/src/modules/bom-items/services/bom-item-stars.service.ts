import { Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { DatabaseService } from '../../../common/database/database.service';
import { isMissingTable } from '../../../common/db/missing-table';

/**
 * Starred BOM items: each person's own marks, as Gmail's stars (migration 1111). Everything runs on the caller's own client, so row-level
 * security decides: a person reads, adds and removes only their own stars, and only on items they can see. A star changes nothing in the BOM.
 */
@Injectable()
export class BomItemStarsService {
  private readonly logger = new Logger(BomItemStarsService.name);

  constructor(private readonly database: DatabaseService) {}

  /** The caller's starred items in one BOM. A database without the table yet (the migration not applied) simply has no stars. */
  async list(bomId: string, token: string): Promise<string[]> {
    const { data, error } = await this.database
      .getUserClient(token)
      .from('bom_item_stars')
      .select('bom_item_id')
      .eq('bom_id', bomId);
    if (error) {
      if (isMissingTable(error)) {
        this.logger.warn('bom_item_stars is not in this database yet (migration 1111): no stars to list');
        return [];
      }
      this.logger.error(`Listing starred items of BOM ${bomId} failed: ${error.message}`);
      throw new InternalServerErrorException('Failed to read the starred items');
    }
    return (data as Array<{ bom_item_id: string }>).map((r) => r.bom_item_id);
  }

  /** Stars an item for the caller. Starring a starred item changes nothing. */
  async star(bomItemId: string, token: string): Promise<void> {
    const client = this.database.getUserClient(token);
    const item = await client.from('bom_items').select('id, bom_id').eq('id', bomItemId).maybeSingle();
    if (item.error) {
      this.logger.error(`Reading BOM item ${bomItemId} to star it failed: ${item.error.message}`);
      throw new InternalServerErrorException('Failed to star the item');
    }
    // Not there, or in an organisation the caller is not in: the same answer, so a star cannot probe for items.
    if (!item.data) throw new NotFoundException('BOM item not found');
    const { bom_id: bomId } = item.data as { id: string; bom_id: string };

    const { error } = await client
      .from('bom_item_stars')
      .upsert({ bom_item_id: bomItemId, bom_id: bomId }, { onConflict: 'user_id,bom_item_id', ignoreDuplicates: true });
    if (error) this.fail('star', bomItemId, error);
  }

  /** Removes the caller's star from an item. Unstarring an item without one changes nothing. */
  async unstar(bomItemId: string, token: string): Promise<void> {
    const { error } = await this.database.getUserClient(token).from('bom_item_stars').delete().eq('bom_item_id', bomItemId);
    if (error) this.fail('unstar', bomItemId, error);
  }

  private fail(action: 'star' | 'unstar', bomItemId: string, error: { code?: string | null; message: string }): never {
    if (isMissingTable(error)) throw new ServiceUnavailableException('Stars are not available until the database is updated (migration 1111).');
    this.logger.error(`Failed to ${action} BOM item ${bomItemId}: ${error.message}`);
    throw new InternalServerErrorException(`Failed to ${action} the item`);
  }
}
