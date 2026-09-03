export class InMemoryRepository<T extends { id: string }> {
  private readonly records = new Map<string, T>();

  save(record: T): T {
    this.records.set(record.id, record);
    return record;
  }

  findById(id: string): T | undefined {
    return this.records.get(id);
  }

  findAll(): T[] {
    return Array.from(this.records.values());
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }
}