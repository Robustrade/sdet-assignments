/**
 * Generic in-memory repository (Repository pattern).
 *
 * Persistence access is encapsulated behind typed repositories instead of raw
 * data structures leaking through the service and tests. Swapping the store for
 * SQLite/Postgres would mean reimplementing these classes only — nothing above
 * them changes. Every record is deep-cloned on the way in and out so callers can
 * never mutate stored state by holding a reference (the kind of bug that
 * produces false-green persistence assertions).
 */
export abstract class InMemoryRepository<T extends object> {
  protected readonly rows = new Map<string, T>();

  protected abstract idOf(entity: T): string;

  protected clone(entity: T): T {
    return structuredClone(entity);
  }

  insert(entity: T): T {
    const id = this.idOf(entity);
    if (this.rows.has(id)) {
      throw new Error(`${this.constructor.name}: duplicate id ${id}`);
    }
    this.rows.set(id, this.clone(entity));
    return this.clone(entity);
  }

  upsert(entity: T): T {
    this.rows.set(this.idOf(entity), this.clone(entity));
    return this.clone(entity);
  }

  findById(id: string): T | undefined {
    const row = this.rows.get(id);
    return row ? this.clone(row) : undefined;
  }

  find(predicate: (entity: T) => boolean): T[] {
    return [...this.rows.values()].filter(predicate).map((r) => this.clone(r));
  }

  all(): T[] {
    return [...this.rows.values()].map((r) => this.clone(r));
  }

  count(predicate?: (entity: T) => boolean): number {
    if (!predicate) return this.rows.size;
    return this.find(predicate).length;
  }

  clear(): void {
    this.rows.clear();
  }
}
