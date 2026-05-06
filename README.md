# ランチ推薦アプリ

Zeabur 上で稼働中の `n8n`、`Dify`、`PostgreSQL` を活用して、駅名・日付・時刻からランチ候補を推薦する個人利用アプリの初期実装一式です。

このリポジトリは、要件仕様書をもとに「すぐ着手できる実装ベース」を用意することを目的にしています。アプリ本体は `n8n` ワークフローで構築し、曖昧な判定だけを `Dify` に委譲します。

## 構成

- `sql/init.sql`
  - PostgreSQL のテーブル、インデックス、初期データ
- `docs/architecture.md`
  - 全体設計とデータフロー
- `docs/implementation-plan.md`
  - Phase ごとの実装方針
- `docs/api-examples.md`
  - Webhook テスト用の入力例
- `n8n/workflow-a-lunch-search.md`
  - ランチ検索ワークフローのノード設計
- `n8n/workflow-b-manual-check.md`
  - 手動確認登録ワークフローのノード設計
- `n8n/workflows/workflow-a-lunch-search.json`
  - n8n にインポートする検索ワークフロー
- `n8n/workflows/workflow-b-manual-check.json`
  - n8n にインポートする手動確認ワークフロー
- `n8n/generate-workflows.mjs`
  - ワークフロー JSON を再生成するスクリプト
- `n8n/prepare-search-update.mjs`
  - 検索ワークフローの Code ノードと upload 用 JSON を最新化するスクリプト
- `n8n/code/scoring.js`
  - Code ノードに貼り付ける想定のスコアリングロジック
- `n8n/code/building-heuristics.js`
  - 建物タイプやリスクの補正ロジック
- `dify/prompt.md`
  - Dify Workflow 用の判定プロンプト
- `dify/input-example.json`
  - Dify 入力例
- `dify/output-example.json`
  - Dify 出力例
- `.env.example`
  - 必要な環境変数一覧

## 想定アーキテクチャ

1. `n8n Form` または `Webhook` で入力を受け取る
2. Google Maps / Places API で駅座標と候補店を取得する
3. ホットペッパー API で禁煙・ランチ情報を補完する
4. PostgreSQL キャッシュと手動確認結果を参照する
5. 未判定または再判定対象だけ Dify Workflow に送る
6. `n8n` の Code ノードでスコアリングする
7. HTML または Markdown で結果を返し、検索履歴を保存する

## 導入順

1. `sql/init.sql` を PostgreSQL に適用する
2. Zeabur / n8n に `.env.example` の環境変数を設定する
3. `dify/prompt.md` をもとに Dify Workflow を作成する
4. `node n8n/generate-workflows.mjs` を実行してワークフロー JSON を生成する
5. `node n8n/prepare-search-update.mjs` を実行して検索ワークフローと upload 用 JSON を最新化する
6. `n8n/workflows/workflow-a-lunch-search.json` を n8n にインポートする
7. `n8n/workflows/workflow-b-manual-check.json` を n8n にインポートする
8. 各 Postgres ノードに PostgreSQL 資格情報を割り当てる
9. Webhook URL を確認して疎通テストする

## まず動かす最小構成

最短で MVP を確認するなら、次の順で進めるのがおすすめです。

1. `shops`、`shop_judgements`、`manual_checks`、`search_logs` を作成
2. Webhook で `station_name`、`lunch_date`、`lunch_time` を受け取る
3. Google Places で 10 件程度の候補を取得
4. Dify を使わずに API 情報だけで Markdown を返す
5. その後にホットペッパー補完、Dify 判定、手動確認を追加

## 今回作成したワークフロー

### Workflow A

- Webhook: `POST /webhook/lunch-recommendation`
- 概要:
  - 入力を受ける
  - Google Geocoding / Places / Distance Matrix を呼ぶ
  - ホットペッパー補完を行う
  - Dify 判定を行う
  - `manual_checks` を参照して補正する
  - スコアリングする
  - `shops`、`shop_judgements`、`search_logs` に保存する
  - Markdown または HTML 文字列を含む JSON を返す

### Workflow B

- Webhook: `POST /webhook/lunch-manual-check`
- 概要:
  - 手動確認入力を受ける
  - バリデーションする
  - `manual_checks` に登録する
  - 登録結果を返す

## インポート後に確認すること

- `Load Manual Checks`、`Upsert Shops`、`Insert Judgements`、`Insert Search Log`、`Insert Manual Check` に PostgreSQL credential を設定
- n8n の実行環境から `process.env.GOOGLE_MAPS_API_KEY` などが参照できるか確認
- Dify Workflow API の戻り JSON が `data.outputs` 以外の形なら `Search Raw Candidates` ノード内の `runDify()` を微調整
- Webhook の `responseMode` は `lastNode` のため、レスポンスは JSON で返る

## 注意点

- AI に店舗探索はさせず、候補の補助判定だけを依頼する前提です
- `manual_checks` の結果は AI 判定より優先します
- 営業時間、禁煙、階段、空調は断定しすぎず、未確認は `要確認` として残します
- 4 月 20 日から 6 月 10 日は空調リスクを厳しめに扱います
- 生成したワークフロー JSON はこの環境で n8n 実機インポートまでは実行していないため、ノード型の微差分がある場合はインポート後に 1 回動作確認してください
