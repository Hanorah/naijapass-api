import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { queryOne } from "../db/mysql";
import type { AuthUser, Profile, Role } from "../types";
import { HttpError } from "./error";

export type AuthedRequest = Request & { user?: AuthUser };

type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
};

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
  );
}

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new HttpError(401, "Sign in required.");
    }

    const token = header.slice(7);
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
      throw new HttpError(401, "Invalid or expired token.");
    }

    const profile = await queryOne<Profile>(
      `SELECT id, email, full_name, phone, role, account_status, state, lga, avatar_url, kyc_status,
              business_name, business_type, cac_number, govt_state, department, office_title
       FROM profiles WHERE id = :id`,
      { id: payload.sub },
    );

    if (!profile) {
      throw new HttpError(401, "Account not found.");
    }

    if (profile.account_status === "suspended" || profile.account_status === "rejected") {
      throw new HttpError(403, "Account is not active.");
    }

    req.user = {
      id: profile.id,
      email: profile.email ?? payload.email,
      role: profile.role,
      accountStatus: profile.account_status,
      govtState: profile.govt_state,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, "Insufficient permissions."));
      return;
    }
    next();
  };
}

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }
  return requireAuth(req, _res, next);
}
