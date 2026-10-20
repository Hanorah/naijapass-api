import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { pool, queryOne } from "../db/mysql";

type SeedAccount = {
  email: string;
  fullName: string;
  role: "admin" | "govt";
  password: string;
  state: string;
  phone: string;
  govtState?: string;
  department?: string;
  officeTitle?: string;
};

async function upsertAccount(account: SeedAccount) {
  const passwordHash = await bcrypt.hash(account.password, 12);
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE email = :email`,
    { email: account.email },
  );

  if (existing) {
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      passwordHash,
      existing.id,
    ]);
    await pool.query(
      `UPDATE profiles SET
        full_name = ?, phone = ?, role = ?, account_status = 'active', state = ?,
        kyc_status = 'verified', govt_state = ?, department = ?, office_title = ?
       WHERE id = ?`,
      [
        account.fullName,
        account.phone,
        account.role,
        account.state,
        account.govtState ?? null,
        account.department ?? null,
        account.officeTitle ?? null,
        existing.id,
      ],
    );
    console.log(`✓ Updated ${account.email} / ${account.password}`);
    return existing.id;
  }

  const id = uuid();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`, [
      id,
      account.email,
      passwordHash,
    ]);
    await conn.query(
      `INSERT INTO profiles
        (id, email, full_name, phone, role, account_status, state, kyc_status,
         govt_state, department, office_title)
       VALUES (?, ?, ?, ?, ?, 'active', ?, 'verified', ?, ?, ?)`,
      [
        id,
        account.email,
        account.fullName,
        account.phone,
        account.role,
        account.state,
        account.govtState ?? null,
        account.department ?? null,
        account.officeTitle ?? null,
      ],
    );
    await conn.commit();
    console.log(`✓ Seeded ${account.email} / ${account.password}`);
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function ensureSampleTender(adminId: string) {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM tenders WHERE reference = :ref`,
    { ref: "NP-FED-SEED-001" },
  );
  if (existing) {
    console.log("✓ Sample tender NP-FED-SEED-001 already present");
    return;
  }

  const tenderId = uuid();
  await pool.query(
    `INSERT INTO tenders
      (id, title, reference, mda, state, sector, value, currency, deadline, status,
       description, source, published_at, publisher_type, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', DATE_ADD(NOW(), INTERVAL 30 DAY), 'open',
             ?, 'seed', NOW(), 'federal', ?)`,
    [
      tenderId,
      "Supply of ICT equipment for state digital hubs",
      "NP-FED-SEED-001",
      "Federal Ministry of Communications",
      "FCT",
      "ICT",
      250000000,
      "Seed tender for local API testing.",
      adminId,
    ],
  );
  console.log("✓ Seeded sample open tender NP-FED-SEED-001");
}

async function seed() {
  const adminId = await upsertAccount({
    email: "admin@naijapass.ng",
    fullName: "Portal Admin",
    role: "admin",
    password: config.adminSeedPassword,
    state: "FCT",
    phone: "+234 800 000 0001",
  });

  await upsertAccount({
    email: "lagos@govt.naijapass.ng",
    fullName: "Lagos State Portal",
    role: "govt",
    password: config.govtSeedPassword,
    state: "Lagos",
    govtState: "Lagos",
    phone: "+234 800 000 1001",
    department: "Ministry of Information",
    officeTitle: "State Portal Officer",
  });

  await upsertAccount({
    email: "fct@govt.naijapass.ng",
    fullName: "FCT Administration Portal",
    role: "govt",
    password: config.govtSeedPassword,
    state: "FCT",
    govtState: "FCT",
    phone: "+234 800 000 1002",
    department: "FCTA",
    officeTitle: "Portal Officer",
  });

  await ensureSampleTender(adminId);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
