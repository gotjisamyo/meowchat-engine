import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,
});

redis.on("error", (err) => {
  console.error("[Redis] connection error:", err.message);
});

redis.on("connect", () => {
  console.log("[Redis] connected");
});
