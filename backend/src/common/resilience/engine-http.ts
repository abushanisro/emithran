// The HTTP client for the Python CAD engine. Its transport runs every request through the process-wide cad-engine
// circuit breaker, so a call site only swaps `axios` for `cadEngineHttp` and keeps its own timeout, headers and error
// handling. A 4xx answer still reaches the caller as before; only an outage (no answer, timeout, 5xx) opens the breaker.
import axios, { type AxiosAdapter } from 'axios';

import { breakerFor, CAD_ENGINE, isServiceUnavailable } from './circuit-breaker';

const transport: AxiosAdapter = axios.getAdapter(axios.defaults.adapter);

export const cadEngineHttp = axios.create({
  adapter: (config) => breakerFor(CAD_ENGINE).exec(() => transport(config), isServiceUnavailable),
});
