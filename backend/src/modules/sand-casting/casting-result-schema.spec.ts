import { readFileSync } from "node:fs";

import { CASTING_RESULT_SCHEMA } from "./casting-result-schema.generated";

// The backend keeps a generated copy of the worker's result schema (the Docker build context cannot reach casting-worker/).
// Edit casting-worker/result.schema.json, then run `npm run casting:sync-contract`.
describe("casting result schema copy", () => {
  it("equals casting-worker/result.schema.json", () => {
    const source = JSON.parse(
      readFileSync(
        require.resolve("../../../../casting-worker/result.schema.json"),
        "utf8",
      ),
    );
    expect(CASTING_RESULT_SCHEMA).toEqual(source);
  });
});
