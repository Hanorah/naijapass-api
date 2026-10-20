import Redis from "ioredis";
import { config } from "../config";

let redisEnabled = true;
let memory = new Map<string, { value: string; expiresAt: number }>();

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy(times) {
    if (times > 2) {
      redisEnabled = false;
      return null; // stop retrying
    }
    return Math.min(times * 200, 1000);
  },
});

redis.on("error", () => {
  redisEnabled = false;
});

async function ensureRedis(): Promise<boolean> {
  if (!redisEnabled) return false;
  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    return redis.status === "ready";
  } catch {
    redisEnabled = false;
    return false;
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const ok = await ensureRedis();
    if (!ok) return false;
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    redisEnabled = false;
    return false;
  }
}

function memoryGet(key: string): string | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memorySet(key: string, value: string, ttlSeconds: number) {
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Cache JSON for `ttlSeconds`. Uses in-memory fallback when Redis is down (XAMPP). */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (await ensureRedis()) {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
  } catch {
    redisEnabled = false;
  }
  const raw = memoryGet(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const payload = JSON.stringify(value);
  try {
    if (await ensureRedis()) {
      await redis.set(key, payload, "EX", ttlSeconds);
      return;
    }
  } catch {
    redisEnabled = false;
  }
  memorySet(key, payload, ttlSeconds);
}

export async function cacheDel(patternOrKey: string): Promise<void> {
  try {
    if (await ensureRedis()) {
      if (patternOrKey.includes("*")) {
        const keys = await redis.keys(patternOrKey);
        if (keys.length) await redis.del(...keys);
      } else {
        await redis.del(patternOrKey);
      }
      return;
    }
  } catch {
    redisEnabled = false;
  }
  if (patternOrKey.includes("*")) {
    const prefix = patternOrKey.replace(/\*/g, "");
    for (const key of memory.keys()) {
      if (key.startsWith(prefix)) memory.delete(key);
    }
  } else {
    memory.delete(patternOrKey);
  }
}
