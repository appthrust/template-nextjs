import { Pool } from "pg";

export type DatabaseStatus =
  | "ready"
  | "missing-url"
  | "migration-pending"
  | "unavailable";

export interface DemoMessage {
  id: number;
  body: string;
  createdAt: string;
  authorPrincipal: string | null;
  authorDisplayName: string | null;
}

export interface DemoDatabaseState {
  status: DatabaseStatus;
  databaseUrlPresent: boolean;
  databaseName?: string;
  host?: string;
  messages: DemoMessage[];
}

let pool: Pool | undefined;

function databaseUrl() {
  return process.env.DATABASE_URL?.trim() ?? "";
}

function getPool() {
  const connectionString = databaseUrl();
  if (!connectionString) {
    return null;
  }

  pool ??= new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export async function loadDemoMessages(): Promise<DemoDatabaseState> {
  const connectionString = databaseUrl();
  if (!connectionString) {
    return {
      status: "missing-url",
      databaseUrlPresent: false,
      messages: [],
    };
  }

  const parsed = safeDatabaseUrl(connectionString);
  const client = getPool();
  if (!client) {
    return {
      status: "missing-url",
      databaseUrlPresent: false,
      messages: [],
    };
  }

  try {
    const result = await client.query<{
      id: number;
      body: string;
      created_at: string;
      author_principal: string | null;
      author_display_name: string | null;
    }>(`
      SELECT id, body, created_at::text, author_principal, author_display_name
      FROM appthrust_demo_messages
      ORDER BY id DESC
      LIMIT 8
    `);

    return {
      status: "ready",
      databaseUrlPresent: true,
      databaseName: parsed.databaseName,
      host: parsed.host,
      messages: result.rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        authorPrincipal: row.author_principal,
        authorDisplayName: row.author_display_name,
      })),
    };
  } catch (error) {
    return {
      status: databaseTableMissing(error) ? "migration-pending" : "unavailable",
      databaseUrlPresent: true,
      databaseName: parsed.databaseName,
      host: parsed.host,
      messages: [],
    };
  }
}

export async function insertDemoMessage(
  body: string,
  authorPrincipal: string,
  authorDisplayName: string | null,
) {
  const client = getPool();
  if (!client) {
    return;
  }

  await client.query(
    "INSERT INTO appthrust_demo_messages (body, author_principal, author_display_name) VALUES ($1, $2, $3)",
    [body, authorPrincipal, authorDisplayName],
  );
}

function databaseTableMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "42P01" || error.code === "42703")
  );
}

function safeDatabaseUrl(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    return {
      databaseName: parsed.pathname.replace(/^\//, "") || undefined,
      host: parsed.hostname || undefined,
    };
  } catch {
    return {};
  }
}
