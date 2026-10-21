import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { config } from "../config";

async function migrate() {
  const schemaPath = path.resolve(process.cwd(), "sql", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

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
    console.log("Running sql/schema.sql …");
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
