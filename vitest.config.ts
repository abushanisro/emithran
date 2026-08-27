import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Minimal unit-test runner for pure TypeScript logic (no DOM/React rendering).
// Added for P0.3 (Sheet Metal DFM authority) to prove buildManufacturingRiskSources
// derives its heatmap amplitude solely from the backend's real DFM riskScore,
// not an independently-recomputed threshold. Scoped to `lib/` on purpose —
// component/DOM testing is a separate, larger investment not needed here.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
