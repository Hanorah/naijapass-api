import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
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
import { profileToSessionUser } from "../types";

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
