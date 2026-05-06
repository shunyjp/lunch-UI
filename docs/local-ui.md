# Local UI

普段使い用に、n8n のランチ検索 Webhook を叩く軽量 Web UI を用意しています。

## ローカル起動

```powershell
py -3.14 scripts\lunch_ui.py
```

起動後に以下へアクセスします。

```text
http://127.0.0.1:8787
```

## 外出先利用

Zeabur に Python サービスとして配置できます。  
このリポジトリでは `main.py` を追加してあるため、Zeabur 側は自動認識で起動しやすくなっています。

必要なら Start Command は空でもよいです。明示したい場合も Linux では `python3 main.py` を使ってください。

## できること

- 駅名 / 日付 / 時刻 / 徒歩上限 / 最低評価の入力
- 推奨オプションの ON/OFF
- `markdown` / `html` の切替
- n8n Webhook の実行
- `rendered_content` の表示
- 生の JSON 結果の確認
- `/healthz` のヘルスチェック

## 環境変数

```text
N8N_LUNCH_WEBHOOK_URL=https://ysjpn8n.zeabur.app/webhook/lunch-recommendation
LUNCH_UI_HOST=0.0.0.0
LUNCH_UI_PORT=8787
LUNCH_UI_USERNAME=
LUNCH_UI_PASSWORD=
LUNCH_UI_ACCESS_TOKEN=
```

## 認証

外部公開するなら、少なくともどちらか 1 つは設定してください。

- `LUNCH_UI_USERNAME` と `LUNCH_UI_PASSWORD`
  - Basic 認証で保護します
- `LUNCH_UI_ACCESS_TOKEN`
  - `X-Access-Token` ヘッダー、または `?token=...` で通します

おすすめは Basic 認証です。
