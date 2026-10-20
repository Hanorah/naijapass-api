import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { cacheDel, cacheGet, cacheSet } from "../db/redis";
import { pool, query, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth, requireRoles } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const projectsRouter = Router();

const PROJECT_COLS = `
  id, title, category, description, budget_ngn, budget_label, state, lga, status,
  contractor, completion, reports_count, featured, era, supervising_agency,
  source_title, source_url, image_url, notes, published, review_status,
  start_date, expected_completion, submitted_by, created_at, updated_at
`;

projectsRouter.get("/", async (req, res, next) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const includeDrafts = req.query.includeDrafts === "1" || req.query.includeDrafts === "true";
    const cacheKey = `projects:${includeDrafts ? "all" : "pub"}:${state ?? "all"}`;
    const cached = await cacheGet<{ projects: unknown[] }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    let sql = `SELECT ${PROJECT_COLS} FROM projects WHERE 1=1`;
    const params: Record<string, unknown> = {};
    if (!includeDrafts) {
      sql += ` AND published = 1 AND review_status = 'published'`;
    }
    if (state) {
      sql += ` AND state = :state`;
      params.state = state;
    }
    sql += ` ORDER BY featured DESC, updated_at DESC LIMIT 300`;

    const projects = await query(sql, params);
    const payload = { projects };
    await cacheSet(cacheKey, payload, 60);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

projectsRouter.get("/:id", async (req, res, next) => {
  try {
    const project = await queryOne(
      `SELECT ${PROJECT_COLS} FROM projects WHERE id = :id`,
      { id: req.params.id },
    );
    if (!project) throw new HttpError(404, "Project not found");
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

function buildProjectId(state: string, title: string) {
  const statePart = state.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  const titlePart = title
    .replace(/[^A-Za-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 6)
    .toUpperCase();
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  return `NP-${statePart || "NGA"}-${titlePart || "PRJ"}${suffix}`;
}

const upsertSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3),
  category: z.string().min(1),
  description: z.string().optional(),
  budget_ngn: z.number().optional(),
  budget_label: z.string().optional(),
  state: z.string().min(1),
  lga: z.string().optional(),
  status: z.enum(["In Progress", "Completed", "Planned", "Stalled"]).optional(),
  contractor: z.string().optional(),
  completion: z.string().optional(),
  featured: z.boolean().optional(),
  era: z.enum(["current", "previous", "legacy"]).optional(),
  supervising_agency: z.string().optional(),
  source_title: z.string().optional(),
  source_url: z.string().optional(),
  image_url: z.string().optional(),
  notes: z.string().optional(),
  published: z.boolean().optional(),
  review_status: z.enum(["draft", "published", "archived"]).optional(),
  start_date: z.string().optional(),
  expected_completion: z.string().optional(),
});

projectsRouter.post(
  "/",
  requireAuth,
  requireRoles("govt", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = upsertSchema.parse(req.body);
      const user = req.user!;

      if (user.role === "govt" && user.govtState && body.state !== user.govtState) {
        throw new HttpError(403, "You may only manage projects for your state.");
      }

      const id = body.id ?? buildProjectId(body.state, body.title);
      const existing = body.id
        ? await queryOne<{ id: string }>(`SELECT id FROM projects WHERE id = :id`, { id })
        : null;

      const values = [
        body.title,
        body.category,
        body.description ?? null,
        body.budget_ngn ?? 0,
        body.budget_label ?? "TBA",
        body.state,
        body.lga ?? null,
        body.status ?? "In Progress",
        body.contractor ?? null,
        body.completion ?? null,
        body.featured ? 1 : 0,
        body.era ?? "current",
        body.supervising_agency ?? null,
        body.source_title ?? null,
        body.source_url ?? null,
        body.image_url ?? null,
        body.notes ?? null,
        body.published === false ? 0 : 1,
        body.review_status ?? "published",
        body.start_date ?? null,
        body.expected_completion ?? null,
        user.id,
      ];

      if (existing) {
        await pool.query(
          `UPDATE projects SET
            title=?, category=?, description=?, budget_ngn=?, budget_label=?, state=?, lga=?,
            status=?, contractor=?, completion=?, featured=?, era=?, supervising_agency=?,
            source_title=?, source_url=?, image_url=?, notes=?, published=?, review_status=?,
            start_date=?, expected_completion=?, submitted_by=?
           WHERE id=?`,
          [...values, id],
        );
      } else {
        await pool.query(
          `INSERT INTO projects
            (id, title, category, description, budget_ngn, budget_label, state, lga, status,
             contractor, completion, featured, era, supervising_agency, source_title, source_url,
             image_url, notes, published, review_status, start_date, expected_completion, submitted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, ...values],
        );
      }

      await cacheDel("projects:*");
      const project = await queryOne(`SELECT ${PROJECT_COLS} FROM projects WHERE id = :id`, { id });
      res.status(existing ? 200 : 201).json({ project });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);

projectsRouter.delete(
  "/:id",
  requireAuth,
  requireRoles("govt", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const project = await queryOne<{ id: string; state: string }>(
        `SELECT id, state FROM projects WHERE id = :id`,
        { id: req.params.id },
      );
      if (!project) throw new HttpError(404, "Project not found");
      if (
        req.user!.role === "govt" &&
        req.user!.govtState &&
        project.state !== req.user!.govtState
      ) {
        throw new HttpError(403, "You may only delete projects for your state.");
      }
      await pool.query(`DELETE FROM projects WHERE id = ?`, [req.params.id]);
      await cacheDel("projects:*");
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

projectsRouter.patch(
  "/feedback/:feedbackId",
  requireAuth,
  requireRoles("govt", "admin"),
  async (req: AuthedRequest, res, next) => {
    try {
      const visibility = z.enum(["public", "hidden"]).parse(req.body?.visibility);
      const row = await queryOne<{ id: string; project_id: string }>(
        `SELECT id, project_id FROM project_feedback WHERE id = :id`,
        { id: req.params.feedbackId },
      );
      if (!row) throw new HttpError(404, "Feedback not found");

      if (req.user!.role === "govt" && req.user!.govtState) {
        const project = await queryOne<{ state: string }>(
          `SELECT state FROM projects WHERE id = :id`,
          { id: row.project_id },
        );
        if (!project || project.state !== req.user!.govtState) {
          throw new HttpError(403, "Not allowed to moderate this feedback.");
        }
      }

      await pool.query(`UPDATE project_feedback SET visibility = ? WHERE id = ?`, [
        visibility,
        row.id,
      ]);
      const feedback = await queryOne(`SELECT * FROM project_feedback WHERE id = :id`, {
        id: row.id,
      });
      res.json({ feedback });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
        return;
      }
      next(err);
    }
  },
);

// Feedback
projectsRouter.get("/:id/feedback", async (req, res, next) => {
  try {
    const feedback = await query(
      `SELECT id, project_id, user_id, user_name, user_email, rating, topic, body, visibility, created_at
       FROM project_feedback
       WHERE project_id = :id AND visibility = 'public'
       ORDER BY created_at DESC`,
      { id: req.params.id },
    );
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});

projectsRouter.post("/:id/feedback", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        rating: z.number().int().min(1).max(5),
        topic: z.string().optional(),
        body: z.string().min(3),
      })
      .parse(req.body);

    const project = await queryOne(`SELECT id FROM projects WHERE id = :id`, {
      id: req.params.id,
    });
    if (!project) throw new HttpError(404, "Project not found");

    const id = uuid();
    await pool.query(
      `INSERT INTO project_feedback
        (id, project_id, user_id, user_name, user_email, rating, topic, body, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public')`,
      [
        id,
        req.params.id,
        req.user!.id,
        req.user!.email.split("@")[0],
        req.user!.email,
        body.rating,
        body.topic ?? null,
        body.body,
      ],
    );

    const row = await queryOne(`SELECT * FROM project_feedback WHERE id = :id`, { id });
    res.status(201).json({ feedback: row });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.errors[0]?.message ?? "Invalid payload"));
      return;
    }
    next(err);
  }
});
