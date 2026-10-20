import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { cacheDel, cacheGet, cacheSet } from "../db/redis";
import { pool, query, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const businessesRouter = Router();

const BUSINESS_COLS = `
  id, owner_id, name, category, subcategory, state, lga, address, phone, email,
  website, description, verified, rating, review_count, status, cac_number,
  year_founded, employees, services, image_url, created_at, updated_at
`;

type BusinessRow = Record<string, unknown>;

function parseServices(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapBusiness(row: BusinessRow | null) {
  if (!row) return null;
  return { ...row, services: parseServices(row.services) };
}

businessesRouter.get("/", async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const cacheKey = `businesses:live:${state ?? "all"}`;
    const cached = await cacheGet<{ businesses: unknown[] }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    let sql = `SELECT ${BUSINESS_COLS} FROM businesses WHERE status = 'live'`;
    const params: Record<string, unknown> = {};
    if (state) {
      sql += ` AND state = :state`;
      params.state = state;
    }
    sql += ` ORDER BY verified DESC, name ASC LIMIT 200`;

    const rows = await query<BusinessRow>(sql, params);
    const payload = { businesses: rows.map(mapBusiness) };
    await cacheSet(cacheKey, payload, 60);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

businessesRouter.get("/mine", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const row = await queryOne<BusinessRow>(
      `SELECT ${BUSINESS_COLS} FROM businesses WHERE owner_id = :ownerId LIMIT 1`,
      { ownerId: req.user!.id },
    );
    res.json({ business: mapBusiness(row) });
  } catch (err) {
    next(err);
  }
});

businessesRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await queryOne<BusinessRow>(
      `SELECT ${BUSINESS_COLS} FROM businesses WHERE id = :id LIMIT 1`,
      { id: req.params.id },
    );
    if (!row) throw new HttpError(404, "Business not found");
    res.json({ business: mapBusiness(row) });
  } catch (err) {
    next(err);
  }
});

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  state: z.string().min(1),
  lga: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  description: z.string().optional(),
  services: z.array(z.string()).optional(),
  image: z.string().optional(),
  yearFounded: z.string().optional(),
  employees: z.string().optional(),
  verified: z.boolean().optional(),
  status: z.enum(["pending", "live", "hidden", "suspended"]).optional(),
});

businessesRouter.patch("/:id/status", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const status = z.enum(["pending", "live", "hidden", "suspended"]).parse(req.body?.status);
    const row = await queryOne<{ id: string; owner_id: string | null }>(
      `SELECT id, owner_id FROM businesses WHERE id = :id`,
      { id: req.params.id },
    );
    if (!row) throw new HttpError(404, "Business not found");
    if (req.user!.role !== "admin" && row.owner_id !== req.user!.id) {
      throw new HttpError(403, "Not allowed.");
    }
    await pool.query(`UPDATE businesses SET status = ? WHERE id = ?`, [status, row.id]);
    await cacheDel("businesses:*");
    const business = mapBusiness(
      await queryOne<BusinessRow>(`SELECT ${BUSINESS_COLS} FROM businesses WHERE id = :id`, {
        id: row.id,
      }),
    );
    res.json({ business });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});

businessesRouter.post("/", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = upsertSchema.parse(req.body);
    const ownerId = req.user!.id;
    const status = body.status ?? "live";

    const owned = await queryOne<{ id: string }>(
      `SELECT id FROM businesses WHERE owner_id = :ownerId LIMIT 1`,
      { ownerId },
    );

    const targetId = body.id && owned?.id === body.id ? body.id : owned?.id;
    const servicesJson = JSON.stringify(body.services ?? []);
    const imageUrl =
      body.image &&
      (/^https?:\/\//i.test(body.image) ||
        (body.image.startsWith("data:image/") && body.image.length <= 180_000))
        ? body.image
        : null;

    if (targetId) {
      await pool.query(
        `UPDATE businesses SET
          name = ?, category = ?, subcategory = ?, state = ?, lga = ?,
          address = ?, phone = ?, email = ?, website = ?, description = ?,
          services = ?, image_url = COALESCE(?, image_url), year_founded = ?,
          employees = ?, status = ?, verified = ?
         WHERE id = ? AND owner_id = ?`,
        [
          body.name.trim(),
          body.category,
          body.subcategory.trim(),
          body.state,
          body.lga,
          body.address?.trim() || null,
          body.phone?.trim() || null,
          body.email?.trim() || req.user!.email,
          body.website?.trim() || null,
          body.description?.trim() || null,
          servicesJson,
          imageUrl,
          body.yearFounded?.trim() || null,
          body.employees?.trim() || null,
          status,
          body.verified ? 1 : 0,
          targetId,
          ownerId,
        ],
      );
      await cacheDel("businesses:*");
      const business = mapBusiness(
        await queryOne<BusinessRow>(`SELECT ${BUSINESS_COLS} FROM businesses WHERE id = :id`, {
          id: targetId,
        }),
      );
      res.json({ business });
      return;
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO businesses
        (id, owner_id, name, category, subcategory, state, lga, address, phone, email,
         website, description, services, image_url, year_founded, employees, status, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ownerId,
        body.name.trim(),
        body.category,
        body.subcategory.trim(),
        body.state,
        body.lga,
        body.address?.trim() || null,
        body.phone?.trim() || null,
        body.email?.trim() || req.user!.email,
        body.website?.trim() || null,
        body.description?.trim() || null,
        servicesJson,
        imageUrl,
        body.yearFounded?.trim() || null,
        body.employees?.trim() || null,
        status,
        body.verified ? 1 : 0,
      ],
    );
    await cacheDel("businesses:*");
    const business = mapBusiness(
      await queryOne<BusinessRow>(`SELECT ${BUSINESS_COLS} FROM businesses WHERE id = :id`, { id }),
    );
    res.status(201).json({ business });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});
