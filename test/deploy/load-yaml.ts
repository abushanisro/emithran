import { CORE_SCHEMA, load, mergeTag } from 'js-yaml';

/**
 * Reads a compose or workflow file. These files share settings with YAML merge keys (`<<: *hardened`), which js-yaml 5 leaves out of its
 * default schema: without the tag a merged service silently loses every key it inherits, and the hardening checks would read `undefined`.
 */
export function loadYaml(text: string): unknown {
  return load(text, { schema: CORE_SCHEMA.withTags(mergeTag) });
}
