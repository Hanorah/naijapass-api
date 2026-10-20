import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { cacheDel, cacheGet, cacheSet } from "../db/redis";
import { pool, query, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth, requireRoles } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const tendersRouter = Router();

type TenderRow = {
  id: string;
  title: string;
  reference: string | null;
  mda: string | null;
  state: string | null;
  sector: string | null;
  value: number | null;
  currency: string;
  deadline: string | null;
  status: string;
  description: string | null;
  source: string | null;
  published_at: string | null;
  lga: string | null;
  contact_email: string | null;
  document_url: string | null;
  submitted_by: string | null;
  publisher_type: string;
  business_id: string | null;
  created_at: string;
};

const TENDER_COLS = `
  id, title, reference, mda, state, sector, value, currency, deadline, status,
  description, source, published_at, lga, contact_email, document_url, submitted_by,
  publisher_type, business_id, created_at
`;

tendersRouter.get("/", async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const status = typeof req.query.status === "string" ? req.query.status : "open";
    const cacheKey = `tenders:${status}:${state ?? "all"}`;

    const cached = await cacheGet<{ tenders: TenderRow[]; count: number }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    let sql = `SELECT ${TENDER_COLS} FROM tenders WHERE status = :status`;
    const params: Record<string, unknown> = { status };
    if (state) {
      sql += ` AND (state IS NULL OR state = :state)`;
      params.state = state;
    }
    sql += ` ORDER BY deadline IS NULL, deadline ASC`;

    const tenders = await query<TenderRow>(sql, params);
    const payload = { tenders, count: tenders.length };
    await cacheSet(cacheKey, payload, 45);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/:id", async (req, res, next) => {
  try {
    const tender = await queryOne<TenderRow>(
      `SELECT ${TENDER_COLS} FROM tenders WHERE id = :id`,
      { id: req.params.id },
    );
    if (!tender) throw new HttpError(404, "Tender not found");
    res.json({ tender });
  } catch (err) {
    next(err);
  }
});

const upsertSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3),
  reference: z.string().optional(),
  mda: z.string().optional(),
  state: z.string().optional(),
  sector: z.string().optional(),
  value: z.number().optional(),
  currency: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(["open", "closed", "awarded", "cancelled"]).optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  lga: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal("")),
  document_url: z.string().optional(),
  publisher_type: z.enum(["govt", "business", "federal"]).optional(),
  business_id: z.string().optional(),
});

tendersRouter.post(
  "/",
  requireAuth,
  requireRoles("govt", "business", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = upsertSchema.parse(req.body);
      const user = req.user!;
      const publisherType =
        body.publisher_type ??
        (user.role === "business" ? "business" : user.role === "admin" ? "federal" : "govt");

      if (user.role === "govt" && user.govtState) {
        if (body.state && body.state !== user.govtState) {
          throw new HttpError(403, "You may only publish tenders for your state.");
        }
        body.state = user.govtState;
      }

      const id = body.id ?? uuid();
      const existing = body.id
        ? await queryOne<{ id: string; submitted_by: string | null }>(
            `SELECT id, submitted_by FROM tenders WHERE id = :id`,
            { id: body.id },
          )
        : null;

      if (existing) {
        if (
          user.role !== "admin" &&
          existing.submitted_by &&
          existing.submitted_by !== user.id &&
          user.role !== "govt"
        ) {
          throw new HttpError(403, "Not allowed to update this tender.");
        }
        await pool.query(
          `UPDATE tenders SET
            title = ?, reference = ?, mda = ?, state = ?, sector = ?, value = ?,
            currency = ?, deadline = ?, status = ?, description = ?, source = ?,
            lga = ?, contact_email = ?, document_url = ?, publisher_type = ?, business_id = ?
           WHERE id = ?`,
          [
            body.title,
            body.reference ?? null,
            body.mda ?? null,
            body.state ?? null,
            body.sector ?? null,
            body.value ?? null,
            body.currency ?? "NGN",
            body.deadline ?? null,
            body.status ?? "open",
            body.description ?? null,
            body.source ?? null,
            body.lga ?? null,
            body.contact_email || null,
            body.document_url ?? null,
            publisherType,
            body.business_id ?? null,
            id,
          ],
        );
      } else {
        await pool.query(
          `INSERT INTO tenders
            (id, title, reference, mda, state, sector, value, currency, deadline, status,
             description, source, published_at, lga, contact_email, document_url,
             submitted_by, publisher_type, business_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
          [
            id,
            body.title,
            body.reference ?? null,
            body.mda ?? null,
            body.state ?? null,
            body.sector ?? null,
            body.value ?? null,
            body.currency ?? "NGN",
            body.deadline ?? null,
            body.status ?? "open",
            body.description ?? null,
            body.source ?? null,
            body.lga ?? null,
            body.contact_email || null,
            body.document_url ?? null,
            user.id,
            publisherType,
            body.business_id ?? null,
          ],
        );
      }

      await cacheDel("tenders:*");
      const tender = await queryOne<TenderRow>(
        `SELECT ${TENDER_COLS} FROM tenders WHERE id = :id`,
        { id },
      );
      res.status(existing ? 200 : 201).json({ tender });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);

tendersRouter.delete(
  "/:id",
  requireAuth,
  requireRoles("govt", "business", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const tender = await queryOne<{
        id: string;
        state: string | null;
        submitted_by: string | null;
        publisher_type: string;
      }>(`SELECT id, state, submitted_by, publisher_type FROM tenders WHERE id = :id`, {
        id: req.params.id,
      });
      if (!tender) throw new HttpError(404, "Tender not found");

      const user = req.user!;
      const allowed =
        user.role === "admin" ||
        (user.role === "govt" && user.govtState && tender.state === user.govtState) ||
        (user.role === "business" &&
          tender.publisher_type === "business" &&
          tender.submitted_by === user.id);

      if (!allowed) throw new HttpError(403, "Not allowed to delete this tender.");

      await pool.query(`DELETE FROM tenders WHERE id = ?`, [tender.id]);
      await cacheDel("tenders:*");
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Bids ───────────────────────────────────────────────────

tendersRouter.get("/:id/bids", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenderId = req.params.id;
    const tender = await queryOne<{ id: string; submitted_by: string | null; state: string | null }>(
      `SELECT id, submitted_by, state FROM tenders WHERE id = :id`,
      { id: tenderId },
    );
    if (!tender) throw new HttpError(404, "Tender not found");

    const user = req.user!;
    const isPublisher = tender.submitted_by === user.id || user.role === "admin";
    const isGovtFor =
      user.role === "govt" && user.govtState && tender.state === user.govtState;

    let sql = `SELECT * FROM tender_bids WHERE tender_id = :tenderId`;
    const params: Record<string, unknown> = { tenderId };
    if (!isPublisher && !isGovtFor) {
      sql += ` AND bidder_id = :bidderId`;
      params.bidderId = user.id;
    }

    const bids = await query(sql, params);
    res.json({ bids });
  } catch (err) {
    next(err);
  }
});

const bidSchema = z.object({
  business_name: z.string().min(1),
  contact_email: z.string().email(),
  proposed_amount: z.number().optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
  business_id: z.string().optional(),
});

tendersRouter.post(
  "/:id/bids",
  requireAuth,
  requireRoles("business", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = bidSchema.parse(req.body);
      const tenderId = req.params.id;
      const tender = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM tenders WHERE id = :id`,
        { id: tenderId },
      );
      if (!tender) throw new HttpError(404, "Tender not found");
      if (tender.status !== "open") {
        throw new HttpError(400, "This tender is not open for bids.");
      }

      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM tender_bids WHERE tender_id = :tenderId AND bidder_id = :bidderId`,
        { tenderId, bidderId: req.user!.id },
      );
      if (existing) {
        throw new HttpError(409, "You already submitted a bid for this tender.");
      }

      const id = uuid();
      await pool.query(
        `INSERT INTO tender_bids
          (id, tender_id, bidder_id, business_id, business_name, contact_email,
           proposed_amount, currency, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
        [
          id,
          tenderId,
          req.user!.id,
          body.business_id ?? null,
          body.business_name,
          body.contact_email,
          body.proposed_amount ?? null,
          body.currency ?? "NGN",
          body.notes ?? null,
        ],
      );

      const bid = await queryOne(`SELECT * FROM tender_bids WHERE id = :id`, { id });
      res.status(201).json({ bid });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);

tendersRouter.patch(
  "/:id/bids/:bidId",
  requireAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const status = z
        .enum(["withdrawn", "accepted", "rejected", "submitted"])
        .parse(req.body?.status);

      const bid = await queryOne<{
        id: string;
        bidder_id: string;
        tender_id: string;
      }>(`SELECT id, bidder_id, tender_id FROM tender_bids WHERE id = :id`, {
        id: req.params.bidId,
      });
      if (!bid || bid.tender_id !== req.params.id) {
        throw new HttpError(404, "Bid not found");
      }

      const tender = await queryOne<{ submitted_by: string | null }>(
        `SELECT submitted_by FROM tenders WHERE id = :id`,
        { id: bid.tender_id },
      );

      const user = req.user!;
      const isBidder = bid.bidder_id === user.id;
      const isPublisher = tender?.submitted_by === user.id || user.role === "admin";

      if (status === "withdrawn" && !isBidder && user.role !== "admin") {
        throw new HttpError(403, "Only the bidder can withdraw.");
      }
      if ((status === "accepted" || status === "rejected") && !isPublisher) {
        throw new HttpError(403, "Only the publisher can accept or reject.");
      }

      await pool.query(`UPDATE tender_bids SET status = ? WHERE id = ?`, [status, bid.id]);
      const updated = await queryOne(`SELECT * FROM tender_bids WHERE id = :id`, { id: bid.id });
      res.json({ bid: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);
