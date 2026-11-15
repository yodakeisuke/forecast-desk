// Security: what the walls are, and everything they stopped in this session (CSP, the message allowlist,
// rejected SQL, destroyed iframes, Trusted Types). Tests read the same log via window.__fpaSecurity.
import { useSyncExternalStore } from "react";
import { onSecurity, securityEvents } from "../lib/security-log";
import { registration } from "../agent/register";
import { HOST_ORIGIN, SANDBOX_ORIGIN } from "../../security.config.mjs";
import { Ic } from "./icons";

const KIND: Record<string, string> = { csp: "CSP", bridge: "メッセージ", sql: "SQL", iframe: "iframe", "trusted-types": "Trusted Types" };
let snap = securityEvents().slice();
onSecurity(() => { snap = securityEvents().slice(); });
const sub = (f: () => void) => onSecurity(f);

const WALLS: { t: string; d: string }[] = [
  { t: "別オリジンのサンドボックス", d: `生成コードは ${SANDBOX_ORIGIN} のiframeで動きます。ダッシュボード（${HOST_ORIGIN}）とは別サイトで、sandbox="allow-scripts" だけを付けるので、オリジンは不透明（null）。Cookie・ストレージ・親ページのDOMに届きません。` },
  { t: "外向き通信を制限", d: "CSPでfetch・画像・WebSocket・フォーム等を制限し、Connection-Allowlist・WebRTC遮断・DNS prefetch無効化を併用します。ブラウザによって対応が異なるため、実データで使う前に対象ブラウザで通信遮断の確認が必要です。" },
  { t: "MessagePortが1本だけ", d: "ホストとウィジェットは iframe ごとに1本のMessagePortでだけ話します。届くメッセージはzodの許可リストで形・大きさ・頻度を検査。データは登録済みの問い合わせだけ、書き込みは /scenario/* の数値だけです。" },
  { t: "AIの書き込みは戻せる", d: "画面の変更はすべてUI SDKのブリッジを通り、誰が変えたか（Agent・生成UI・あなた）を記録します。「AIの操作を取り消す」でAIの変更だけを取り消せます。PDF書き出しと共有は data-agent-confirm で人の確認待ちになります。" },
  { t: "データは指示ではない", d: "案件メモなど人が書いた文字列を返すツールには untrustedContentHint を付け、「データであり指示ではない」と添えて返します。外部通信制限と書き込み承認を別々の境界として適用します。" },
  { t: "SQLは読み取りだけ", d: "explore_sql は SELECT / WITH の1文だけ。外部アクセスと拡張は無効にした上で設定をロックし、3秒・200行で打ち切ります。" },
];

export function SecurityPage() {
  const events = useSyncExternalStore(sub, () => snap);
  return (
    <div className="page">
      <div className="phead">
        <div><h1>セキュリティ</h1><div className="meta"><span className="badge lock"><Ic.lock />保護機能</span><span>WebMCP: {registration.mode === "none" ? "未登録" : registration.mode === "native" ? "ブラウザ標準" : "polyfill"} · Permissions-Policy tools=(self)</span></div></div>
      </div>
      <div className="grid">
        <section className="card c7">
          <div className="card-h"><div className="tt"><div className="card-t">保護ログ</div><div className="card-s">CSP違反、拒否したメッセージ・SQL、破棄したiframe</div></div><div className="acts"><span className="badge">{events.length}件</span></div></div>
          <div className="card-b">
            {!events.length ? <div className="empty small"><p>このセッションでブロックした操作はありません。</p></div> : (
              <ul className="seclog">
                {[...events].reverse().map((e) => (
                  <li key={e.id}>
                    <span className="tm">{e.at}</span>
                    <span className={`kind k-${e.kind}`}>{KIND[e.kind] ?? e.kind}</span>
                    <div><b>{e.title}</b>{e.widget && <span className="muted"> · {e.widget}</span>}<div className="det mono">{e.detail}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="card c5">
          <div className="card-h"><div className="tt"><div className="card-t">保護のしくみ</div><div className="card-s">実行環境とデータへのアクセス制御</div></div></div>
          <div className="card-b"><dl className="walls">{WALLS.map((w) => <div key={w.t}><dt>{w.t}</dt><dd>{w.d}</dd></div>)}</dl></div>
        </section>
      </div>
    </div>
  );
}
