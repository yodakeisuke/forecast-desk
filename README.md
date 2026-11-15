# Forecast Desk

FP&A の月次ローリングフォーキャストを、AIエージェントが WebMCP 経由で操作するダッシュボードです。チャットUIはありません。エージェントが画面のツールを呼び、人間は同じ画面で結果を見て、触って、戻せます。

- **AIがEDAを先導する**: 比較元の切り替え、ドリルダウン・アクロス・スルー・アップをツールで行い、見るべき場所を注記つきでハイライトします。
- **GenUI**: エージェントが書いたウィジェットのコード（TSX）を、別オリジンのサンドボックスで実行します。カタログ（json-render `fpa@1`）の部品とSDKのフックだけで組み、カタログにない図は「自由生成」スロットに描きます。
- **レポート**: EDAで残った注記・ウィジェット・図から `compose_report` で報告書を組み、PDFに書き出します（人の確認つき）。
- **戻せる**: 画面の変更はすべて UI SDK のブリッジを通り、誰が変えたかを記録します。「Agentの操作を戻す」でフィルター・ドリル・注記・共有シナリオのAIによる変更を取り消せます。生成したカードや作成済みPDFは削除しません。

データはダミーです（DuckDB-WASMでブラウザ内に生成）。

## 動かす

Node 20.19 以上（22 推奨）。

```bash
npm install
npm run dev
```

- ダッシュボード: http://localhost:5173
- サンドボックス: http://127.0.0.1:5174 （ウィジェット専用。直接開く必要はありません）

通常画面に操作順の制約はありません。`http://localhost:5173/?demo=1` を開くと検証用バーが表示され、▶で8つの操作例（EDA → GenUI → 共同編集 → 報告書 → 攻撃テスト）を、本物のツール呼び出しで再生します。

本番ビルドの確認は `npm run preview`（http://localhost:4173）。CSP・Trusted Types が本番の設定で効きます。

## エージェントからつなぐ

ツールは2つの経路で同じものを出しています。

1. **WebMCP**: `document.modelContext.registerTool` で15個のツールを登録します。ブラウザに WebMCP がなければ `@mcp-b/global` のポリフィルを使います（右上のチップに `WebMCP polyfill · 15 tools` と出ます）。WebMCP に対応したブラウザ・拡張・エージェントから、このタブのツールとして見えます。
2. **JavaScript**: ページでJSを実行できるエージェント向けに `window.fpa` があります。

```js
window.fpa.help()
window.fpa.tools()                                  // 一覧と説明・スキーマ
await window.fpa.call("set_filter", { compare_from: "9月版" })
await window.fpa.call("drill_down", { member: "北米", by: ["region", "segment"] })
// 注記の数字はquery_dataで確認してから書きます。
await window.fpa.call("get_catalog", { name: "fpa@1" })   // ウィジェットの部品とフック
await window.fpa.call("compose_report", { title: "10月版 フォーキャスト報告", summary: "…" })
```

主なツール: `query_data` `explore_sql`（読み取り専用SQL） `set_filter` `drill_down` `drill_up` `drill_across` `drill_through` `highlight` `get_catalog` `render_widget` `operate_widget` `compose_report`、UI SDK 汎用の `snapshot` `act` `query`。

Chrome では起動時に `Origin trial controlled feature not enabled: 'tools'` という警告が出ますが、`Permissions-Policy: tools=(self)` を先に宣言しているためで、動作には影響しません。

## セキュリティの壁

左のナビの盾アイコン（セキュリティ）に、壁の構成と、このセッションで止めたものが出ます。

- 生成コードは別オリジン（127.0.0.1:5174）の `sandbox="allow-scripts"` iframe で動きます。オリジンは不透明で、Cookie・ストレージ・親ページに届きません。
- サンドボックスは CSP `connect-src 'none'` に加え、`webrtc 'block'`、`Connection-Allowlist: (response-origin)`、`X-DNS-Prefetch-Control: off` を配信します。Connection-Allowlistはブラウザ対応が限定されるため、対象クライアントでWebRTC・DNS・遷移を含む実通信テストが公開前の必須確認です。
- ホストとは MessagePort 1本だけ。メッセージは zod の許可リストで形・大きさ・頻度を検査し、書き込めるのは `/scenario/*` の数値だけです。
- PDF書き出しと共有は `data-agent-confirm` で人の確認待ちになります。
- `explore_sql` は SELECT / WITH の1文だけ、外部アクセスと拡張は無効、3秒・200行で打ち切ります。
- ホストは Trusted Types と厳しい CSP で動きます。

## テスト

```bash
npx playwright install chromium   # 初回だけ
npm test                          # 全部（約1分半）
npm run test:security             # 攻撃テスト
npm run test:e2e                  # デモ通し・PDF・ドリル・WebMCP
```

テストは `npm run dev` を自動で起動します（起動済みならそれを使います）。

## 構成

```
src/
  agent/      ツール定義（tools.ts）、WebMCP と window.fpa への登録、UI SDK のブリッジと履歴
  data/       ダミーデータの生成、DuckDB-WASM、集計（cube.ts）
  genui/      サンドボックスの親側（host.ts）とデータ問い合わせの許可リスト
  report/     report@1 カタログ、報告書の組み立て、図の書き出し、PDFワーカー
  shared/     チャート（SVGジオメトリ）と fpa@1 カタログ。画面・サンドボックス・PDFで共有
  demo/       デモのシーンと、エージェントが書くウィジェットのコード
  ui/         画面
sandbox/      ウィジェットのランタイムと @fpa/genui-sdk（部品・フック）
server/       サンドボックス用の静的サーバー（ヘッダーつき）
security.config.mjs   CSP などのヘッダー
tests/        Playwright（security / e2e）
```

## 業務操作とデモの関係

データだけがダミーです。ツールは固定シナリオを呼び出す仕組みではなく、各操作を独立して実行します。`src/demo/` は同じ公開ツールを使う検証用クライアントです。

- ウォーターフォールは比較元・地域・セグメント・製品から再集計します。GenUIの`BridgeChart`でも任意の版・対象を指定でき、PDFにも出力できます。
- シナリオは`filters`で対象を選び、スリップ戻り率・成約率・見通し補正を計算します。`naBias`は互換用のプロパティ名で、効果は指定範囲に適用されます。共有値はブラウザで人とAgentが操作できます。
- 財務データは地域×セグメント×製品、ARR実績/見通しは地域、人員は地域、為替は全社の粒度です。集計できない粒度を捏造せず、画面に適用範囲を表示します。
- 比較元・フィルター・シナリオ前提・アクティビティ表示はlocalStorageに保存します。注記・生成コード・報告書はタブ内の作業状態です。PDFは作成時点の図表・条件を保存します。
- 「共有」は条件入りリンクをコピーします。報告書の共有はOS共有に対応する場合にPDFを渡し、それ以外はPDFをダウンロードします。メールを勝手に送信しません。

## Codex Sitesへの公開

アプリとGenUIを別々のSiteに配信します。アプリの計算・データ・ツール実行はすべてブラウザ内です。配信WorkerはHTMLと静的アセットにセキュリティヘッダーを付けるだけで、分析APIや外部データ処理を持ちません。Sitesの静的配信では`_headers`が反映されなかったため、この構成にしています。

```bash
FPA_ASSET_BASE=/guarded/ \
FPA_HOST_ORIGIN=https://YOUR-APP.example \
FPA_SANDBOX_ORIGIN=https://YOUR-SANDBOX.example npm run build
```

同じorigin環境変数で`node scripts/stage-site.mjs sandbox <sandbox-checkout>/dist`、続いて`node scripts/stage-site.mjs app <app-checkout>/dist`を実行し、それぞれのSitesソースからパッケージします。`.openai/hosting.json`は各Site固有の`project_id`を使用し、`static`は指定しません。HTMLはWorkerのみが返し、公開アセットURLは`/guarded/`配下の許可リストです。DuckDBのWASMは配信制限に合わせgzipで保存し、`Content-Encoding: gzip`で配信します。

```bash
npm run typecheck
npm run test:unit
npm test
```

## ライセンス

本アプリ独自のコードの利用許諾は未設定です（`UNLICENSED`）。第三者ライブラリとフォントの権利・ライセンスは `public/THIRD_PARTY_NOTICES.txt` に記載しています。

会社名・担当者名・案件・財務数値は検証用に生成した架空のデータです。実在の顧客データ、接続情報、秘密鍵は含めません。

## 生成UIの変更者と人間の前提

サンドボックスからの自発的書き込みは`widget`、WebMCPの操作中は`agent`として扱います。サンドボックスの自己申告を人間操作の証拠にはしません。人間はホスト側の「シナリオ前提」で直接変更でき、その値を生成UIが上書きするときは、ホスト上に値を明示した確認を出します。確認はツールから不可視で、trusted入力でのみ適用されます。置換・破棄されたウィジェットや、その後値が変わった古い提案は適用しません。

生成UI内のUndoも、エージェントによる明示操作以外ではホスト上の確認が必要です。「生成UIの変更だけ戻す」は、自発的変更を人の変更と分けて取り消します。
