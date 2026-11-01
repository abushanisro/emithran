import { deflateRawSync } from 'zlib';

export interface TestEntry {
  name: string;
  data?: string | Buffer;
  deflate?: boolean;
  encrypted?: boolean;
  /** Override the size written to the central directory. */
  statedSize?: number;
  /** Override the compressed size written to the central directory. */
  statedCompressedSize?: number;
  /** Write no data of its own: the central record points at the local header of entry number `sharesWith` (a crafted bomb). */
  sharesWith?: number;
}

// Writes the smallest well-formed zip that holds the given entries (local headers, central directory, end record).
export function zip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const written: { offset: number; method: number; compressed: number; size: number }[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' || e.data === undefined ? Buffer.from(e.data ?? '', 'utf8') : e.data;
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const flags = 0x800 | (e.encrypted ? 0x1 : 0);
    const shared = e.sharesWith === undefined ? undefined : written[e.sharesWith];
    const method = shared ? shared.method : e.deflate ? 8 : 0;
    const compressed = shared ? shared.compressed : body.length;
    const size = shared ? shared.size : raw.length;
    const localOffset = shared ? shared.offset : offset;
    if (!shared) {
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(flags, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      locals.push(local, name, body);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(e.statedCompressedSize ?? compressed, 20);
    central.writeUInt32LE(e.statedSize ?? size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    written.push({ offset: localOffset, method, compressed, size });
    if (!shared) offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
