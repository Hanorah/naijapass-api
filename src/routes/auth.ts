import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { config } from "../config";
import { pool, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth, signToken } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { authLimiter } from "../middleware/rateLimit";
import {
  getProfileById,
  invalidateProfileCache,
  loginUser,
  registerUser,
} from "../services/authService";
import { sendEmail } from "../services/email";
import { profileToSessionUser } from "../types";

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  state: z.string().optional(),
  role: z.enum(["individual", "business"]).optional(),
  businessName: z.string().optional(),
  businessType: z.string().optional(),
  cacNumber: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", authLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const user = await registerUser(body);
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus ?? "active",
      govtState: user.govtState ?? null,
    });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await loginUser(body.email, body.password);
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus ?? "active",
      govtState: user.govtState ?? null,
    });
    res.json({ token, user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const profile = await getProfileById(req.user!.id);
    if (!profile) {
      throw new HttpError(404, "Profile not found");
    }
    res.json({ user: profileToSessionUser(profile) });
  } catch (err) {
    next(err);
  }
});

authRouter.patch("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        fullName: z.string().min(1).optional(),
        phone: z.string().optional(),
        state: z.string().optional(),
        department: z.string().optional(),
        officeTitle: z.string().optional(),
        businessType: z.string().optional(),
        businessName: z.string().optional(),
        avatarUrl: z.union([z.string().url(), z.literal("")]).optional(),
      })
      .parse(req.body);

    await pool.query(
      `UPDATE profiles SET
        full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        state = COALESCE(?, state),
        department = COALESCE(?, department),
        office_title = COALESCE(?, office_title),
        business_type = COALESCE(?, business_type),
        business_name = COALESCE(?, business_name)
       WHERE id = ?`,
      [
        body.fullName?.trim() ?? null,
        body.phone?.trim() ?? null,
        body.state?.trim() ?? null,
        body.department?.trim() ?? null,
        body.officeTitle?.trim() ?? null,
        body.businessType?.trim() ?? null,
        body.businessName?.trim() ?? null,
        req.user!.id,
      ],
    );

    if (body.avatarUrl === "") {
      await pool.query(`UPDATE profiles SET avatar_url = NULL WHERE id = ?`, [req.user!.id]);
    } else if (body.avatarUrl) {
      await pool.query(`UPDATE profiles SET avatar_url = ? WHERE id = ?`, [
        body.avatarUrl.trim(),
        req.user!.id,
      ]);
    }

    await invalidateProfileCache(req.user!.id);
    const profile = await getProfileById(req.user!.id);
    if (!profile) throw new HttpError(404, "Profile not found");
    res.json({ user: profileToSessionUser(profile) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

authRouter.post("/change-password", requireAuth, authLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse(req.body);

    const user = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = :id`,
      { id: req.user!.id },
    );
    if (!user) throw new HttpError(404, "Account not found");

    const ok = await bcrypt.compare(body.currentPassword, user.password_hash);
    if (!ok) throw new HttpError(401, "Current password is incorrect.");

    const hash = await bcrypt.hash(body.newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, req.user!.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

authRouter.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const normalized = email.trim().toLowerCase();

    // Always return ok to avoid email enumeration.
    const user = await queryOne<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email = :email`,
      { email: normalized },
    );

    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(token);
      const id = uuid();
      await pool.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
        [id, user.id, tokenHash],
      );

      const resetUrl = `${config.appPublicUrl}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your NaijaPass password",
        text: `Reset your password (valid 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
        html: `<p>Reset your NaijaPass password (link valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

authRouter.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({
        token: z.string().min(20),
        newPassword: z.string().min(8),
      })
      .parse(req.body);

    const tokenHash = hashResetToken(body.token);
    const row = await queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = :hash AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      { hash: tokenHash },
    );
    if (!row) throw new HttpError(400, "Reset link is invalid or expired.");

    const hash = await bcrypt.hash(body.newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, row.user_id]);
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?`, [row.id]);

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});
