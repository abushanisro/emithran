import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Minimal unit-test runner for pure TypeScript logic (no DOM/React rendering).
// Added for P0.3 (Sheet Metal DFM authority) to prove buildManufacturingRiskSources
// derives its heatmap amplitude solely from the backend's real DFM riskScore,
// not an independently-recomputed threshold. Component/DOM testing is a
// separate, larger investment not needed here.
// All frontend tests live under test/ (mirroring backend's src/test/
// convention), not colocated with source — see test/lib/**.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
