// The UI SDK agent bridge: one entry for every change, from a person, a WebMCP tool, or window.fpa.
// Created before the first render so it sees every component as it mounts.
import { createAgent } from "@ui-sdk/react/agent";
import { createHistory, describeEntry } from "@ui-sdk/react/history";
import { actions } from "../state/store";

export const agent = createAgent({
  // Production policy: reading and undoable screen changes (filters, drills, notes, scenario values) run
  // on their own. Anything marked data-agent-confirm (PDF export, sharing) waits for the person.
  allow: (step, { signal }) => (step.confirm ? actions.askConfirm(step.confirm, signal) : true),
  timeout: 120_000,
});

// Recorded history: entries carry their source, so "undo only what the agent did" is undoSource("agent").
export const history = createHistory(agent, { within: () => document.getElementById("content") });
export { describeEntry };

const LABELS: Record<string, (v: unknown) => string> = {
  比較元: (v) => `比較元を「${({ budget: "予算", v09: "9月版", v08: "8月版" } as Record<string, string>)[String(v)] ?? v}」に変更`,
  地域: (v) => `地域を「${v === "all" ? "すべて" : v}」に変更`,
  セグメント: (v) => `セグメントを「${v === "all" ? "すべて" : v}」に変更`,
  製品: (v) => `製品を「${v === "all" ? "すべて" : v}」に変更`,
  差異表: (v) => `差異表を操作（${String(v).replace(/^tab=/, "")}）`,
  差異表のビュー: (v) => `タブを「${({ variance: "売上差異", pipeline: "パイプライン", drivers: "ドライバー" } as Record<string, string>)[String(v)] ?? v}」に切替`,
};

// A person's changes go into the activity log, so the agent's next snapshot and the human see the same story.
agent.subscribe((change) => {
  if (change.source === "agent" || change.source === "programmatic") return;
  if (change.key !== "value") return;
  const f = LABELS[change.label ?? ""];
  if (!f) return;
  actions.pushItem({ who: "user", result: f(change.value), running: false });
});

Object.assign(globalThis, { __fpaAgent: agent });
