// Some browsers/environments report a WebGL-capable UA but cannot actually
// create a context (GPU disabled, sandboxed renderer process, remote desktop,
// headless test runners). three.js throws synchronously from inside a layout
// effect / resize / frame callback in that case, which does not reliably
// propagate through React error boundaries. Any component that mounts a
// react-three-fiber <Canvas> should check this first and render a fallback
// instead, rather than mounting a Canvas that's guaranteed to throw.
let cached: boolean | null = null;

export function isWebGLAvailable(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    cached = !!gl;
  } catch {
    cached = false;
  }
  return cached;
}
