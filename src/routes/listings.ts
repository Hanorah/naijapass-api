import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { cacheDel, cacheGet, cacheSet } from "../db/redis";
import { pool, query, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth, requireRoles } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const listingsRouter = Router();

const LISTING_COLS = `
  id, seller_id, business_id, title, category, state, lga, price, currency,
  description, status, image_url, created_at, updated_at
`;

type ListingRow = Record<string, unknown>;

listingsRouter.get("/", async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const cacheKey = `listings:live:${state ?? "all"}`;
    const cached = await cacheGet<{ listings: unknown[] }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    let sql = `SELECT ${LISTING_COLS} FROM listings WHERE status = 'live'`;
    const params: Record<string, unknown> = {};
    if (state) {
      sql += ` AND state = :state`;
      params.state = state;
    }
    sql += ` ORDER BY created_at DESC LIMIT 200`;

    const rows = await query<ListingRow>(sql, params);
    const payload = { listings: rows };
    await cacheSet(cacheKey, payload, 60);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

listingsRouter.get("/mine", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await query<ListingRow>(
      `SELECT ${LISTING_COLS} FROM listings WHERE seller_id = :sellerId ORDER BY created_at DESC`,
      { sellerId: req.user!.id },
    );
    res.json({ listings: rows });
  } catch (err) {
    next(err);
  }
});

listingsRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await queryOne<ListingRow>(
      `SELECT ${LISTING_COLS} FROM listings WHERE id = :id`,
      { id: req.params.id },
    );
    if (!row) throw new HttpError(404, "Listing not found");
    res.json({ listing: row });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  state: z.string().min(1),
  lga: z.string().optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  businessId: z.string().optional(),
  status: z.enum(["pending", "live", "hidden"]).optional(),
});

listingsRouter.post(
  "/",
  requireAuth,
  requireRoles("business", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const id = uuid();
      const status =
        body.status ?? (req.user!.role === "admin" ? "live" : "pending");

      await pool.query(
        `INSERT INTO listings
          (id, seller_id, business_id, title, category, state, lga, price, currency,
           description, status, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.user!.id,
          body.businessId ?? null,
          body.title.trim(),
          body.category.trim(),
          body.state.trim(),
          body.lga?.trim() ?? null,
          body.price ?? null,
          body.currency ?? "NGN",
          body.description?.trim() ?? null,
          status,
          body.imageUrl?.trim() ?? null,
        ],
      );

      await cacheDel("listings:live:all");
      if (body.state) await cacheDel(`listings:live:${body.state.trim()}`);

      const listing = await queryOne(`SELECT ${LISTING_COLS} FROM listings WHERE id = :id`, {
        id,
      });
      res.status(201).json({ listing });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);

listingsRouter.patch("/:id/status", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const status = z
      .enum(["pending", "live", "hidden", "sold", "expired"])
      .parse(req.body?.status);

    const row = await queryOne<{ id: string; seller_id: string | null; state: string }>(
      `SELECT id, seller_id, state FROM listings WHERE id = :id`,
      { id: req.params.id },
    );
    if (!row) throw new HttpError(404, "Listing not found");
    if (req.user!.role !== "admin" && row.seller_id !== req.user!.id) {
      throw new HttpError(403, "Not allowed.");
    }

    await pool.query(`UPDATE listings SET status = ? WHERE id = ?`, [status, row.id]);
    await cacheDel("listings:live:all");
    if (row.state) await cacheDel(`listings:live:${row.state}`);

    const listing = await queryOne(`SELECT ${LISTING_COLS} FROM listings WHERE id = :id`, {
      id: row.id,
    });
    res.json({ listing });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});
