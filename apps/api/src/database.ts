import pg from "pg";

export function createDatabase(connectionString?: string) {
	if (!connectionString) return null;
	return new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}
