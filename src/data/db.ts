// DuckDB-WASM runs in its own Web Worker. The page talks to it through AsyncDuckDB.
// After the dummy tables are loaded the database is locked down: no external access, no extension
// auto-install/auto-load, and the configuration can no longer be changed (even by explore_sql).
import * as duckdb from "@duckdb/duckdb-wasm";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import { generate, toCsv } from "./generate";
import { trustedScriptURL } from "../lib/trusted-types";

export type Row = Record<string, string | number | boolean | null>;

type Database = Awaited<ReturnType<typeof createDatabase>>;
let dbP: Promise<Database> | null = null;
let exploreDbP: Promise<Database> | null = null;
export function initDb() {
  return dbP ??= createDatabase().catch((error) => { dbP = null; throw error; });
}

async function createDatabase() {
    const t0 = performance.now();
    const bundle = await duckdb.selectBundle({ mvp: { mainModule: mvpWasm, mainWorker: mvpWorker }, eh: { mainModule: ehWasm, mainWorker: ehWorker } });
    const worker = new Worker(trustedScriptURL(new URL(bundle.mainWorker!, location.href).href) as unknown as string);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const ui = await db.connect();
    for (const t of generate()) {
      const file = `${t.name}.csv`;
      await db.registerFileText(file, toCsv(t));
      const cols = t.columns.map((c) => `'${c.name}': '${c.type}'`).join(", ");
      await ui.query(`CREATE TABLE ${t.name} AS SELECT * FROM read_csv('${file}', header = true, columns = {${cols}}, nullstr = '')`);
      await db.dropFile(file);
    }
    for (const s of [
      "SET memory_limit = '128MB'",
      "SET autoinstall_known_extensions = false",
      "SET autoload_known_extensions = false",
      "SET enable_external_access = false",
      "SET lock_configuration = true",
    ]) await ui.query(s);
    return { db, ui, worker, ms: Math.round(performance.now() - t0) };
    } catch (error) { worker.terminate(); void db.terminate().catch(() => {}); throw error; }
}

function toRows(table: { toArray(): unknown[]; schema: { fields: { name: string }[] } }): Row[] {
  const names = table.schema.fields.map((f) => f.name);
  return table.toArray().map((r: any) => {
    const o: Row = {};
    for (const n of names) {
      let v = r[n];
      if (typeof v === "bigint") v = Number(v);
      else if (v instanceof Date) v = v.toISOString().slice(0, 10);
      else if (v && typeof v === "object" && "valueOf" in v && typeof v.valueOf() === "number") v = v.valueOf();
      o[n] = v ?? null;
    }
    return o;
  });
}

/** Trusted queries written by the app itself (cube.ts). */
export async function q(sql: string): Promise<Row[]> {
  const { ui } = await initDb();
  return toRows(await ui.query(sql) as any);
}

// ---------- explore_sql: untrusted SQL from the LLM ----------
import { checkUntrustedSql, SqlRejected } from "./sql-policy";
export { checkUntrustedSql, SqlRejected } from "./sql-policy";

export async function exploreSql(sqlIn: string, { maxRows = 200, timeoutMs = 3000 } = {}) {
  const sql = checkUntrustedSql(sqlIn);
  // Untrusted SQL gets its own Worker so the deadline can terminate it without taking down the UI.
  const engine = await (exploreDbP ??= createDatabase().catch((error) => { exploreDbP = null; throw error; }));
  const conn = engine.ui;
  // Wrapping forces a query expression: DML or DDL cannot appear as a subquery.
  const wrapped = `SELECT * FROM (${sql}) AS q LIMIT ${maxRows + 1}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t0 = performance.now();
  try {
    const res = await Promise.race([
      conn.query(wrapped),
      new Promise<never>((_, rej) => { timer = setTimeout(() => { exploreDbP = null; engine.worker.terminate(); void engine.db.terminate().catch(() => {}); rej(new SqlRejected(`${timeoutMs}msで打ち切りました`)); }, timeoutMs); }),
    ]);
    const rows = toRows(res as any);
    return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows, ms: Math.round(performance.now() - t0) };
  } finally { clearTimeout(timer); }
}
