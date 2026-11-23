import { z } from "zod";
import { REGIONS, SEGMENTS, PRODUCTS, VERSIONS } from "../src/data/model";

export const DECIDE_PATH = "/api/decide";
export const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
export const MAX_BODY = 4096;

const nullableEnum = (v: readonly [string, ...string[]]) => z.enum(v).nullable().optional();
export const DecideBody = z.object({
  question: z.string().trim().min(1).max(200),
  screen: z.object({
    compare: z.enum(VERSIONS.map((v) => v.id) as [string, ...string[]]),
    filters: z.object({ region: nullableEnum(REGIONS), segment: nullableEnum(SEGMENTS), product: nullableEnum(PRODUCTS) }).strict(),
    scenario: z.object({ winRate: z.number().min(0).max(100), slipBack: z.number().min(0).max(100), naBias: z.number().min(-30).max(30) }).strict(),
    refs: z.object({ winRate09: z.number().min(0).max(100), winRate10: z.number().min(0).max(100) }).strict(),
  }).strict(),
}).strict();
