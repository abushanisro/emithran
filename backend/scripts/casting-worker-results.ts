// Casting worker checks used by casting-worker/check.sh (see casting-worker/README.md).
//   compare <expected.json> <results-dir> <schema.json>   compare every sample's run with its hand-worked answers
//   shift-vertex <in.step>                                 print the file with one vertex moved 0.5 mm (stdout)
// <results-dir> holds, per sample: <name>.exit, <name>.out and <name>/result.json (+ GLB files).
import * as fs from "fs";
import * as path from "path";
import {
  Check,
  compareSample,
  schemaValidator,
  shiftVertex,
} from "../src/test-tools/casting-worker-results";

const [command, ...args] = process.argv.slice(2);

if (command === "shift-vertex") {
  const moved = shiftVertex(fs.readFileSync(args[0], "utf8"));
  if (moved === null) {
    console.error("no vertex found");
    process.exit(1);
  }
  process.stdout.write(moved);
} else if (command === "compare") {
  const [expectedPath, results, schemaPath] = args;
  const expectedAll = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as Record<
    string,
    any
  >; // eslint-disable-line @typescript-eslint/no-explicit-any
  const validate = schemaValidator(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
  const read = (name: string): string => {
    try {
      return fs.readFileSync(path.join(results, name), "utf8");
    } catch {
      return "";
    }
  };
  const all: Check[] = [];
  for (const [sample, expected] of Object.entries(expectedAll)) {
    if (sample.startsWith("_")) continue;
    const stem = sample.replace(/\.step$/, "");
    const exit = Number.parseInt(read(`${stem}.exit`).trim(), 10);
    all.push(
      ...compareSample(
        sample,
        expected,
        {
          exit: Number.isNaN(exit) ? -1 : exit,
          out: read(`${stem}.out`),
          result: read(`${stem}/result.json`),
          file: (rel) => {
            try {
              return fs.readFileSync(path.join(results, stem, rel));
            } catch {
              return undefined;
            }
          },
        },
        validate,
      ),
    );
  }
  for (const c of all)
    console.log(
      `${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : `  ${JSON.stringify(c.detail).slice(0, 400)}`}`,
    );
  const failed = all.filter((c) => !c.ok).length;
  console.log(`${all.length - failed} of ${all.length} checks passed`);
  process.exit(failed === 0 && all.length > 0 ? 0 : 1);
} else {
  console.error(
    "usage: casting-worker-results.ts compare <expected> <results> <schema> | shift-vertex <in.step>",
  );
  process.exit(64);
}
