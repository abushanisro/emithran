// The accuracy gate of the sand casting analysis (design step S3): reads a manifest of labelled parts and the worker's results for them, prints every miss
// and the verdict. The comparison is src/test-tools/casting-accuracy.ts; casting-worker/accuracy.sh runs the worker and calls this.
//   ts-node scripts/casting-accuracy.ts <manifest.json> <results-dir>      (results-dir/<part id>/result.json, one per part)
// Exit: 0 the measurements are within tolerance; 1 they are not; 2 the manifest is invalid; 64 usage. Whether S3 is claimed is in the last line of the
// output: only a corpus declared "real" can claim it.
import * as fs from "fs";
import * as path from "path";
import {
  comparePart,
  formatReport,
  gate,
  validateManifest,
} from "../src/test-tools/casting-accuracy";

const [manifestPath, resultsDir] = process.argv.slice(2);
if (!manifestPath || !resultsDir) {
  console.error("usage: casting-accuracy.ts <manifest.json> <results-dir>");
  process.exit(64);
}

const validated = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
if ("errors" in validated) {
  for (const e of validated.errors) console.error(`INVALID  ${e}`);
  process.exit(2);
}
const { manifest } = validated;

const reports = manifest.parts.map((part) => {
  const file = path.join(resultsDir, part.id, "result.json");
  const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  return comparePart(part, result, manifest.tolerances);
});
const verdict = gate(manifest, reports);
console.log(formatReport(reports, verdict));
process.exit(verdict.measurementsOk ? 0 : 1);
