// The only data a widget can read: registered queries, arguments checked with zod, rows capped.
import { z } from "zod";
import * as cube from "../data/cube";
import { MEASURES, versionByLabel, type Measure, type VersionId } from "../data/model";

const MAX_ROWS = 5000;
const version = z.string().transform((s, ctx) => {
  const v = versionByLabel(s);
  if (!v) { ctx.addIssue({ code: "custom", message: `版「${s}」はありません（予算 / 4月版〜10月版）` }); return z.NEVER; }
  return v as VersionId;
});
const filters = z.object({
  region: z.enum(["日本", "北米", "欧州"]).nullish(),
  segment: z.enum(["SMB", "Mid", "Enterprise"]).nullish(),
  product: z.enum(["Core", "Analytics", "Connect"]).nullish(),
}).strict().optional().default({});
const dim = z.enum(["region", "segment", "product", "month", "account", "line", "bridge"]);

export const QUERIES = {
  accuracy: { args: z.object({ versions: z.number().int().min(3).max(6).default(6) }).strict(), run: (a: { versions: number }) => cube.forecastAccuracy(a.versions) },
  series: {
    args: z.object({ measure: z.enum(Object.keys(MEASURES) as [Measure, ...Measure[]]), versions: z.array(version).min(1).max(8), by: z.array(dim).max(3).optional(), filters, months: z.array(z.number().int().min(0).max(11)).optional() }).strict(),
    run: (a: any) => cube.cubeQuery({ measure: a.measure, versions: a.versions, by: a.by, filters: a.filters, months: a.months }),
  },
  variance: {
    args: z.object({ by: z.enum(["region", "segment", "product"]), compare: version, filters, open: z.array(z.string()).max(3).optional() }).strict(),
    run: (a: any) => cube.variance("v10", a.compare, a.filters, [a.by], a.open ?? []),
  },
  bridge: { args: z.object({ from: version, to: version, filters }).strict(), run: (a: any) => cube.bridge(a.from, a.to, a.filters) },
  trend: { args: z.object({ compare: version, filters }).strict(), run: (a: any) => cube.trend("v10", a.compare, a.filters) },
  kpis: { args: z.object({ compare: version, filters }).strict(), run: (a: any) => cube.kpis("v10", a.compare, a.filters) },
  pipeline: { args: z.object({ filters }).strict(), run: (a: any) => cube.pipeline(a.filters) },
  slippedDeals: { args: z.object({ filters }).strict(), run: (a: any) => cube.slippedDeals(a.filters).then((d) => d.map(({ deal_id, company, region, segment, arr, stage, prob, close_from, close_to }) => ({ deal_id, company, region, segment, arr, stage, prob, close_from, close_to }))) },
  scenarioPL: { args: z.object({ slipBack: z.number().min(0).max(100), winRate: z.number().min(0).max(100), naBias: z.number().min(-30).max(30), filters }).strict(), run: (a: any) => cube.scenarioPL(a) },
  drivers: { args: z.object({ compare: version, filters }).strict(), run: (a: any) => cube.drivers("v10", a.compare, a.filters) },
} as const;

export async function runQuery(name: string, args: unknown): Promise<unknown> {
  const q = (QUERIES as Record<string, { args: z.ZodTypeAny; run: (a: any) => Promise<unknown> }>)[name];
  if (!q) throw new Error(`問い合わせ「${name}」は登録されていません。使えるもの: ${Object.keys(QUERIES).join(", ")}`);
  const parsed = q.args.safeParse(args ?? {});
  if (!parsed.success) throw new Error(`引数が正しくありません: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(全体)"} ${i.message}`).join("; ")}`);
  const out = await q.run(parsed.data);
  if (Array.isArray(out) && out.length > MAX_ROWS) return out.slice(0, MAX_ROWS);
  return out;
}
