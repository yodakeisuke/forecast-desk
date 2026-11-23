import type { Channel } from "../state/store";

const NAMES: Record<Channel, string> = { webmcp: "ChatGPT", js: "JavaScript agent", demo: "ChatGPT", fast: "速いモデル（会議モード）" };
let caller = "エージェント";
let tail: Promise<unknown> = Promise.resolve();

// One UI transaction at a time keeps attribution and confirmation attached to the right call.
export function withCaller<T>(channel: Channel, fn: () => Promise<T>): Promise<T> {
  const next = tail.then(async () => {
    caller = NAMES[channel];
    try { return await fn(); } finally { caller = "エージェント"; }
  });
  tail = next.catch(() => {});
  return next;
}
export const currentAgent = () => caller;
