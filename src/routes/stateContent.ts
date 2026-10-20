import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { cacheDel, cacheGet, cacheSet } from "../db/redis";
import { pool, query, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth, requireRoles } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const stateContentRouter = Router();

const COLS = `
  id, state, type, title, body, contact, phone, url, category,
  effective_date, published, submitted_by, created_at, updated_at
`;

stateContentRouter.get("/", async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const type = typeof req.query.type === "string" ? req.query.type : null;
    const includeUnpublished =
      req.query.includeUnpublished === "1" || req.query.includeUnpublished === "true";
    const cacheKey = `state_content:${includeUnpublished ? "all" : "pub"}:${state ?? "all"}:${type ?? "all"}`;

    const cached = await cacheGet<{ items: unknown[] }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    let sql = `SELECT ${COLS} FROM state_content WHERE 1=1`;
    const params: Record<string, unknown> = {};
    if (!includeUnpublished) {
      sql += ` AND published = 1`;
    }
    if (state) {
      sql += ` AND state = :state`;
      params.state = state;
    }
    if (type) {
      sql += ` AND type = :type`;
      params.type = type;
    }
    sql += ` ORDER BY updated_at DESC LIMIT 500`;

    const items = await query(sql, params);
    const payload = { items };
    await cacheSet(cacheKey, payload, 90);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

const upsertSchema = z.object({
  id: z.string().optional(),
  state: z.string().min(1),
  type: z.enum(["law", "order", "mda", "emergency", "notice", "announcement", "service"]),
  title: z.string().min(1),
  body: z.string().optional(),
  contact: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional(),
  category: z.string().optional(),
  effective_date: z.string().optional(),
  published: z.boolean().optional(),
});

stateContentRouter.post(
  "/",
  requireAuth,
  requireRoles("govt", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = upsertSchema.parse(req.body);
      const user = req.user!;

      if (user.role === "govt" && user.govtState && body.state !== user.govtState) {
        throw new HttpError(403, "You may only publish content for your state.");
      }

      const id = body.id ?? uuid();
      const existing = body.id
        ? await queryOne(`SELECT id FROM state_content WHERE id = :id`, { id })
        : null;

      if (existing) {
        await pool.query(
          `UPDATE state_content SET
            state=?, type=?, title=?, body=?, contact=?, phone=?, url=?,
            category=?, effective_date=?, published=?
           WHERE id=?`,
          [
            body.state,
            body.type,
            body.title,
            body.body ?? null,
            body.contact ?? null,
            body.phone ?? null,
            body.url ?? null,
            body.category ?? null,
            body.effective_date ?? null,
            body.published === false ? 0 : 1,
            id,
          ],
        );
      } else {
        await pool.query(
          `INSERT INTO state_content
            (id, state, type, title, body, contact, phone, url, category,
             effective_date, published, submitted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            body.state,
            body.type,
            body.title,
            body.body ?? null,
            body.contact ?? null,
            body.phone ?? null,
            body.url ?? null,
            body.category ?? null,
            body.effective_date ?? null,
            body.published === false ? 0 : 1,
            user.id,
          ],
        );
      }

      await cacheDel("state_content:*");
      const item = await queryOne(`SELECT ${COLS} FROM state_content WHERE id = :id`, { id });
      res.status(existing ? 200 : 201).json({ item });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);

stateContentRouter.delete(
  "/:id",
  requireAuth,
  requireRoles("govt", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const item = await queryOne<{ id: string; state: string }>(
        `SELECT id, state FROM state_content WHERE id = :id`,
        { id: req.params.id },
      );
      if (!item) throw new HttpError(404, "Content not found");
      if (
        req.user!.role === "govt" &&
        req.user!.govtState &&
        item.state !== req.user!.govtState
      ) {
        throw new HttpError(403, "You may only delete content for your state.");
      }
      await pool.query(`DELETE FROM state_content WHERE id = ?`, [item.id]);
      await cacheDel("state_content:*");
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
