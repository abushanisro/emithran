import { BadRequestException, GoneException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { modelText } from '../../common/ai/model-text';
import { DatabaseService } from '../../common/database/database.service';

export const MAX_PREFERENCES = 20;
export const MAX_PREFERENCE_CHARS = 200;
/** At most this many entries to add, and to remove, in one proposal (also enforced by migration 950). */
export const MAX_PROPOSAL_ENTRIES = 5;

export interface PreferenceChange {
  saved: string[];
  removed: string[];
  notFound: string[];
  preferences: string[];
}

/** A memory change the model proposed; nothing is saved until the user confirms it. */
export interface MemoryProposal {
  proposalId: string;
  add: string[];
  remove: string[];
  expiresAt: string;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A preference as it is stored and later shown to the model: one line of plain text (common/ai/model-text). */
function normalizedPreference(text: string): string {
  const p = modelText(text, Number.MAX_SAFE_INTEGER);
  if (p.length < 1 || p.length > MAX_PREFERENCE_CHARS) {
    throw new BadRequestException(`each preference must be 1 to ${MAX_PREFERENCE_CHARS} characters`);
  }
  return p;
}

/**
 * What the user asked the copilot to remember, in one row per user (migration 901), and the changes the copilot proposed
 * (migration 950). Always the user's own client: row-level security is the only gate.
 *
 * The copilot can only propose(). A change is written by confirm(), which the user triggers from the panel, or by remove(), from
 * the memory list in settings.
 */
@Injectable()
export class CopilotMemoryService {
  private readonly logger = new Logger(CopilotMemoryService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async load(userId: string, accessToken: string): Promise<string[]> {
    const { data, error } = await this.database
      .getUserClient(accessToken)
      .from('copilot_user_memory')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      this.logger.error(`copilot memory read failed user=${userId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to read copilot memory');
    }
    return (data?.preferences as string[] | undefined) ?? [];
  }

  /** Forget everything this user asked the copilot to remember (RLS: own row only). */
  async clear(userId: string, accessToken: string): Promise<void> {
    const { error } = await this.database
      .getUserClient(accessToken)
      .from('copilot_user_memory')
      .delete()
      .eq('user_id', userId);
    if (error) {
      this.logger.error(`copilot memory delete failed user=${userId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to clear copilot memory');
    }
    await this.audit.record({ action: 'copilot_memory.cleared', targetType: 'copilot_memory', targetId: userId });
  }

  /** Forget one saved preference (exact text, case-insensitive). 404 when it is not saved. */
  async remove(userId: string, accessToken: string, preference: string): Promise<PreferenceChange> {
    const change = await this.change(userId, accessToken, [], [preference]);
    if (change.removed.length === 0) throw new NotFoundException('That preference is not saved.');
    await this.audit.record({ action: 'copilot_memory.changed', targetType: 'copilot_memory', targetId: userId, meta: { saved: 0, removed: 1, via: 'settings' } });
    return change;
  }

  /**
   * Stores a change the model proposed in one conversation turn, for the user to confirm. Writes nothing to memory. Entries are
   * normalized here, so the confirmation shows exactly what Save would store. The user's spent (used or expired) proposals are
   * removed first, so the table holds only live ones.
   */
  async propose(userId: string, accessToken: string, conversationId: string, turn: number, add: string[], remove: string[]): Promise<MemoryProposal> {
    if (add.length > MAX_PROPOSAL_ENTRIES || remove.length > MAX_PROPOSAL_ENTRIES || add.length + remove.length === 0) {
      throw new BadRequestException(`add and remove must each be up to ${MAX_PROPOSAL_ENTRIES} strings, and at least one is required`);
    }
    const toAdd = add.map(normalizedPreference);
    const toRemove = remove.map(normalizedPreference);
    const client = this.database.getUserClient(accessToken);

    const spent = await client
      .from('copilot_memory_proposals')
      .delete()
      .eq('user_id', userId)
      .lt('expires_at', new Date().toISOString());
    if (spent.error) this.logger.warn(`copilot memory proposal cleanup failed user=${userId}: ${spent.error.message}`);

    const { data, error } = await client
      .from('copilot_memory_proposals')
      .insert({ conversation_id: conversationId, turn, add_preferences: toAdd, remove_preferences: toRemove })
      .select('id, expires_at')
      .single();
    if (error || !data) {
      this.logger.error(`copilot memory proposal failed user=${userId}: ${error?.message ?? 'no row'}`);
      throw new InternalServerErrorException('Failed to store the memory proposal');
    }
    return { proposalId: data.id as string, add: toAdd, remove: toRemove, expiresAt: data.expires_at as string };
  }

  /**
   * The user pressed Save: consumes the proposal (single use, unexpired, same conversation and turn; the update policy of
   * migration 950 enforces all of it) and then applies it. 410 when it is unknown, expired, used, or from another conversation.
   */
  async confirm(userId: string, accessToken: string, proposalId: string, conversationId: string, turn: number): Promise<PreferenceChange> {
    const { data, error } = await this.database
      .getUserClient(accessToken)
      .from('copilot_memory_proposals')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .eq('turn', turn)
      .select('add_preferences, remove_preferences');
    if (error) {
      this.logger.error(`copilot memory confirm failed user=${userId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to confirm the memory change');
    }
    const proposal = (data ?? [])[0] as { add_preferences: string[]; remove_preferences: string[] } | undefined;
    if (!proposal) throw new GoneException('This memory change has expired or was already handled. Ask the copilot again.');

    const change = await this.change(userId, accessToken, proposal.add_preferences, proposal.remove_preferences);
    this.logger.log(`copilot memory confirmed user=${userId} saved=${change.saved.length} removed=${change.removed.length}`);
    await this.audit.record({
      action: 'copilot_memory.changed',
      targetType: 'copilot_memory',
      targetId: userId,
      meta: { saved: change.saved.length, removed: change.removed.length, via: 'copilot_confirm' },
    });
    return change;
  }

  private async change(userId: string, accessToken: string, add: string[], remove: string[]): Promise<PreferenceChange> {
    const toAdd = add.map(normalizedPreference);
    const current = await this.load(userId, accessToken);
    const removed = current.filter((p) => remove.some((r) => same(p, r.trim())));
    const notFound = remove.filter((r) => !current.some((p) => same(p, r.trim())));
    const kept = current.filter((p) => !removed.includes(p));
    const saved = toAdd.filter((p, i) => !kept.some((k) => same(k, p)) && toAdd.findIndex((q) => same(q, p)) === i);
    const next = [...kept, ...saved];
    if (next.length > MAX_PREFERENCES) {
      throw new BadRequestException(`at most ${MAX_PREFERENCES} preferences can be saved; remove some first`);
    }

    const { error } = await this.database
      .getUserClient(accessToken)
      .from('copilot_user_memory')
      .upsert({ user_id: userId, preferences: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      this.logger.error(`copilot memory write failed user=${userId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to save copilot memory');
    }
    return { saved, removed, notFound, preferences: next };
  }
}
