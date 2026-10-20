import rateLimit from "express-rate-limit";
import { config } from "../config";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isProd ? 600 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isProd ? 30 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again later." },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.isProd ? 40 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Upload limit reached. Try again later." },
});
