import { Router } from "express";
import { pingMysql } from "../db/mysql";
import { pingRedis } from "../db/redis";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const [mysqlOk, redisOk] = await Promise.all([pingMysql(), pingRedis()]);
  // MySQL is required; Redis is optional (in-memory cache used on XAMPP/Windows).
  const ok = mysqlOk;
  res.status(ok ? 200 : 503).json({
    ok,
    service: "naijapass-api",
    mysql: mysqlOk,
    redis: redisOk,
    cache: redisOk ? "redis" : "memory",
    time: new Date().toISOString(),
  });
});
