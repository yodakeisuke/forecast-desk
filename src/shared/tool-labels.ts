const labels: Record<string, string> = {
  query_data: "データを集計", explore_sql: "データを検索", set_filter: "分析条件を変更",
  drill_down: "内訳を表示", drill_up: "集計に戻る", drill_across: "分析の視点を変更",
  drill_through: "案件の明細を表示", highlight: "注記を追加", get_catalog: "分析項目を確認",
  render_widget: "分析を追加", operate_widget: "試算を変更", compose_report: "レポートを作成",
  snapshot: "画面を確認", query: "操作項目を確認", act: "画面を操作",
};
export const toolLabel = (name: string) => labels[name] ?? name;
