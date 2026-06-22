'use client';

/**
 * Mount this once, globally. It renders both the floating button (when the
 * panel is closed) and the panel itself (when the panel is open).
 *
 * The component is intentionally tiny — actual logic lives in the children.
 */

import { EchoFloatingButton } from './EchoFloatingButton';
import { EchoPanel } from './EchoPanel';

export function EchoWidget() {
  return (
    <>
      <EchoFloatingButton />
      <EchoPanel />
    </>
  );
}
