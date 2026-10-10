/// <reference lib="webworker" />
import { parseStl } from './stl-parse';

// One request in, one transferable result out; an error is reported, never thrown silently.
self.onmessage = (e: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
  const { id, buffer } = e.data;
  try {
    const positions = parseStl(buffer);
    (self as unknown as Worker).postMessage({ id, positions }, [positions.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
