// Catalog fpa@1: the parts a generated widget can place with a json-render spec. Shared by the sandbox
// (which renders them) and the host (which describes them to the LLM and re-validates exported specs).
// Props hold where a number comes from (a source), never the number itself.
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const bindable = (t: z.ZodTypeAny) => z.union([t, z.object({ $bindState: z.string() }), z.object({ $state: z.string() })]);
const version = z.string().describe('版の名前。"予算" "9月版" "10月版" など');
const region = z.enum(["日本", "北米", "欧州"]);
const segment = z.enum(["SMB", "Mid", "Enterprise"]);
const product = z.enum(["Core", "Analytics", "Connect"]);

export const fpaCatalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({ title: z.string(), subtitle: z.string().nullable().optional() }),
      slots: ["default"],
      description: "ダッシュボードと同じ見た目のカード。ウィジェットの外枠。",
    },
    Grid: {
      props: z.object({ columns: z.number().int().min(1).max(4), gap: z.number().min(0).max(32).nullable().optional() }),
      slots: ["default"],
      description: "子を等幅の列に並べる。狭い幅では1列になる。",
    },
    KpiTile: {
      props: z.object({
        metric: z.enum(["op", "rev", "newarr", "margin", "churn"]).describe("op=通期営業利益, rev=通期売上, newarr=新規ARR, margin=営業利益率, churn=月次解約率"),
        compare: version.nullable().optional(),
        label: z.string().nullable().optional(),
      }),
      description: "KPIを1つ。値はホストのデータから取る（10月版、比較元との差つき）。",
    },
    BridgeChart: {
      props: z.object({ from: version, to: version, region: region.nullable().optional(), segment: segment.nullable().optional(), product: product.nullable().optional() }),
      description: "営業利益ブリッジ（滝グラフ）。from版からto版への変化を新規ARR・既存/解約・売上原価・人件費・その他販管費に分ける。",
    },
    TrendChart: {
      props: z.object({ compare: version, region: region.nullable().optional(), segment: segment.nullable().optional(), product: product.nullable().optional() }),
      description: "月次売上の推移。10月版（実績＋見通し）と比較元の2本線。",
    },
    AccuracyTrend: {
      props: z.object({ versions: z.number().int().min(3).max(6), emphasize: region.nullable().optional() }),
      description: "地域別のフォーキャスト誤差（翌月新規ARRの 見通し ÷ 実績 − 1）を版ごとの線で。emphasizeした地域以外は薄くなる。",
    },
    VarianceMiniTable: {
      props: z.object({ by: z.enum(["region", "segment", "product"]), compare: version, region: region.nullable().optional() }),
      description: "売上差異の小さな表（比較元 → 10月版、差異、差異率）。",
    },
    DriverSlider: {
      props: z.object({
        label: z.string(),
        value: bindable(z.number()).describe('{"$bindState": "/scenario/…"} で共有状態に結ぶ。人間とAIが同じ値を動かせる'),
        min: z.number(), max: z.number(), step: z.number(),
        unit: z.string(),
        hint: z.string().nullable().optional(),
      }),
      description: "シナリオの前提を動かすスライダー（UI SDKのSlider）。誰が最後に動かしたか（Agent/あなた/前提）の印が付く。",
    },
    ScenarioCompare: {
      props: z.object({
        region: region.nullable().optional(), segment: segment.nullable().optional(), product: product.nullable().optional(),
        slipBack: bindable(z.number()).describe('{"$state": "/scenario/slipBack"}（0〜100 %）'),
        winRate: bindable(z.number()).describe('{"$state": "/scenario/winRate"}（%）'),
        naBias: bindable(z.number()).describe('{"$state": "/scenario/naBias"}（対象範囲の新規サブスク見通しに掛ける補正 %。−8 なら8%割り引く）'),
      }),
      description: "悲観・基本・楽観の通期営業利益を、10月版と9月版の水準線と並べる。基本ケースは渡した前提で計算する。地域・セグメント・製品で対象を指定でき、省略時は全社。naBiasは互換用の名前で、指定範囲の見通し補正率。",
    },
    Insight: {
      props: z.object({ tone: z.enum(["info", "warning", "good"]), text: z.string().max(300) }),
      description: "結論の一文。数字を書くときはhookやquery_dataで確かめた値だけを使う。",
    },
    AgentUndo: {
      props: z.object({ label: z.string().nullable().optional() }),
      description: "「Agentの変更だけ戻す」ボタン。/scenario/* のうちAIが最後に変えた値を、人や前提の値に戻す。",
    },
    Slot: {
      props: z.object({ name: z.string(), caption: z.string().nullable().optional(), height: z.number().min(40).max(600).nullable().optional() }),
      description: "カタログに無い部分の差し込み口。<Spec slots={{ name: Component }} /> で渡したReact部品をここに描く。破線の枠で「自由に生成した部分」と分かる。",
    },
  },
  actions: {},
});


/** The instructions get_catalog returns, on top of the components json-render describes. */
export const SDK_GUIDE = `# @fpa/genui-sdk（fpa@1）でウィジェットを書く

render_widget の code は、1つのTSXモジュール。importできるのは "@fpa/genui-sdk" と "react" だけ。default export の関数がウィジェット。
コードは別オリジンのサンドボックスで動く。ネットワーク・Cookie・親ページには触れない。外とのやりとりはSDKのhookだけ。

## 形
\`\`\`tsx
import { Spec, useForecastAccuracy } from "@fpa/genui-sdk";

const spec = {
  root: "card",
  elements: {
    card:  { type: "Card", props: { title: "…" }, children: ["trend", "band", "note"] },
    trend: { type: "AccuracyTrend", props: { versions: 6, emphasize: "北米" } },
    band:  { type: "Slot", props: { name: "band", caption: "北米の外れの向き" } },
    note:  { type: "Insight", props: { tone: "warning", text: "…" } },
  },
};

function Band() {                       // カタログに無い部分は自由に書く（React + SVG）
  const acc = useForecastAccuracy({ versions: 6 });
  if (!acc) return null;
  return <svg width="100%" height="60">…</svg>;
}

export default function Widget() {
  return <Spec spec={spec} slots={{ band: Band }} />;
}
\`\`\`

## ルール
- カタログ部品の数字はホストのデータから来る。specには「どこから取るか」だけを書く。
- 自由に書く部分で数字を出すときは、必ずhookで取った値を使う。数字を作らない。
- 共有状態は "/scenario/winRate"（%）"/scenario/slipBack"（%）"/scenario/naBias"（%）だけ。DriverSliderのvalueは {"$bindState": "/scenario/…"}。
- 色はCSS変数を使う: var(--pos) var(--neg) var(--ink) var(--ink-2) var(--muted) var(--grid) var(--axis) var(--s1) var(--s2) var(--s3) var(--agent)。
- 64KBまで。エラーはツールの結果で返るので、直して出し直す。

## hook（すべてホストへの問い合わせ。行数は最大5,000）
- useForecastAccuracy({ versions }) → { versions: string[], series: { region, values: number[] }[] }
- useSeries({ measure, versions, by?, filters?, months? }) → 行の配列（measure: 売上 / 営業利益 / 売上原価 / 販管費 / 人件費 / 新規サブスク売上 …、versions: ["9月版","10月版"]）
- useVariance({ by: "region" | "segment" | "product", compare, filters? }) → { total, rows }
- useBridge({ from, to, filters? }) → { from: number, to: number, steps: { label, value }[] }（from + 各増減 = to）
- useScenarioPL({ slipBack, winRate, naBias, filters? }) → { base, cases: { name, value, note }[], refs: { label, value }[], parts }
- usePipeline({ filters? }) / useSlippedDeals({ filters? }) → パイプラインと来期へ移った案件
- useSharedState(path) → [value, setValue]（/scenario/* だけ書ける）
- suggest({ label, tool: "set_filter" | "drill_down", args }) → ダッシュボードへの提案ボタンを出す（人間が押したときだけ反映）
- 書式: fmt(v, d) / sg(v, d)（符号つき）`;
