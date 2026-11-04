# Casting worker: timing and memory (design step S9, gap G7)

`casting-worker/benchmark.sh [sizes...]` runs the worker in its production sandbox (no network, read-only root, 2 GB, 2 CPUs) on assemblies of **distinct**
drilled plates (`make-samples --big`: each 200 x 150 x 20 mm with 80 through holes, a different hole size per part, so no part is an instance of another). It
prints the numbers below. It measures; it does not pass or fail anything. The figures depend on the machine.

## Measured 2026-11-05

Machine: macOS, Apple silicon (arm64), Docker Desktop, worker 0.15.0. CI is amd64: expect different absolute times.

| parts | STEP MB | wall s | s per part | read s | analyse s | mesh s | casting s | peak MB | measured | problems |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.3 | 2.2 | 2.18 | 0.04 | 0.02 | 0.04 | 1.8 | 32 | 1 of 1 | 0 |
| 10 | 3.2 | 19.0 | 1.90 | 0.31 | 0.22 | 0.36 | 17.9 | 80 | 10 of 10 | 0 |
| 30 | 9.9 | 58.8 | 1.96 | 0.95 | 0.68 | 1.10 | 55.7 | 190 | 30 of 30 | 0 |
| 150 | 50.3 | 378.7 | 2.52 | 5.60 | 6.62 | 13.90 | 351.9 | 587 | 150 of 150 | 0 |

(The 150 row is the same command, run once on its own: `casting-worker/benchmark.sh 150`.)

## What it says

- **About 2 s per part, and almost all of it is the casting measurement** (draw axis by ray casting, parting line, cores, wall thickness, draft): 93 to 95 % of
  the time from 10 parts up (82 % for a single part, where the worker's start weighs more). Reading the STEP file, analysing the structure and meshing together
  are 0.1 to 0.17 s a part. A part analysed on its own takes 2.2 s, including the worker's start.
- **Linear up to 30 parts, then 28 % slower per part at 150** (1.96 s to 2.52 s): the cost grows a little faster than the part count in one file.
- **Memory grows with the parts of one file**: 32 MB for one part, 587 MB for 150, about 3.7 MB a part. The sandbox's 2 GB limit holds 150 parts with room; a
  straight-line reading puts the limit at roughly 500 parts in one file, but that is an extrapolation from these four points, not a measurement.
- **A 150-part file takes 379 s on this machine; the runner's default deadline is 600 s** (`CASTING_WORKER_DEADLINE_MS`), a margin of 1.6 x here. On a slower
  machine, or with more holes per part, a file of that size can exceed it. The module analyses one BOM item's file at a time and lazily (a user opens a part), so
  the usual cost is the 2 s of one part, not the 379 s of a whole assembly.
- **No part failed**: every part of every run got its casting measurements.

## Where the other S9 measures stand

- **Cache and in-flight de-duplication.** A request reuses a finished analysis of the same file, worker version, schema version and configuration. Until now a
  duplicate requested while the first was still queued was queued too, so the worker ran again for each. The runner now looks, when it claims an analysis,
  for a finished one of the same key made for another item, and adopts its result and files. Tested with a queue of 150 analyses of 30 distinct files: the worker
  runs 30 times and the other 120 adopt (an 80 % hit rate), each duplicate pointing at the files of the one that ran.
- **Bounded concurrency**: one analysis at a time per runner; more API replicas claim more rows (`FOR UPDATE SKIP LOCKED`). Two replicas can still analyse the
  same new file at the same moment (the check happens when each claims); that costs a second run, never a wrong answer.
- **Deadlines**: the host kills a run at its deadline (600 s by default); a run over it is a failure with its own code.
- **Not measured here**: queue wait with real traffic (it depends on how many replicas run and how often users open parts), and the amd64 timings of CI.
