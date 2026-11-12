import { randomUUID } from 'node:crypto';

export type IdPrefix = 'sub' | 'inv';

export interface IdGenerator {
  next(prefix: IdPrefix): string;
}

export class RandomIdGenerator implements IdGenerator {
  next(prefix: IdPrefix): string {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  }
}
