import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { pool, queryOne } from "../db/mysql";

async function seed() {
  const adminEmail = "admin@naijapass.ng";
  const password = config.adminSeedPassword;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE email = :email`,
    { email: adminEmail },
  );

  if (existing) {
    console.log("Admin already exists — skipping seed");
    process.exit(0);
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 12);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`, [
      id,
      adminEmail,
      passwordHash,
    ]);
    await conn.query(
      `INSERT INTO profiles
        (id, email, full_name, phone, role, account_status, state, kyc_status)
       VALUES (?, ?, 'Portal Admin', '+234 800 000 0001', 'admin', 'active', 'FCT', 'verified')`,
      [id, adminEmail],
    );

    const tenderId = uuid();
    await conn.query(
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
        id,
      ],
    );

    await conn.commit();
    console.log(`✓ Seeded ${adminEmail} / ${password}`);
    console.log("✓ Seeded sample open tender NP-FED-SEED-001");
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
