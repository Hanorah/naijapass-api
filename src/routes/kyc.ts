import { Router } from "express";
import { createHash } from "crypto";
import { v4 as uuid } from "uuid";
import { pool } from "../db/mysql";
import { AuthedRequest, optionalAuth, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { invalidateProfileCache } from "../services/authService";

export const kycRouter = Router();

function hashId(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

type KycBody = {
  type?: "individual" | "business";
  method?: "nin" | "bvn" | "cac" | "tin";
  value?: string;
  nin?: string;
  bvn?: string;
  rcNumber?: string;
  tin?: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
};

/**
 * Accepts the same payload shape as the Next.js /api/kyc/verify route.
 * Format validation only — swap in a real provider for production.
 */
kycRouter.post("/verify", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as KycBody;

    if (body.type === "individual" || body.nin || body.method === "nin") {
      const nin = (body.nin ?? body.value ?? "").trim();
      if (!/^\d{11}$/.test(nin)) {
        throw new HttpError(400, "NIN must be exactly 11 digits.");
      }
      if (body.type === "individual" && (!body.firstName?.trim() || !body.lastName?.trim())) {
        throw new HttpError(400, "First and last name are required.");
      }

      if (req.user) {
        const id = uuid();
        await pool.query(
          `INSERT INTO kyc_verifications (id, user_id, method, status, provider, notes)
           VALUES (?, ?, 'nin', 'verified', 'stub', 'Format-validated')`,
          [id, req.user.id],
        );
        await pool.query(
          `UPDATE profiles SET kyc_status = 'verified', nin_hash = ?, account_status = 'active',
             full_name = COALESCE(NULLIF(?, ''), full_name)
           WHERE id = ?`,
          [
            hashId(nin),
            [body.firstName, body.lastName].filter(Boolean).join(" ").trim(),
            req.user.id,
          ],
        );
        await invalidateProfileCache(req.user.id);
      }

      res.json({
        verified: true,
        status: "verified_format",
        message: "Identity format validated.",
        reference: `NIN-FMT-${nin.slice(-4)}`,
      });
      return;
    }

    if (body.type === "business" || body.rcNumber || body.method === "cac") {
      const rc = (body.rcNumber ?? body.value ?? "").trim();
      const tin = (body.tin ?? "").trim();
      if (!/^RC\d{5,8}$/i.test(rc) && !/^BN\d{5,8}$/i.test(rc)) {
        throw new HttpError(400, "RC number must be in format RC1234567 or BN1234567.");
      }
      if (tin && !/^\d{8,14}$/.test(tin)) {
        throw new HttpError(400, "TIN must be 8–14 digits.");
      }

      if (req.user) {
        const id = uuid();
        await pool.query(
          `INSERT INTO kyc_verifications (id, user_id, method, status, provider, notes)
           VALUES (?, ?, 'cac', 'verified', 'stub', 'Format-validated')`,
          [id, req.user.id],
        );
        await pool.query(
          `UPDATE profiles SET kyc_status = 'verified', cac_number = ?, tin = COALESCE(NULLIF(?, ''), tin),
             business_name = COALESCE(NULLIF(?, ''), business_name), account_status = 'active'
           WHERE id = ?`,
          [rc, tin || null, body.businessName?.trim() || null, req.user.id],
        );
        await invalidateProfileCache(req.user.id);
      }

      res.json({
        verified: true,
        status: "verified_format",
        message: "Business format validated.",
        reference: `CAC-FMT-${rc.slice(-4)}`,
      });
      return;
    }

    // Legacy { method, value }
    if (body.method && body.value) {
      if (!req.user) throw new HttpError(401, "Sign in required.");
      const method = body.method as "nin" | "bvn" | "cac" | "tin";
      const digest = hashId(body.value);
      const id = uuid();
      await pool.query(
        `INSERT INTO kyc_verifications (id, user_id, method, status, provider, notes)
         VALUES (?, ?, ?, 'verified', 'stub', 'Auto-verified')`,
        [id, req.user.id, method],
      );
      if (method === "nin") {
        await pool.query(
          `UPDATE profiles SET kyc_status = 'verified', nin_hash = ?, account_status = 'active' WHERE id = ?`,
          [digest, req.user.id],
        );
      } else if (method === "bvn") {
        await pool.query(
          `UPDATE profiles SET kyc_status = 'verified', bvn_hash = ?, account_status = 'active' WHERE id = ?`,
          [digest, req.user.id],
        );
      } else if (method === "cac") {
        await pool.query(
          `UPDATE profiles SET kyc_status = 'verified', cac_number = ?, account_status = 'active' WHERE id = ?`,
          [body.value.trim(), req.user.id],
        );
      } else {
        await pool.query(
          `UPDATE profiles SET kyc_status = 'verified', tin = ?, account_status = 'active' WHERE id = ?`,
          [body.value.trim(), req.user.id],
        );
      }
      await invalidateProfileCache(req.user.id);
      res.json({ verified: true, status: "verified", method, verificationId: id });
      return;
    }

    throw new HttpError(400, "Invalid KYC payload.");
  } catch (err) {
    next(err);
  }
});
