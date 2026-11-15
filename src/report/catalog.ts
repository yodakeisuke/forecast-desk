// Catalog report@1: one catalog, two registries (screen and PDF). The spec holds sources, not drawings.
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const filters = z.object({ region: z.string().nullish(), segment: z.string().nullish(), product: z.string().nullish() }).optional();

export const FigureSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bridge"), from: z.string(), to: z.string(), filters }),
  z.object({ kind: z.literal("heat"), compare: z.string(), filters }),
  z.object({ kind: z.literal("trend"), compare: z.string(), filters }),
  z.object({ kind: z.literal("quarter"), compare: z.string(), filters }),
  z.object({ kind: z.literal("accuracy"), versions: z.number() }),
  z.object({ kind: z.literal("slipped"), region: z.string().nullable(), segment: z.string().nullable(), product: z.string().nullish() }),
  z.object({ kind: z.literal("scenario"), slipBack: z.number(), winRate: z.number(), naBias: z.number(), filters }),
  z.object({ kind: z.literal("widget"), widget: z.string(), title: z.string() }),
]);
export type FigureSourceT = z.infer<typeof FigureSource>;

export const reportCatalog = defineCatalog(schema, {
  components: {
    Document: { props: z.object({ title: z.string(), eyebrow: z.string(), author: z.string(), materials: z.string() }), slots: ["default"], description: "報告書の外枠" },
    Section: { props: z.object({ no: z.string(), title: z.string(), anchor: z.string() }), slots: ["default"], description: "章" },
    Headline: { props: z.object({ text: z.string() }), description: "要旨の見出し（1文）" },
    Paragraph: { props: z.object({ text: z.string() }), description: "本文。**太字** と [注記番号] が使える" },
    KpiRow: { props: z.object({ items: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string(), delta: z.string(), tone: z.enum(["bad", "good", "muted"]) })) }), description: "要旨の数字" },
    Finding: { props: z.object({ n: z.number(), text: z.string(), agent: z.string() }), description: "EDA中の注記の引用" },
    Figure: { props: z.object({ no: z.string(), caption: z.string(), source: FigureSource }), description: "図表。source から描く" },
    Bullets: { props: z.object({ items: z.array(z.string()) }), description: "箇条書き" },
    Trail: { props: z.object({ items: z.array(z.object({ at: z.string(), tool: z.string(), text: z.string() })), undoable: z.number() }), description: "付録: 分析の経緯（操作履歴）" },
  },
  actions: {},
});
