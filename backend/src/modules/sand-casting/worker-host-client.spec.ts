import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyOutcome,
  isOutputName,
  WorkerHostClient,
  WorkerRunError,
  type WorkerOutcome,
} from "./worker-host-client";

const LIMITS = {
  deadlineMs: 2000,
  answerMarginMs: 500,
  maxOutputs: 10,
  maxOutputBytes: 1024,
};
const OK: WorkerOutcome = { ended: { exited: 0 }, tail: "" };

/** A stand-in for cad-worker-host: reads one request, answers with what `answer` says. */
async function host(
  answer: (request: {
    deadline_ms: number;
    inputs: { name: string; len: number }[];
    bodies: Buffer[];
  }) =>
    | {
        outcome: WorkerOutcome | unknown;
        outputs: { name: string; body: Buffer }[];
        raw?: Buffer;
      }
    | "silent",
) {
  const dir = mkdtempSync(join(tmpdir(), "casting-host-"));
  const path = join(dir, "worker.sock");
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const headerLength = buffer.readUInt32BE(0);
      if (buffer.length < 4 + headerLength) return;
      const header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString()) as {
        deadline_ms: number;
        inputs: { name: string; len: number }[];
      };
      const total = header.inputs.reduce((n, i) => n + i.len, 0);
      if (buffer.length < 4 + headerLength + total) return;
      let at = 4 + headerLength;
      const bodies = header.inputs.map((i) => {
        const body = buffer.subarray(at, at + i.len);
        at += i.len;
        return body;
      });
      const reply = answer({ ...header, bodies });
      if (reply === "silent") return;
      const head = Buffer.from(
        JSON.stringify({
          outcome: reply.outcome,
          outputs: reply.outputs.map((o) => ({ name: o.name, len: o.body.length })),
        }),
      );
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(head.length);
      socket.write(Buffer.concat([prefix, head, ...reply.outputs.map((o) => o.body)]));
      socket.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    path,
    close: () => {
      sockets.forEach((s) => s.destroy());
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("WorkerHostClient", () => {
  it("sends the file with the deadline and returns result.json and the part files", async () => {
    let seen: { deadline_ms: number; names: string[]; body: string } | null = null;
    const h = await host((request) => {
      seen = {
        deadline_ms: request.deadline_ms,
        names: request.inputs.map((i) => i.name),
        body: request.bodies[0].toString(),
      };
      return {
        outcome: OK,
        outputs: [
          { name: "result.json", body: Buffer.from('{"a":1}') },
          { name: "parts/p1.glb", body: Buffer.from("glb") },
        ],
      };
    });
    try {
      const out = await new WorkerHostClient(h.path, LIMITS).run([
        { name: "part.step", bytes: Buffer.from("STEP DATA") },
      ]);
      expect(seen).toEqual({
        deadline_ms: 2000,
        names: ["part.step"],
        body: "STEP DATA",
      });
      expect(out.result?.toString()).toBe('{"a":1}');
      expect(out.parts.get("p1.glb")?.toString()).toBe("glb");
    } finally {
      h.close();
    }
  });

  it("treats an unreadable STEP file as the file's fault, and a crash as retryable", async () => {
    for (const [ended, code, permanent] of [
      [{ exited: 2 }, "unreadable_step", true],
      [{ exited: 3 }, "no_solids", true],
      [{ exited: 4 }, "deadline_exceeded", false],
      ["signalled", "worker_killed", false],
      ["overran", "deadline_exceeded", false],
    ] as const) {
      const h = await host(() => ({ outcome: { ended, tail: "boom" }, outputs: [] }));
      try {
        await expect(
          new WorkerHostClient(h.path, LIMITS).run([
            { name: "part.step", bytes: Buffer.from("x") },
          ]),
        ).rejects.toMatchObject({ code, permanent });
      } finally {
        h.close();
      }
    }
  });

  it("refuses an answer outside its contract: a name that leaves its folder, too many files, too many bytes", async () => {
    for (const outputs of [
      [{ name: "parts/../evil", body: Buffer.from("x") }],
      [{ name: "/etc/passwd", body: Buffer.from("x") }],
      [
        { name: "result.json", body: Buffer.from("x") },
        { name: "result.json", body: Buffer.from("y") },
      ],
      [{ name: "result.json", body: Buffer.alloc(2000) }],
      Array.from({ length: 11 }, (_, i) => ({
        name: `parts/${i}`,
        body: Buffer.from("x"),
      })),
    ]) {
      const h = await host(() => ({ outcome: OK, outputs }));
      try {
        await expect(
          new WorkerHostClient(h.path, LIMITS).run([
            { name: "part.step", bytes: Buffer.from("x") },
          ]),
        ).rejects.toMatchObject({ code: "host_protocol", permanent: false });
      } finally {
        h.close();
      }
    }
  });

  it("gives up on a host that does not answer, and reports one that is not there, both as retryable", async () => {
    const silent = await host(() => "silent");
    try {
      const started = Date.now();
      await expect(
        new WorkerHostClient(silent.path, {
          ...LIMITS,
          deadlineMs: 100,
          answerMarginMs: 100,
        }).run([{ name: "part.step", bytes: Buffer.from("x") }]),
      ).rejects.toMatchObject({ code: "host_timeout", permanent: false });
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      silent.close();
    }
    await expect(
      new WorkerHostClient(join(tmpdir(), "no-such-casting-host.sock"), LIMITS).run([
        { name: "part.step", bytes: Buffer.from("x") },
      ]),
    ).rejects.toMatchObject({ code: "host_unreachable", permanent: false });
  });
});

describe("classifyOutcome and isOutputName", () => {
  it("passes a clean exit", () => {
    expect(() => classifyOutcome(OK)).not.toThrow();
  });
  it("cleans the tail of a failure into one short line", () => {
    expect.assertions(2);
    try {
      classifyOutcome({ ended: { exited: 2 }, tail: "line one\n\n  line two" });
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerRunError);
      expect((error as Error).message).toContain("line one line two");
    }
  });
  it("allows result.json and parts/<plain name> only", () => {
    expect(isOutputName("result.json")).toBe(true);
    expect(isOutputName("parts/a.glb")).toBe(true);
    for (const bad of [
      "",
      "parts/",
      "parts/a/b",
      "parts/..",
      "parts/.",
      "../result.json",
      "other.json",
      "parts/a\0",
    ])
      expect(isOutputName(bad)).toBe(false);
  });
});
