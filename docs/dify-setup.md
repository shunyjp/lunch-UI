# Dify セットアップ

## 現在の Dify アプリ

- App name: `LunchShopJudge`
- App ID: `90cc35dc-8fa1-40e4-b8dc-87bee1adcdf2`
- API Base URL: `https://ysdify.zeabur.app/v1`
- 想定 Workflow Run URL: `https://ysdify.zeabur.app/v1/workflows/run`

## 現状

- MCP 経由で Dify の workflow アプリ作成と DSL インポートは完了
- Gemini LLM ノードは `AI活用トレンド定期収集_Workflow` と同じ設定を流用済み
  - provider: `langgenius/gemini/google`
  - model: `gemini-3.1-pro-preview`
  - temperature: `0.2`
- `Publish` だけは MCP から 404 になったため、Dify UI で手動実施する

## Dify UI でやること

1. Dify で `LunchShopJudge` を開く
2. ワークフローを確認する
3. 右上の `Publish` または `Publish Update` を実行する
4. `Service API` を開く
5. API Key を新規発行する

## `.env` に入れる値

```text
DIFY_API_KEY=<Service API で発行したキー>
DIFY_WORKFLOW_URL=https://ysdify.zeabur.app/v1/workflows/run
```

## ローカル疎通確認

`.env` を更新後、以下で Dify Workflow API を直接確認できる。

```powershell
py -3.14 scripts\test_dify_workflow.py
```

成功すると、Dify の blocking response が JSON で表示される。

## 補足

- 現在の End ノードは `result` という 1 つの文字列出力を返す
- LLM には「JSON のみ返す」よう指示しているため、`result` の中身は JSON 文字列になる想定
- n8n 側では `data.outputs.result` または `data.outputs` の形を見て必要に応じて JSON パースする
