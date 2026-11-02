// Entry point of a heavy-work worker thread (started by heavy-work.ts): runs one task from workerData, posts the result, and ends.
// The thread has its own V8 heap capped by resourceLimits, so a parse that runs out of memory ends this thread, not the API.
import { parentPort, workerData } from 'node:worker_threads';

import { runHeavyTask, transferables, type HeavyTask } from './heavy-tasks';

void runHeavyTask(workerData as HeavyTask).then((result) => parentPort?.postMessage(result, transferables(result)));
