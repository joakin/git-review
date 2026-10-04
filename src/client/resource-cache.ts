// Tab memory only. Bound both entry count and estimated UTF-16 payload size.
export class ResourceCache<T> {
  private readonly items = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  read(key: string): T | null {
    const item = this.items.get(key);
    if (item === undefined) return null;
    this.items.delete(key);
    this.items.set(key, item);
    return item.value;
  }

  remove(key: string): void {
    const previous = this.items.get(key);
    if (previous !== undefined) this.bytes -= previous.bytes;
    this.items.delete(key);
  }

  remember(key: string, value: T): void {
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > this.maxBytes) return;
    this.remove(key);
    this.items.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.items.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }
}
