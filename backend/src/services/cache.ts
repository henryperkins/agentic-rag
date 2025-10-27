// Layer 7/9: Retrieval & Query Execution Caching
type Entry<T> = { value: T; exp: number };

import { cacheHitRateGauge, cacheEvictionsCounter } from "../config/metrics";

export class TTLCache<T> {
  private store = new Map<string, Entry<T>>();
  private lru = new Set<string>();

  constructor(private name: string, private ttlMs = 60_000, private max = 500) { }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) {
      cacheHitRateGauge.labels(this.name).set(0);
      return;
    }
    if (Date.now() > e.exp) {
      this.store.delete(key);
      this.lru.delete(key);
      cacheHitRateGauge.labels(this.name).set(0);
      return;
    }
    this.lru.delete(key);
    this.lru.add(key);
    cacheHitRateGauge.labels(this.name).set(1);
    return e.value;
  }

  set(key: string, val: T) {
    if (this.store.size >= this.max) {
      const oldestKey = this.lru.values().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
        this.lru.delete(oldestKey);
        cacheEvictionsCounter.labels(this.name).inc();
      }
    }
    this.store.set(key, { value: val, exp: Date.now() + this.ttlMs });
    this.lru.add(key);
  }
}

// A tiny semantic-ish cache by normalized text key.
export const responseCache = new TTLCache<string>("response", 5 * 60_000, 200);
export const retrievalCache = new TTLCache<{ chunks: any[]; queryEmbedding?: number[] }>("retrieval", 2 * 60_000, 200);
export const webSearchCache = new TTLCache<any>("webSearch", 10 * 60_000, 100); // 10-minute TTL for web results

export function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
