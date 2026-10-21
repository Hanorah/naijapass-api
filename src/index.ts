import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config";
import { pingMysql } from "./db/mysql";
import { pingRedis } from "./db/redis";
import { errorHandler, notFound } from "./middleware/error";
import { globalLimiter } from "./middleware/rateLimit";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { businessesRouter } from "./routes/businesses";
import { chatRouter } from "./routes/chat";
import { healthRouter } from "./routes/health";
import { kycRouter } from "./routes/kyc";
import { listingsRouter } from "./routes/listings";
import { projectsRouter } from "./routes/projects";
import { stateContentRouter } from "./routes/stateContent";
import { tendersRouter } from "./routes/tenders";
import { uploadsRouter } from "./routes/uploads";

async function main() {
  const app = express();

  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser clients (curl, server-to-server) send no Origin.
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        // Vercel preview URLs change per deploy — allow when enabled.
        if (
          config.corsAllowVercel &&
          /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
        ) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(globalLimiter);
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(config.isProd ? "combined" : "dev"));

  app.get("/", (_req, res) => {
    res.json({
      service: "naijapass-api",
      ok: true,
      health: "/health",
      docs: {
        auth: "/api/auth",
        projects: "/api/projects",
        tenders: "/api/tenders",
        businesses: "/api/businesses",
        listings: "/api/listings",
        stateContent: "/api/state-content",
      },
    });
  });

  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/tenders", tendersRouter);
  app.use("/api/businesses", businessesRouter);
  app.use("/api/listings", listingsRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/state-content", stateContentRouter);
  app.use("/api/kyc", kycRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/admin", adminRouter);

  app.use(notFound);
  app.use(errorHandler);

  const mysqlOk = await pingMysql();
  if (!mysqlOk) {
    console.warn("⚠ MySQL not reachable yet — start XAMPP MySQL and run npm run db:migrate");
  }

  const redisOk = await pingRedis();
  console.log(
    redisOk
      ? "✓ Redis connected (WSL)"
      : "⚠ Redis not reachable — in-memory cache active",
  );

  app.listen(config.port, () => {
    console.log(`NaijaPass API listening on http://localhost:${config.port}`);
    console.log(`Env: ${config.nodeEnv} | CORS: ${config.corsOrigins.join(", ")}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
