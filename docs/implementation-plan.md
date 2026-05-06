# 実装計画

## Phase 1

- PostgreSQL に `sql/init.sql` を適用
- n8n に `Webhook` または `Form Trigger` を作成
- Google Geocoding API で駅座標を取得
- Google Places API で 10 件から 20 件の候補取得
- Markdown 出力で結果を返す

## Phase 2

- Place Details の追加取得
- ホットペッパー補完
- Dify Workflow 追加
- `n8n/code/scoring.js` を使ったスコアリング実装

## Phase 3

- 手動確認フォーム追加
- `manual_checks` の優先適用
- `building_keywords` と `chain_brands` を使った補正

## Phase 4

- HTML 出力改善
- Google Maps / Street View リンク追加
- 検索履歴の再表示

## 開発順のおすすめ

1. `Google Places -> Markdown` まで先に動かす
2. その後 `PostgreSQL` 保存を足す
3. その後 `Dify` をつなぐ
4. 最後に手動確認と表示改善を入れる

## 受け入れ確認の観点

- 駅名、日付、時刻の入力が通る
- 徒歩 10 分以内の候補に絞れる
- 禁煙、ランチ営業、評価が出せる
- AI 判定と手動確認が両立できる
- API 部分失敗でも結果を返せる
