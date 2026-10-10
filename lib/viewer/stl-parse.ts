/**
 * STL -> triangle positions (9 floats per triangle: 3 vertices x xyz), the same
 * triangle order as the file, so the engine's face_map ranges stay valid.
 * Pure (no DOM, no three.js): runs in a worker, in the main thread or in tests.
 *
 * Binary STL is 80 header bytes + uint32 count + 50 bytes per triangle. A file
 * is binary exactly when its length matches that count; otherwise it is parsed
 * as ASCII ("vertex x y z" lines).
 */
const BINARY_HEADER = 84;
const BINARY_TRI = 50;

export function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_HEADER) return false;
  const count = new DataView(buffer).getUint32(80, true);
  return BINARY_HEADER + count * BINARY_TRI === buffer.byteLength;
}

export function parseStl(buffer: ArrayBuffer): Float32Array {
  return isBinaryStl(buffer) ? parseBinary(buffer) : parseAscii(buffer);
}

function parseBinary(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const out = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const base = BINARY_HEADER + t * BINARY_TRI + 12; // skip the facet normal
    for (let i = 0; i < 9; i++) out[t * 9 + i] = view.getFloat32(base + i * 4, true);
  }
  return out;
}

function parseAscii(buffer: ArrayBuffer): Float32Array {
  const text = new TextDecoder().decode(buffer);
  const values: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (values.length === 0 || values.length % 9 !== 0 || values.some((v) => !Number.isFinite(v))) {
    throw new Error('Not a valid STL file');
  }
  return Float32Array.from(values);
}
