export type Role = "individual" | "business" | "govt" | "admin";
export type AccountStatus = "pending" | "active" | "suspended" | "rejected";
export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: Role;
  account_status: AccountStatus;
  state: string | null;
  lga: string | null;
  kyc_status: KycStatus;
  business_name: string | null;
  business_type: string | null;
  cac_number: string | null;
  govt_state: string | null;
  department: string | null;
  office_title: string | null;
};

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  accountStatus: AccountStatus;
  govtState: string | null;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  state: string;
  role: Role;
  verified: boolean;
  businessType?: string;
  rcNumber?: string;
  govtState?: string;
  department?: string;
  officeTitle?: string;
  accountStatus?: AccountStatus;
};

export function profileToSessionUser(profile: Profile): SessionUser {
  const role = profile.role;
  return {
    id: profile.id,
    name: profile.full_name ?? profile.email?.split("@")[0] ?? "NaijaPass user",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    state: profile.govt_state ?? profile.state ?? "",
    role,
    verified:
      role === "govt" || role === "admin"
        ? profile.account_status === "active"
        : profile.kyc_status === "verified",
    businessType: profile.business_type ?? undefined,
    rcNumber: profile.cac_number ?? undefined,
    govtState: profile.govt_state ?? undefined,
    department: profile.department ?? undefined,
    officeTitle: profile.office_title ?? undefined,
    accountStatus: profile.account_status,
  };
}
