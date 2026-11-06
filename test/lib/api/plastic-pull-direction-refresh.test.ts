import { describe, expect, it } from "vitest";

import { refreshAfterPullDirectionChange } from "@/lib/api/hooks/usePlasticPullDirection";

describe("refreshAfterPullDirectionChange", () => {
  it("settles when the direction and the item are current, without waiting for the slow cost summary", async () => {
    const started: string[] = [];
    let releaseCost!: () => void;
    const costRefetch = new Promise<void>((res) => { releaseCost = res; });
    const queryClient = {
      invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const name = String(queryKey[2] ?? queryKey[0]);
        started.push(name);
        return name === "cost-summary" ? costRefetch : Promise.resolve();
      },
    };
    await refreshAfterPullDirectionChange(queryClient as never, "i1"); // resolves although the cost refetch is still pending
    expect(started).toEqual(expect.arrayContaining(["cost-summary", "route-comparison", "dfm-scores", "plastic-pull-direction"]));
    releaseCost();
  });
});
