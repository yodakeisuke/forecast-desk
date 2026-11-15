// PDF export: the report spec and its materialised figures go to a Web Worker, which renders them with
// react-pdf through a PDF registry for the same catalog (report@1). The page never blocks.
import { actions, type AppState } from "../state/store";
import { trustedScriptURL } from "../lib/trusted-types";
// bundled as its own module worker in both dev and build; the page only gets its URL
import workerUrl from "./pdf.worker.tsx?worker&url";

export async function exportPdf(report: NonNullable<AppState["report"]>, share = false) {
  const blocks = report.blocks;
  const worker = new Worker(trustedScriptURL(new URL(workerUrl, location.href).href) as any, { type: "module", name: "pdf" });
  const t0 = performance.now();
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("60秒以内に終わりませんでした")), 60_000);
      worker.onmessage = (e) => { clearTimeout(timer); e.data?.ok ? resolve(e.data.blob as Blob) : reject(new Error(e.data?.error ?? "失敗しました")); };
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || "ワーカーでエラー")); };
      worker.postMessage({ spec: report.spec, blocks, fontBase: new URL(`${import.meta.env.BASE_URL}fonts/`, location.href).href });
    });
    const file = new File([blob], `forecast-report-${new Date().toISOString().slice(0, 10)}.pdf`, { type: "application/pdf" });
    if (share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: report.title }); actions.toast("共有ダイアログにPDFを渡しました"); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `forecast-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    actions.toast(`PDFを書き出しました（${Math.round(blob.size / 1024)}KB · ${Math.round(performance.now() - t0)}ms）`);
    actions.pushItem({ who: "user", result: "報告書をPDFで書き出し", running: false });
    (globalThis as any).__fpaLastPdf = { size: blob.size, ms: Math.round(performance.now() - t0) };
  } finally {
    worker.terminate();
  }
}
