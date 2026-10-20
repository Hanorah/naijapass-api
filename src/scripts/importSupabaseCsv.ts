/**
 * Import Supabase table dumps (CSV) into local MySQL.
 *
 * Default folder: data/supabase-export/
 * Override: CSV_DIR=/path/to/csvs npm run db:import-supabase
 *
 * Creates users for every profile (govt → GovtPass123!, admin → AdminPass123!,
 * others → NaijaPass123!) so state accounts can sign in.
 */
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { pool, queryOne } from "../db/mysql";

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (ch === "\r") i++;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Row = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

function fixText(value: string | null | undefined): string | null {
  if (value == null) return null;
  let s = value;
  // Common UTF-8-as-Windows-1252 mojibake from exports
  s = s
    .replace(/â‚¦/g, "₦")
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/Â/g, "");
  s = s.trim();
  return s === "" ? null : s;
}

function bool01(value: string | null | undefined, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const v = value.toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return 1;
  if (v === "false" || v === "0" || v === "no") return 0;
  return fallback;
}

function toDateTime(value: string | null | undefined): string | null {
  const s = fixText(value);
  if (!s) return null;
  // 2026-08-23 16:49:24.635051+00 → 2026-08-23 16:49:24
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  return null;
}

function toDate(value: string | null | undefined): string | null {
  const s = fixText(value);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function numOrNull(value: string | null | undefined): number | null {
  const s = fixText(value);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function passwordForEmail(email: string, role: string): string {
  if (role === "admin" || email === "admin@naijapass.ng") return config.adminSeedPassword;
  if (role === "govt" || email.endsWith("@govt.naijapass.ng")) return config.govtSeedPassword;
  return "NaijaPass123!";
}

function loadCsv(dir: string, name: string): Row[] {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing CSV: ${file}`);
  }
  return parseCsv(fs.readFileSync(file, "utf8"));
}

async function importProfiles(rows: Row[]) {
  let created = 0;
  let updated = 0;
  const idByCsvId = new Map<string, string>();

  for (const row of rows) {
    const csvId = row.id?.trim();
    const email = fixText(row.email)?.toLowerCase();
    if (!csvId || !email) continue;

    const role = (fixText(row.role) ?? "individual") as string;
    const password = passwordForEmail(email, role);
    const passwordHash = await bcrypt.hash(password, 12);

    const existingByEmail = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE email = :email`,
      { email },
    );
    const existingById = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE id = :id`,
      { id: csvId },
    );

    let userId = csvId;

    if (existingByEmail && existingByEmail.id !== csvId) {
      // Keep the already-seeded UUID; remaps FKs that pointed at the CSV id.
      userId = existingByEmail.id;
      await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [
        passwordHash,
        userId,
      ]);
    } else if (existingById || existingByEmail) {
      userId = existingById?.id ?? existingByEmail!.id;
      await pool.query(`UPDATE users SET email = ?, password_hash = ? WHERE id = ?`, [
        email,
        passwordHash,
        userId,
      ]);
    } else {
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`, [
        userId,
        email,
        passwordHash,
      ]);
      created++;
    }

    idByCsvId.set(csvId, userId);

    const profileExists = await queryOne<{ id: string }>(
      `SELECT id FROM profiles WHERE id = :id`,
      { id: userId },
    );

    const fields = [
      fixText(row.full_name),
      fixText(row.phone),
      role,
      fixText(row.account_status) ?? "active",
      fixText(row.state),
      fixText(row.lga),
      fixText(row.avatar_url),
      fixText(row.kyc_status) ?? "verified",
      fixText(row.nin_hash),
      fixText(row.bvn_hash),
      fixText(row.business_name),
      fixText(row.business_type),
      fixText(row.cac_number),
      fixText(row.tin),
      fixText(row.govt_state),
      fixText(row.department),
      fixText(row.office_title),
    ];

    if (profileExists) {
      await pool.query(
        `UPDATE profiles SET
          email = ?, full_name = ?, phone = ?, role = ?, account_status = ?,
          state = ?, lga = ?, avatar_url = ?, kyc_status = ?, nin_hash = ?, bvn_hash = ?,
          business_name = ?, business_type = ?, cac_number = ?, tin = ?,
          govt_state = ?, department = ?, office_title = ?
         WHERE id = ?`,
        [email, ...fields, userId],
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO profiles
          (id, email, full_name, phone, role, account_status, state, lga, avatar_url,
           kyc_status, nin_hash, bvn_hash, business_name, business_type, cac_number, tin,
           govt_state, department, office_title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, ...fields],
      );
      if (!existingByEmail && !existingById) {
        /* already counted as created via users */
      } else {
        created++;
      }
    }
  }

  return { created, updated, idByCsvId };
}

async function importProjects(rows: Row[], idMap: Map<string, string>) {
  let upserted = 0;
  for (const row of rows) {
    const id = fixText(row.id);
    if (!id) continue;
    const submittedRaw = fixText(row.submitted_by);
    const submittedBy = submittedRaw ? (idMap.get(submittedRaw) ?? null) : null;

    const status = fixText(row.status) ?? "In Progress";
    const allowed = new Set(["In Progress", "Completed", "Planned", "Stalled"]);
    const safeStatus = allowed.has(status) ? status : "In Progress";

    const era = fixText(row.era) ?? "current";
    const safeEra = ["current", "previous", "legacy"].includes(era) ? era : "current";

    const review = fixText(row.review_status) ?? "published";
    const safeReview = ["draft", "published", "archived"].includes(review)
      ? review
      : "published";

    await pool.query(
      `INSERT INTO projects
        (id, title, category, description, budget_ngn, budget_label, state, lga, status,
         contractor, completion, reports_count, featured, era, supervising_agency,
         source_title, source_url, image_url, notes, published, submitted_by,
         review_status, start_date, expected_completion, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), category = VALUES(category), description = VALUES(description),
         budget_ngn = VALUES(budget_ngn), budget_label = VALUES(budget_label),
         state = VALUES(state), lga = VALUES(lga), status = VALUES(status),
         contractor = VALUES(contractor), completion = VALUES(completion),
         reports_count = VALUES(reports_count), featured = VALUES(featured), era = VALUES(era),
         supervising_agency = VALUES(supervising_agency), source_title = VALUES(source_title),
         source_url = VALUES(source_url), image_url = VALUES(image_url), notes = VALUES(notes),
         published = VALUES(published), submitted_by = VALUES(submitted_by),
         review_status = VALUES(review_status), start_date = VALUES(start_date),
         expected_completion = VALUES(expected_completion)`,
      [
        id,
        fixText(row.title) ?? id,
        fixText(row.category) ?? "Public Works",
        fixText(row.description),
        numOrNull(row.budget_ngn) ?? 0,
        fixText(row.budget_label) ?? "TBA",
        fixText(row.state) ?? "FCT",
        fixText(row.lga),
        safeStatus,
        fixText(row.contractor),
        fixText(row.completion),
        numOrNull(row.reports_count) ?? 0,
        bool01(row.featured),
        safeEra,
        fixText(row.supervising_agency),
        fixText(row.source_title),
        fixText(row.source_url),
        fixText(row.image_url),
        fixText(row.notes),
        bool01(row.published, 1),
        submittedBy,
        safeReview,
        toDate(row.start_date),
        toDate(row.expected_completion),
        toDateTime(row.created_at) ?? new Date().toISOString().slice(0, 19).replace("T", " "),
        toDateTime(row.updated_at) ?? new Date().toISOString().slice(0, 19).replace("T", " "),
      ],
    );
    upserted++;
  }
  return upserted;
}

async function importFieldReports(rows: Row[], idMap: Map<string, string>) {
  let upserted = 0;
  for (const row of rows) {
    const id = fixText(row.id);
    const projectId = fixText(row.project_id);
    if (!id || !projectId) continue;

    const project = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE id = :id`,
      { id: projectId },
    );
    if (!project) {
      console.warn(`  skip field report ${id}: missing project ${projectId}`);
      continue;
    }

    const submittedRaw = fixText(row.submitted_by);
    const submittedBy = submittedRaw ? (idMap.get(submittedRaw) ?? null) : null;
    const status = fixText(row.status) ?? "In Progress";
    const allowed = new Set(["In Progress", "Delayed", "Completed", "Planned"]);
    const safeStatus = allowed.has(status) ? status : "In Progress";

    await pool.query(
      `INSERT INTO field_reports
        (id, project_id, title, time_label, body, location, status, author, likes,
         image_url, verified, state, submitted_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         project_id = VALUES(project_id), title = VALUES(title), time_label = VALUES(time_label),
         body = VALUES(body), location = VALUES(location), status = VALUES(status),
         author = VALUES(author), likes = VALUES(likes), image_url = VALUES(image_url),
         verified = VALUES(verified), state = VALUES(state), submitted_by = VALUES(submitted_by)`,
      [
        id,
        projectId,
        fixText(row.title) ?? id,
        fixText(row.time_label),
        fixText(row.body) ?? "",
        fixText(row.location),
        safeStatus,
        fixText(row.author),
        numOrNull(row.likes) ?? 0,
        fixText(row.image_url),
        bool01(row.verified, 1),
        fixText(row.state),
        submittedBy,
        toDateTime(row.created_at),
        toDateTime(row.updated_at),
      ],
    );
    upserted++;
  }
  return upserted;
}

async function importStateContent(rows: Row[], idMap: Map<string, string>) {
  let upserted = 0;
  const allowedTypes = new Set([
    "law",
    "order",
    "mda",
    "emergency",
    "notice",
    "announcement",
    "service",
  ]);

  for (const row of rows) {
    const id = fixText(row.id);
    if (!id) continue;
    const type = fixText(row.type) ?? "notice";
    if (!allowedTypes.has(type)) {
      console.warn(`  skip state_content ${id}: bad type ${type}`);
      continue;
    }
    const submittedRaw = fixText(row.submitted_by);
    const submittedBy = submittedRaw ? (idMap.get(submittedRaw) ?? null) : null;

    await pool.query(
      `INSERT INTO state_content
        (id, state, type, title, body, contact, phone, url, category, effective_date,
         published, submitted_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state), type = VALUES(type), title = VALUES(title), body = VALUES(body),
         contact = VALUES(contact), phone = VALUES(phone), url = VALUES(url),
         category = VALUES(category), effective_date = VALUES(effective_date),
         published = VALUES(published), submitted_by = VALUES(submitted_by)`,
      [
        id,
        fixText(row.state) ?? "FCT",
        type,
        fixText(row.title) ?? id,
        fixText(row.body),
        fixText(row.contact),
        fixText(row.phone),
        fixText(row.url),
        fixText(row.category),
        toDate(row.effective_date),
        bool01(row.published, 1),
        submittedBy,
        toDateTime(row.created_at),
        toDateTime(row.updated_at),
      ],
    );
    upserted++;
  }
  return upserted;
}

async function importTenders(rows: Row[], idMap: Map<string, string>) {
  let upserted = 0;
  const allowedStatus = new Set(["open", "closed", "awarded", "cancelled"]);
  const allowedPublisher = new Set(["govt", "business", "federal"]);

  for (const row of rows) {
    const id = fixText(row.id);
    if (!id) continue;

    const status = (fixText(row.status) ?? "open").toLowerCase();
    const safeStatus = allowedStatus.has(status) ? status : "open";
    const publisher = (fixText(row.publisher_type) ?? "govt").toLowerCase();
    const safePublisher = allowedPublisher.has(publisher) ? publisher : "govt";

    const submittedRaw = fixText(row.submitted_by);
    const submittedBy = submittedRaw ? (idMap.get(submittedRaw) ?? null) : null;
    const businessId = fixText(row.business_id);

    // Skip business_id FK if that business row does not exist yet
    let safeBusinessId: string | null = null;
    if (businessId) {
      const biz = await queryOne<{ id: string }>(
        `SELECT id FROM businesses WHERE id = :id`,
        { id: businessId },
      );
      safeBusinessId = biz?.id ?? null;
    }

    await pool.query(
      `INSERT INTO tenders
        (id, title, reference, mda, state, sector, value, currency, deadline, status,
         description, source, published_at, lga, contact_email, document_url,
         submitted_by, publisher_type, business_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), reference = VALUES(reference), mda = VALUES(mda),
         state = VALUES(state), sector = VALUES(sector), value = VALUES(value),
         currency = VALUES(currency), deadline = VALUES(deadline), status = VALUES(status),
         description = VALUES(description), source = VALUES(source),
         published_at = VALUES(published_at), lga = VALUES(lga),
         contact_email = VALUES(contact_email), document_url = VALUES(document_url),
         submitted_by = VALUES(submitted_by), publisher_type = VALUES(publisher_type),
         business_id = VALUES(business_id)`,
      [
        id,
        fixText(row.title) ?? id,
        fixText(row.reference),
        fixText(row.mda),
        fixText(row.state),
        fixText(row.sector),
        numOrNull(row.value),
        fixText(row.currency) ?? "NGN",
        toDateTime(row.deadline),
        safeStatus,
        fixText(row.description),
        fixText(row.source),
        toDateTime(row.published_at),
        fixText(row.lga),
        fixText(row.contact_email),
        fixText(row.document_url),
        submittedBy,
        safePublisher,
        safeBusinessId,
        toDateTime(row.created_at),
        toDateTime(row.updated_at),
      ],
    );
    upserted++;
  }
  return upserted;
}

async function main() {
  const dir =
    process.env.CSV_DIR?.trim() ||
    path.resolve(process.cwd(), "data", "supabase-export");

  console.log(`Importing Supabase CSVs from ${dir}`);

  const profiles = loadCsv(dir, "profiles_rows.csv");
  const projects = loadCsv(dir, "projects_rows.csv");
  const fieldReports = loadCsv(dir, "field_reports_rows.csv");
  const stateContent = loadCsv(dir, "state_content_rows.csv");
  const tenders = loadCsv(dir, "tenders_rows.csv");

  console.log(
    `Loaded profiles=${profiles.length} projects=${projects.length} field_reports=${fieldReports.length} state_content=${stateContent.length} tenders=${tenders.length}`,
  );

  const profileResult = await importProfiles(profiles);
  console.log(
    `✓ profiles: ${profileResult.created} new users, ${profileResult.updated} updated (id remaps: ${profileResult.idByCsvId.size})`,
  );

  const projectCount = await importProjects(projects, profileResult.idByCsvId);
  console.log(`✓ projects: ${projectCount} upserted`);

  const reportCount = await importFieldReports(fieldReports, profileResult.idByCsvId);
  console.log(`✓ field_reports: ${reportCount} upserted`);

  const contentCount = await importStateContent(stateContent, profileResult.idByCsvId);
  console.log(`✓ state_content: ${contentCount} upserted`);

  const tenderCount = await importTenders(tenders, profileResult.idByCsvId);
  console.log(`✓ tenders: ${tenderCount} upserted`);

  console.log("\nLogin passwords after import:");
  console.log(`  admin@naijapass.ng → ${config.adminSeedPassword}`);
  console.log(`  *@govt.naijapass.ng → ${config.govtSeedPassword}`);
  console.log("  other imported accounts → NaijaPass123!");

  await pool.end();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
