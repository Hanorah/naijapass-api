import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { config } from "../config";

async function migrate() {
  const schemaPath = path.resolve(process.cwd(), "sql", "schema.sql");
  const dbName = config.mysql.database.replace(/[^a-zA-Z0-9_]/g, "") || "naijapass";
  // Allow Railway's default DB name (`railway`) instead of hard-coded `naijapass`.
  const sql = fs
    .readFileSync(schemaPath, "utf8")
    .replace(/CREATE DATABASE IF NOT EXISTS naijapass/g, `CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
    .replace(/USE naijapass;/g, `USE \`${dbName}\`;`);

  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    ssl: config.mysql.ssl,
    multipleStatements: true,
    connectTimeout: 20000,
  });

  try {
    console.log(`Running sql/schema.sql → database \`${dbName}\` …`);
    await conn.query(sql);
    console.log("✓ Migration complete");
  } finally {
    await conn.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
