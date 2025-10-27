// Layer 7/9: Retrieval & Query Execution Caching
type Entry<T> = { value: T; exp: number };

export class TTLCache<T> {
  private store = new Map<string, Entry<T>>();
  constructor(private ttlMs = 60_000, private max = 500) { }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return;
    if (Date.now() > e.exp) {
      this.store.delete(key);
      return;
    }
    return e.value;
  }

  set(key: string, val: T) {
    if (this.store.size >= this.max) {
      // naive eviction
      const iterator = this.store.keys().next();
      if (!iterator.done && iterator.value) {
        this.store.delete(iterator.value);
      }
    }
    this.store.set(key, { value: val, exp: Date.now() + this.ttlMs });
  }
}

// A tiny semantic-ish cache by normalized text key.
export const responseCache = new TTLCache<string>(5 * 60_000, 200);
export const retrievalCache = new TTLCache<{ chunks: any[]; queryEmbedding?: number[] }>(2 * 60_000, 200);

export function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
