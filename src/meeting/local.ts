// かんたんモード: a temporary keyword judge used when Jev is not reachable (no key on this server, the public
// site, automated tests). It produces the same Plan as Jev so the rest of the app does not care which ran.
import { sanitize, statedPercent, type KpiKey, type Plan, type Screen, type Slot } from "./plan";

const has = (q: string, re: RegExp) => re.test(q);

export function localPlan(question: string, screen: Screen): Plan {
  const q = question.normalize("NFKC");
  const conf: Record<string, number> = {};
  const compare: Plan["compare"] =
    has(q, /予算/) ? "budget"
      : has(q, /前月|先月|前回|前の版|9月版/) ? "v09"
        : (() => { const m = q.match(/([4-8])月版/); return m ? (`v0${m[1]}` as Plan["compare"]) : null; })();
  const whole = has(q, /全社|全体|全地域/);
  const region = has(q, /北米|米国|アメリカ/) ? "北米" : has(q, /欧州|ヨーロッパ|EU/) ? "欧州" : has(q, /日本|国内/) ? "日本" : whole ? "all" : null;
  const segment = has(q, /Enterprise|エンタープライズ|大企業/i) ? "Enterprise" : has(q, /\bMid\b|中堅/i) ? "Mid" : has(q, /SMB|中小/i) ? "SMB" : whole ? "all" : null;
  const product = has(q, /Core/i) ? "Core" : has(q, /Analytics/i) ? "Analytics" : has(q, /Connect/i) ? "Connect" : whole ? "all" : null;

  let winRate: number | null = null;
  if (has(q, /成約率/)) {
    const stated = statedPercent(q, /成約率/);
    winRate = stated ?? (has(q, /戻|前月並|9月版並/) ? screen.refs.winRate09 : has(q, /下が|落ち/) ? screen.scenario.winRate - 2 : has(q, /上が|改善|高/) ? screen.scenario.winRate + 1 : null);
  }
  let slipBack: number | null = null;
  if (has(q, /スリップ|期ずれ/) && has(q, /戻/)) slipBack = has(q, /半分|半数/) ? 50 : 100;

  const why = has(q, /なぜ|なんで|理由|要因|原因|どうして/);
  const asksDashboard = compare || region || segment || product || winRate !== null || slipBack !== null
    || has(q, /利益|売上|着地|ARR|新規|内訳|推移|差異|ドライバー|解約|成約|予算|見通し|シナリオ|コスト|費用/);
  const kind: Plan["kind"] = why ? "handoff" : asksDashboard ? "answer" : "unsupported";

  const focus: Slot[] = [];
  const add = (s: Slot) => { if (!focus.includes(s)) focus.push(s); };
  if (winRate !== null || slipBack !== null || has(q, /シナリオ|試算|したら|なら[?？]?$/)) add("c-scenario");
  if (has(q, /ARR|新規|受注|ブッキング|四半期/)) add("c-q");
  if (has(q, /推移|トレンド|月次|着地/) && !has(q, /利益/)) add("c-trend");
  if (has(q, /利益|コスト|費用|販管|人件/)) add("c-bridge");
  if (has(q, /ヒートマップ|一覧/)) add("c-heat");
  if (has(q, /ドライバー|前提|単価|解約/)) add("c-drv");
  if (has(q, /内訳|どこ|別|セグメント/)) add("c-var");
  if (!focus.length) add("c-bridge");
  if (focus.length < 2 && (region || segment || product || why)) add("c-var");

  const kpi: KpiKey = has(q, /利益率|マージン/) ? "margin" : has(q, /売上/) && !has(q, /利益/) ? "rev" : has(q, /ARR|新規|受注/) ? "newarr" : has(q, /解約|チャーン/) ? "churn" : "op";
  return sanitize({ kind, compare: kind === "unsupported" ? null : compare, region: kind === "unsupported" ? null : region, segment: kind === "unsupported" ? null : segment, product: kind === "unsupported" ? null : product, winRate: kind === "unsupported" ? null : winRate, slipBack: kind === "unsupported" ? null : slipBack, focus, kpi, confidence: conf });
}
