const DENY = /\b(copy|attach|detach|install|load|pragma|set|reset|create|insert|update|delete|drop|alter|export|import|call|checkpoint|vacuum|begin|commit|rollback|truncate|merge|grant|secret|read_csv|read_csv_auto|read_json|read_json_auto|read_parquet|read_text|read_blob|glob|httpfs|getenv|current_setting|duckdb_settings|duckdb_secrets|sniff_csv|query_table)\b/i;

export class SqlRejected extends Error {}

export function checkUntrustedSql(sqlIn: string): string {
  const sql = sqlIn.trim().replace(/;\s*$/, "");
  if (sql.length > 4000) throw new SqlRejected("SQLは4000文字まで");
  // strip string literals and comments before keyword checks
  const bare = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  if (bare.includes(";")) throw new SqlRejected("文は1つだけ実行できます");
  if (!/^\s*(select|with)\b/i.test(bare)) throw new SqlRejected("SELECT / WITH で始まる読み取り専用の問い合わせだけ実行できます");
  const m = bare.match(DENY);
  if (m) throw new SqlRejected(`「${m[0]}」は使えません（読み取り専用・外部アクセスなし）`);
  return sql;
}
