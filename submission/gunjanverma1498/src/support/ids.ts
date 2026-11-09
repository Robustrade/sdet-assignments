import { randomUUID } from 'node:crypto';

/** Generates prefixed, collision-free ids (e.g. `sub_<uuid>`). */
export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
