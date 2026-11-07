/**
 * Route compatibility: can this route's process make this part's features at all. One of three separate responsibilities:
 *   recognition   (route-feature-recognition.ts): what the CAD found and what the process's reference vocabulary lists;
 *   compatibility (this file): reads that and gives a verdict;
 *   recommendation (selectRecommendedRoute, engine-kernel.ts): reads the verdict, never computes it.
 * A confirmed incompatibility (the reference rules a feature out for the process) makes the route 'incompatible', which bars it from being recommended.
 * A feature type the CAD cannot assess yet is only a warning: it is not evidence either way, so it never excludes a route. No recognition at all
 * (no feature graph) gives no verdict (null): nothing is known, so nothing is held against the route.
 */
import type { RouteCompatibilityVerdict } from '../../shared/core/engine-kernel';
import type { ProcessIncompatibility, RouteFeatureRecognition } from './route-feature-recognition';

export const NO_COMPATIBLE_PROCESS_MESSAGE = 'No compatible manufacturing process found.';

export interface RouteCompatibility extends RouteCompatibilityVerdict {
  /** Confirmed: each one rules this process out for this part. Empty when compatible. */
  incompatibilities: ProcessIncompatibility[];
  /** Not assessed from the CAD yet (types in this process's vocabulary). Shown as warnings; they never exclude the route. */
  notAssessed: string[];
  warnings: string[];
}

export function routeCompatibility(recognition: RouteFeatureRecognition | null | undefined): RouteCompatibility | null {
  if (!recognition) return null;
  const { process, incompatibilities, notAssessed } = recognition;
  const warnings = notAssessed.length === 0 ? [] : [
    `${notAssessed.join(', ')} ${notAssessed.length === 1 ? 'is' : 'are'} not assessed from the CAD yet, so ${process} is not excluded or confirmed for ${notAssessed.length === 1 ? 'it' : 'them'}.`,
  ];
  return { status: incompatibilities.length > 0 ? 'incompatible' : 'compatible', incompatibilities: [...incompatibilities], notAssessed: [...notAssessed], warnings };
}

/** True when there are routes and every one of them is incompatible: then no route is recommended and none is chosen in its place. */
export function noCompatibleProcess(routes: readonly { compatibility?: RouteCompatibilityVerdict | null }[]): boolean {
  return routes.length > 0 && routes.every((r) => r.compatibility?.status === 'incompatible');
}
