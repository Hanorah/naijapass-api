import "dotenv/config";
import { randomBytes } from "crypto";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";

function jwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (isProd) {
    if (!fromEnv || fromEnv.length < 32 || /change.?me|dev-only|replace/i.test(fromEnv)) {
      throw new Error(
        "Production requires JWT_SECRET of at least 32 characters (not a placeholder).",
      );
    }
    return fromEnv;
  }
  return fromEnv || `dev-${randomBytes(24).toString("hex")}`;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  isProd,
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  mysql: {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "naijapass",
  },
  /** WSL Ubuntu Redis on this machine — cache only, not a remote deploy target */
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  jwtSecret: jwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  googleAiKey: process.env.GOOGLE_AI_API_KEY?.trim() || "",
  resendApiKey: process.env.RESEND_API_KEY?.trim() || "",
  resendFrom:
    process.env.RESEND_FROM_EMAIL?.trim() || "NaijaPass <onboarding@resend.dev>",
  kycApiKey: process.env.KYC_API_KEY?.trim() || "",
  kycProviderUrl: process.env.KYC_PROVIDER_URL?.trim() || "",
  /** Public base used in upload URLs (e.g. http://localhost:4000) */
  apiPublicUrl: (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(
    /\/$/,
    "",
  ),
  /** Frontend origin for password-reset links */
  appPublicUrl: (
    process.env.APP_PUBLIC_URL ??
    (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",")[0] ??
    "http://localhost:3000"
  )
    .trim()
    .replace(/\/$/, ""),
  /** Fixed seed admin password — do not rotate in this project */
  adminSeedPassword: "AdminPass123!",
  /** Seeded state-government demo password */
  govtSeedPassword: "GovtPass123!",
  trustProxy: process.env.TRUST_PROXY === "1",
};
