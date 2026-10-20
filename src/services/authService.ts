import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { pool, queryOne } from "../db/mysql";
import { cacheDel, cacheGet, cacheSet } from "../db/redis";
import { HttpError } from "../middleware/error";
import type { Profile, Role } from "../types";
import { profileToSessionUser } from "../types";

const PROFILE_SQL = `
  SELECT id, email, full_name, phone, role, account_status, state, lga, kyc_status,
         business_name, business_type, cac_number, govt_state, department, office_title
  FROM profiles
`;

export async function getProfileById(id: string): Promise<Profile | null> {
  const cacheKey = `profile:${id}`;
  const cached = await cacheGet<Profile>(cacheKey);
  if (cached) return cached;

  const profile = await queryOne<Profile>(`${PROFILE_SQL} WHERE id = :id`, { id });
  if (profile) await cacheSet(cacheKey, profile, 120);
  return profile;
}

export async function getProfileByEmail(email: string): Promise<Profile | null> {
  return queryOne<Profile>(`${PROFILE_SQL} WHERE email = :email`, {
    email: email.trim().toLowerCase(),
  });
}

type RegisterInput = {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  state?: string;
  role?: "individual" | "business";
  businessName?: string;
  businessType?: string;
  cacNumber?: string;
};

export async function registerUser(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    throw new HttpError(400, "Valid email and password (8+ chars) are required.");
  }

  const existing = await getProfileByEmail(email);
  if (existing) {
    throw new HttpError(409, "An account with this email already exists.");
  }

  const role: Role = input.role === "business" ? "business" : "individual";
  const id = uuid();
  const passwordHash = await bcrypt.hash(input.password, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`,
      [id, email, passwordHash],
    );
    await conn.query(
      `INSERT INTO profiles
        (id, email, full_name, phone, role, account_status, state, business_name, business_type, cac_number)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        id,
        email,
        input.fullName.trim() || email.split("@")[0],
        input.phone?.trim() || null,
        role,
        input.state?.trim() || null,
        input.businessName?.trim() || null,
        input.businessType?.trim() || null,
        input.cacNumber?.trim() || null,
      ],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const profile = await getProfileById(id);
  if (!profile) throw new HttpError(500, "Failed to create profile.");
  return profileToSessionUser(profile);
}

export async function loginUser(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const user = await queryOne<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE email = :email`,
    { email: normalized },
  );
  if (!user) {
    throw new HttpError(401, "Invalid email or password.");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, "Invalid email or password.");
  }

  const profile = await getProfileById(user.id);
  if (!profile) {
    throw new HttpError(401, "Profile missing for this account.");
  }
  if (profile.account_status === "suspended" || profile.account_status === "rejected") {
    throw new HttpError(403, "Account is not active.");
  }

  return profileToSessionUser(profile);
}

export async function invalidateProfileCache(id: string) {
  await cacheDel(`profile:${id}`);
}
