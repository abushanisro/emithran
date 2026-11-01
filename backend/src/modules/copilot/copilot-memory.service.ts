import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';

export const MAX_PREFERENCES = 20;
export const MAX_PREFERENCE_CHARS = 200;

export interface PreferenceChange {
  saved: string[];
  removed: string[];
  notFound: string[];
  preferences: string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What the user asked the copilot to remember, in one row per user (migration 901). Always the user's own client: row-level security is the only gate. */
@Injectable()
export class CopilotMemoryService {
  private readonly logger = new Logger(CopilotMemoryService.name);

  constructor(private readonly database: DatabaseService) {}

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
  }

  async change(userId: string, accessToken: string, add: string[], remove: string[]): Promise<PreferenceChange> {
    const toAdd = add.map((p) => p.trim().replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim());
    if (toAdd.some((p) => p.length < 1 || p.length > MAX_PREFERENCE_CHARS)) {
      throw new BadRequestException(`each preference must be 1 to ${MAX_PREFERENCE_CHARS} characters`);
    }

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
