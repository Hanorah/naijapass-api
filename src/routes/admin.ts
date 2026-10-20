import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../db/mysql";
import { cacheDel } from "../db/redis";
import { requireAuth, requireRoles } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { invalidateProfileCache } from "../services/authService";
import { profileToSessionUser, type Profile } from "../types";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRoles("admin"));

const PROFILE_SQL = `
  SELECT id, email, full_name, phone, role, account_status, state, lga, kyc_status,
         business_name, business_type, cac_number, govt_state, department, office_title
  FROM profiles
`;

adminRouter.get("/users", async (req, res, next) => {
  try {
    const role = typeof req.query.role === "string" ? req.query.role : null;
    let sql = PROFILE_SQL;
    const params: Record<string, unknown> = {};
    if (role) {
      sql += ` WHERE role = :role`;
      params.role = role;
    }
    sql += ` ORDER BY created_at DESC LIMIT 500`;
    const rows = await query<Profile>(sql, params);
    res.json({ users: rows.map(profileToSessionUser) });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/users/:id", async (req, res, next) => {
  try {
    const body = z
      .object({
        account_status: z.enum(["pending", "active", "suspended", "rejected"]).optional(),
        role: z.enum(["individual", "business", "govt", "admin"]).optional(),
        kyc_status: z.enum(["unverified", "pending", "verified", "rejected"]).optional(),
        govt_state: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existing = await queryOne<{ id: string }>(`SELECT id FROM profiles WHERE id = :id`, {
      id: req.params.id,
    });
    if (!existing) throw new HttpError(404, "User not found");

    if (body.account_status) {
      await pool.query(`UPDATE profiles SET account_status = ? WHERE id = ?`, [
        body.account_status,
        req.params.id,
      ]);
    }
    if (body.role) {
      await pool.query(`UPDATE profiles SET role = ? WHERE id = ?`, [body.role, req.params.id]);
    }
    if (body.kyc_status) {
      await pool.query(`UPDATE profiles SET kyc_status = ? WHERE id = ?`, [
        body.kyc_status,
        req.params.id,
      ]);
    }
    if (body.govt_state !== undefined) {
      await pool.query(`UPDATE profiles SET govt_state = ? WHERE id = ?`, [
        body.govt_state,
        req.params.id,
      ]);
    }

    await invalidateProfileCache(req.params.id);
    const profile = await queryOne<Profile>(`${PROFILE_SQL} WHERE id = :id`, {
      id: req.params.id,
    });
    res.json({ user: profile ? profileToSessionUser(profile) : null });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

adminRouter.patch("/businesses/:id/status", async (req, res, next) => {
  try {
    const status = z.enum(["pending", "live", "hidden", "suspended"]).parse(req.body?.status);
    await pool.query(`UPDATE businesses SET status = ? WHERE id = ?`, [status, req.params.id]);
    await cacheDel("businesses:*");
    const business = await queryOne(`SELECT * FROM businesses WHERE id = :id`, {
      id: req.params.id,
    });
    if (!business) throw new HttpError(404, "Business not found");
    res.json({ business });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

adminRouter.get("/feedback", async (_req, res, next) => {
  try {
    const feedback = await query(
      `SELECT * FROM project_feedback ORDER BY created_at DESC LIMIT 500`,
    );
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/feedback/:id", async (req, res, next) => {
  try {
    const visibility = z.enum(["public", "hidden"]).parse(req.body?.visibility);
    await pool.query(`UPDATE project_feedback SET visibility = ? WHERE id = ?`, [
      visibility,
      req.params.id,
    ]);
    const feedback = await queryOne(`SELECT * FROM project_feedback WHERE id = :id`, {
      id: req.params.id,
    });
    if (!feedback) throw new HttpError(404, "Feedback not found");
    res.json({ feedback });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});
