import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { pool, queryOne } from "../db/mysql";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { uploadLimiter } from "../middleware/rateLimit";

export const uploadsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WebP, or GIF images are allowed."));
      return;
    }
    cb(null, true);
  },
});

function publicUrl(id: string) {
  return `${config.apiPublicUrl}/api/uploads/${id}`;
}

/** Serve file bytes from MySQL */
uploadsRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await queryOne<{
      filename: string;
      mime: string;
      data: Buffer;
    }>(`SELECT filename, mime, data FROM file_uploads WHERE id = :id`, {
      id: req.params.id,
    });
    if (!row) throw new HttpError(404, "File not found");

    res.setHeader("Content-Type", row.mime);
    res.setHeader("Content-Disposition", `inline; filename="${row.filename.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(row.data);
  } catch (err) {
    next(err);
  }
});

uploadsRouter.post(
  "/",
  requireAuth,
  uploadLimiter,
  (req: AuthedRequest, res, next) => {
    upload.single("file")(req, res, async (err: unknown) => {
      if (err) {
        next(new HttpError(400, err instanceof Error ? err.message : "Upload failed."));
        return;
      }
      try {
        if (!req.file?.buffer?.length) {
          throw new HttpError(400, 'No file uploaded. Use multipart field name "file".');
        }

        const id = uuid();
        const filename = (req.file.originalname || "upload.bin").slice(0, 255);

        await pool.query(
          `INSERT INTO file_uploads (id, owner_id, filename, mime, size, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            req.user!.id,
            filename,
            req.file.mimetype,
            req.file.size,
            req.file.buffer,
          ],
        );

        res.status(201).json({
          id,
          url: publicUrl(id),
          filename,
          size: req.file.size,
          mime: req.file.mimetype,
          uploadedBy: req.user!.id,
          storage: "mysql",
        });
      } catch (e) {
        next(e);
      }
    });
  },
);
