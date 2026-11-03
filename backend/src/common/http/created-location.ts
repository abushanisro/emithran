/* eslint-disable @typescript-eslint/no-unsafe-function-type -- Nest's ExecutionContext.getHandler() is typed Function */
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants';

/** State changes (docs/API.md rule 2): POST /things/:id/<action> acts on an item, it does not create one. */
const ACTIONS = new Set(['send', 'close', 'approve', 'reject', 'submit', 'activate', 'archive', 'apply', 'discard', 'refresh', 'execute']);

/**
 * The URL of what a POST just created, for the Location header (docs/API.md rule 5): the request path plus the new id. Only for a
 * handler that answers 201 (Nest's default for POST unless @HttpCode says otherwise) and whose result has a string id; an action
 * such as /rfqs/:id/send never gets one.
 */
export function createdLocation(handler: Function, requestUrl: string, result: unknown): string | null {
  if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.POST) return null;
  if ((Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? 201) !== 201) return null;
  const id = result !== null && typeof result === 'object' ? (result as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' || id === '') return null;
  const path = requestUrl.split('?')[0].replace(/\/+$/, '');
  const last = path.split('/').pop() ?? '';
  if (ACTIONS.has(last)) return null;
  return `${path}/${encodeURIComponent(id)}`;
}
