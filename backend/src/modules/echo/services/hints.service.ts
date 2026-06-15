import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

import type { HintDto } from '../dto/hint.dto';

/**
 * Hints are seed-only markdown snippets keyed by (route_glob, topic_id).
 * Pages render `<EchoHintButton topicId="bom.cost-rollup" />` and Echo
 * pre-loads the matching hint when the user clicks it.
 *
 * route_glob example: `/projects/*\/bom`. We match by route_glob being a
 * prefix of the live pathname with `*` replaced by `[^/]+`.
 */
@Injectable()
export class HintsService {
  private readonly logger = new Logger(HintsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findByTopic(args: {
    accessToken: string | null;
    route: string;
    topicId: string;
  }): Promise<HintDto> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_hints')
      .select('id, route_glob, topic_id, title, content_md, tags')
      .eq('topic_id', args.topicId)
      .limit(20);
    if (error) throw new Error(`hints: ${error.message}`);

    const match = (data ?? []).find((r: any) => globMatches(r.route_glob, args.route))
      ?? (data ?? [])[0];

    if (!match) {
      throw new NotFoundException(`No hint for topic ${args.topicId}`);
    }
    return this.toDto(match);
  }

  async listByRoute(args: {
    accessToken: string | null;
    route: string;
  }): Promise<HintDto[]> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_hints')
      .select('id, route_glob, topic_id, title, content_md, tags')
      .limit(200);
    if (error) throw new Error(`hints list: ${error.message}`);
    return (data ?? [])
      .filter((r: any) => globMatches(r.route_glob, args.route))
      .map(this.toDto);
  }

  private toDto = (r: any): HintDto => ({
    id: r.id,
    routeGlob: r.route_glob,
    topicId: r.topic_id,
    title: r.title,
    contentMd: r.content_md,
    tags: r.tags ?? [],
  });
}

function globMatches(glob: string, route: string): boolean {
  if (!glob) return false;
  // Translate `/projects/*\/bom` to a regex.
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
  const re = new RegExp(`^${escaped}(/|$)`, 'i');
  return re.test(route);
}
