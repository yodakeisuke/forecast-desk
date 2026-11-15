import type { Who } from "../state/store";
// A same-realm widget cannot attest that an event came from a human.
export function widgetWritePolicy(operating: boolean, currentOwner: Who | undefined, before: number, value: number): { source: "agent" | "widget"; decision: "unchanged" | "confirm" | "apply" } {
  return {
    source: operating ? "agent" : "widget",
    // A no-op must not transfer ownership: that would let a widget first echo a human value,
    // then silently overwrite it in a second request after claiming ownership.
    decision: before === value ? "unchanged" : !operating && currentOwner === "user" ? "confirm" : "apply",
  };
}
