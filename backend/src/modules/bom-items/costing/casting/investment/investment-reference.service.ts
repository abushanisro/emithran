import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../common/database/database.service';
import type { SandReference } from '../sand/sand-reference';
import { readStagedReference } from '../sand/sand-reference.service';
import { INVESTMENT_SOURCE_VERSION } from './investment-reference';

/** Loads the staged memory/Casting Investment variables and lookup tables once per process; a read error is reported and not cached. */
@Injectable()
export class InvestmentReferenceService {
  constructor(private readonly database: DatabaseService) {}

  private cached: SandReference | null = null;

  async get(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, INVESTMENT_SOURCE_VERSION, 'Investment casting', 874);
    if (read.reference) this.cached = read.reference;
    return read;
  }
}
