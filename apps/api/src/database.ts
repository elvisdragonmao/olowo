import { readFile } from "node:fs/promises";
import pg from "pg";

const schemaFile = new URL("../sql/schema.sql", import.meta.url);

export function createDatabase(connectionString?: string) {
	if (!connectionString) return null;
	return new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

/** Creates any missing tables. The schema is idempotent, so this runs on every start. */
export async function applySchema(database: pg.Pool) {
	await database.query(await readFile(schemaFile, "utf8"));
}
