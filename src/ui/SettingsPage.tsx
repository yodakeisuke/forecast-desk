import { Button } from "@ui-sdk/react/button";
import { actions, useApp } from "../state/store";
import { currentContext } from "../state/preferences";
import { downloadBlob } from "../lib/download";
export function SettingsPage() {
  const rail = useApp(s => s.rail);
  return <div className="page"><div className="phead"><h1>設定</h1></div><section className="card"><div className="card-b">
    <h2>表示と分析条件</h2><p>比較元・絞り込み・シナリオ前提・操作履歴の表示状態は、このブラウザに保存します。</p>
    <Button className="tbtn" aria-pressed={rail} onClick={actions.toggleRail}>操作履歴を{rail ? "非表示" : "表示"}</Button>
    <Button className="tbtn" onClick={() => downloadBlob(new Blob([JSON.stringify(currentContext(), null, 2)], {type:"application/json"}), "forecast-analysis.json")}>分析条件を保存</Button>
    <h2>データと保存範囲</h2><p>現在のデータセットは Sorano Cloud FY2026 のサンプルデータです。注記・追加分析・報告書は現在のタブの作業内容です。残す報告書はPDFで保存できます。</p>
    <Button className="tbtn" onClick={() => actions.setPage("security")}>セキュリティ設定を確認</Button>
  </div></section></div>;
}
