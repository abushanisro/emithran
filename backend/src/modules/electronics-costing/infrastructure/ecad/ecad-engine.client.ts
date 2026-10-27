import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { breakerFor, CircuitOpenError, ECAD_ENGINE } from '../../../../common/resilience/circuit-breaker';
import { PACKAGE_CLASS_LOOKUP } from '../../domain/lookups/package-class-lookup.generated';
import { PLACEMENT_LAYERS } from '../../domain/lookups/placement-layers.generated';

import type { SuppliedFacts } from '../../domain/supplied-facts';

export interface EngineFile {
  name: string;
  bytes: Buffer;
  /** Board-file role from the file-role table; tabular files (Pick Place, BOM) carry none. */
  role: string | null;
}

export interface SceneComponent {
  designator: string;
  comment: string;
  footprint: string;
  side: 'top' | 'bottom';
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export interface SceneHole {
  xMm: number;
  yMm: number;
  diameterMm: number;
  plated: boolean;
}

// The layers drawn on one frame, plus the parts and holes positioned on that same frame (all measured from the files).
export interface BoardPreview {
  bounds: { minXMm: number; minYMm: number; widthMm: number; heightMm: number };
  layers: { name: string; role: string; color: string; opacity: number; svg: string }[];
  components: SceneComponent[];
  /** Why the parts cannot be shown (for example a Pick Place layer name that is not in the lookup); the layers are drawn regardless. */
  componentsError: string | null;
  holes: SceneHole[];
}

export interface BoardExtraction {
  graph: unknown;
  documents: Record<string, unknown>;
  filesReport: { name: string; role: string; status: string; note: string }[];
}

/** The engine understood the request and refused the files (a missing outline, an unreadable layer). Deterministic. */
export class ExtractionRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The engine could not be reached or is not usable (down, misconfigured, wrong key). No result is invented. */
export class ExtractionUnavailable extends Error {}

const TIMEOUT_MS = 120_000;

// Talks to the ecad-engine service. The engine holds no data of its own, so every request carries the lookup tables
// it needs (generated from memory/Electronics) and the facts a person supplied. File contents go to the engine only.
@Injectable()
export class EcadEngineClient {
  private readonly logger = new Logger(EcadEngineClient.name);

  constructor(private readonly config: ConfigService) {}

  async extractBoard(files: EngineFile[], supplied: SuppliedFacts, inputTier: string): Promise<BoardExtraction> {
    return this.post<BoardExtraction>('/extract/board', files, { supplied, inputTier });
  }

  /** The layers of a board set drawn on one shared frame (SVG, millimetres). */
  async renderBoard(files: EngineFile[]): Promise<BoardPreview> {
    return this.post<BoardPreview>('/render/board', files, {});
  }

  // Behind the process-wide ecad-engine breaker: while the engine is down, calls fail at once (the parse job is retried
  // by the queue) instead of each waiting out the timeout. Only "unavailable" counts as a failure, never a rejection of
  // the files.
  private async post<T>(path: string, files: EngineFile[], extra: { supplied?: SuppliedFacts; inputTier?: string }): Promise<T> {
    try {
      return await breakerFor(ECAD_ENGINE).exec(() => this.send<T>(path, files, extra), (error) => error instanceof ExtractionUnavailable);
    } catch (error) {
      if (error instanceof CircuitOpenError) throw new ExtractionUnavailable(error.message);
      throw error;
    }
  }

  private async send<T>(path: string, files: EngineFile[], extra: { supplied?: SuppliedFacts; inputTier?: string }): Promise<T> {
    const url = this.config.get<string>('ECAD_ENGINE_URL', '');
    const key = this.config.get<string>('ECAD_ENGINE_API_KEY', '');
    if (!url || !key) throw new ExtractionUnavailable('The extraction engine is not configured: set ECAD_ENGINE_URL and ECAD_ENGINE_API_KEY.');

    const manifest = {
      ...(extra.inputTier ? { inputTier: extra.inputTier } : {}),
      files: files.map((f) => ({ name: f.name, role: f.role })),
      lookups: {
        placementLayers: Object.fromEntries(PLACEMENT_LAYERS.map((l) => [l.layerName, l.side])),
        packages: Object.fromEntries(
          PACKAGE_CLASS_LOOKUP.map((p) => [p.footprintName, { packageClass: p.packageClass, mountType: p.mountType, pinCount: p.pinCount }]),
        ),
      },
      ...(extra.supplied ? { supplied: extra.supplied } : {}),
    };
    const form = new FormData();
    form.append('manifest', JSON.stringify(manifest));
    for (const f of files) form.append('files', new Blob([new Uint8Array(f.bytes)]), f.name);

    let response: Response;
    try {
      response = await fetch(`${url.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': key },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`extraction engine unreachable: ${error instanceof Error ? error.name : 'error'}`);
      throw new ExtractionUnavailable('The extraction engine could not be reached.');
    }

    if (response.ok) return (await response.json()) as T;
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string; detail?: string };
    if (response.status === 413 || response.status === 422) {
      throw new ExtractionRejected(body.code ?? 'extraction_failed', body.message ?? 'The extraction engine rejected the files.');
    }
    this.logger.warn(`extraction engine answered ${response.status}`);
    throw new ExtractionUnavailable(`The extraction engine answered ${response.status}${body.detail ? `: ${body.detail}` : ''}.`);
  }
}
