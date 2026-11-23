import { DecideBody, MAX_BODY, UPSTREAM } from "../server/decide-contract";
import { buildJevRequest, checkAnswers } from "../src/meeting/jev";
import type { Screen } from "../src/meeting/plan";
import { reserveQuota, type QuotaDB } from "./decide-quota";

interface Env {
  TYPESAFE_API_KEY?: string;
  DECIDE_QUOTA?: QuotaDB;
}

class BodyTooLarge extends Error {}

function requestDeadline(request: Request, milliseconds: number) {
  const timeout = AbortSignal.timeout(milliseconds);
  return request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
}

async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal) {
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function readJson(message: { body: ReadableStream<Uint8Array> | null }, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!message.body) throw new Error("Missing body");
  const reader = message.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const buffer = new Uint8Array(limit);
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
      if (size + value.length > limit) throw new BodyTooLarge();
      buffer.set(value, size);
      size += value.length;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

function visitorIp(value: string | null): string | null {
  if (!value || value.length > 45) return null;
  const parts = value.split(".");
  if (parts.length === 4 && parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)) return value;
  if (!value.includes(":") || !/^[a-f0-9:.]+$/i.test(value)) return null;
  try {
    // URL parsing validates and canonicalizes IPv6, including IPv4-mapped addresses.
    const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const [left, right] = address.split("::");
    const fields = left ? left.split(":") : [];
    if (right !== undefined) {
      const tail = right ? right.split(":") : [];
      fields.push(...Array<string>(8 - fields.length - tail.length).fill("0"), ...tail);
    }
    if (fields.slice(0, 6).join(":") === "0:0:0:0:0:ffff") {
      return fields.slice(6).flatMap((part) => {
        const number = Number.parseInt(part, 16);
        return [number >> 8, number & 255];
      }).join(".");
    }
    return `${fields.slice(0, 4).join(":")}::/64`;
  } catch {
    return null;
  }
}

export function createSitesDecide(origin: string, securityHeaders: HeadersInit, doFetch: typeof fetch = fetch) {
  const trusted = new URL(origin);
  function reply(status: number, body: unknown, extra: Record<string, string> = {}) {
    const headers = new Headers(securityHeaders);
    for (const [name, value] of Object.entries({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    })) headers.set(name, value);
    return new Response(JSON.stringify(body), { status, headers });
  }
  const reject = (status: number, reason: string, extra?: Record<string, string>) => reply(status, { ok: false, reason }, extra);

  return async (request: Request, env: Env): Promise<Response> => {
    if (request.method !== "POST") return reject(405, "method", { Allow: "POST" });
    if (trusted.protocol !== "https:" || new URL(request.url).origin !== trusted.origin ||
      request.headers.get("Host") !== trusted.host) return reject(403, "host");
    if (request.headers.get("Origin") !== trusted.origin || request.headers.get("Sec-Fetch-Site") !== "same-origin") {
      return reject(403, "origin");
    }
    const mediaType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    const encoding = request.headers.get("Content-Encoding");
    if (mediaType !== "application/json" || (encoding && encoding.toLowerCase() !== "identity")) {
      return reject(415, "content-type");
    }
    const key = env.TYPESAFE_API_KEY;
    if (!key) return reject(503, "no-key");
    if (!env.DECIDE_QUOTA) return reject(503, "quota");
    const ip = visitorIp(request.headers.get("CF-Connecting-IP"));
    if (!ip) return reject(403, "client");
    const length = request.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return reject(413, "size");
    const incoming = requestDeadline(request, 1000);
    let body: unknown;
    try {
      body = await readJson(request, MAX_BODY, incoming);
    } catch (error) {
      if (incoming.aborted) return reject(408, "timeout");
      return error instanceof BodyTooLarge ? reject(413, "size") : reject(400, "json");
    }
    const parsed = DecideBody.safeParse(body);
    if (!parsed.success) return reject(400, "shape");

    const started = Date.now();
    const deadline = requestDeadline(request, 3000);
    try {
      const admitted = await beforeDeadline(reserveQuota(env.DECIDE_QUOTA, ip, key), deadline);
      if (deadline.aborted) return reject(504, "timeout");
      if (!admitted) return reject(429, "rate");
    } catch {
      return deadline.aborted ? reject(504, "timeout") : reject(503, "quota");
    }

    const jev = buildJevRequest(parsed.data.question, parsed.data.screen as Screen);
    try {
      const response = await doFetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(jev),
        // Workers does not implement "error". Return 3xx without following, then reject below.
        redirect: "manual",
        signal: deadline,
      });
      if (!response.ok) {
        // Status only: never log the key, request, or upstream response body.
        console.warn("forecast.jev.upstream", { status: response.status });
        void response.body?.cancel().catch(() => {});
        return reject(502, "upstream");
      }
      const answer = await readJson(response, 32 * 1024, deadline);
      // Report the selected model and fixed choice fields only. Upstream strings and headers stay private.
      return reply(200, { ok: true, model: jev.model, ms: Date.now() - started, answers: checkAnswers(jev, answer) });
    } catch {
      console.warn("forecast.jev.upstream", { failure: deadline.aborted ? "timeout" : "network-or-response" });
      return deadline.aborted ? reject(504, "timeout") : reject(502, "upstream");
    }
  };
}
