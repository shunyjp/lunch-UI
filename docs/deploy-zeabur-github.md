# Deploy to Zeabur via GitHub

このプロジェクトは GitHub 経由で Zeabur に載せるのが最短です。

公式参考:

- [Create Service - Zeabur](https://zeabur.com/docs/en-US/deploy/create-service)
- [GitHub Integration - Zeabur](https://zeabur.com/docs/en-US/deploy/github)
- [Deploy Python Projects - Zeabur](https://zeabur.com/docs/en-US/guides/python)
- [Service Configuration - Zeabur](https://zeabur.com/docs/en-US/deploy/config)

## 事前準備

このリポジトリには以下を追加済みです。

- `scripts/lunch_ui.py`
  - 公開用の軽量 UI
- `zbpack.json`
  - Zeabur に Python の起動ファイルを `scripts/lunch_ui.py` と伝える設定
- `.gitignore`
  - `.env` などを GitHub に出さないための除外設定

## GitHub 側の準備

まだ Git 管理していない場合は、ルートで次を実行します。

```powershell
git init
git branch -M main
git add .
git commit -m "Add lunch UI for Zeabur deployment"
```

GitHub に新しい空リポジトリを作ったら、次を実行します。

```powershell
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## Zeabur 側の作業

1. Zeabur で対象 Project を開く
2. `Deploy New Service`
3. `GitHub`
4. このリポジトリを選ぶ
5. Root Directory はリポジトリ直下のまま
6. Deploy

Zeabur は Python プロジェクトとして認識し、`main.py` を起動対象にします。  
このリポジトリでは保険として `zbpack.json` にも `main.py` を指定しています。

## 必要な環境変数

UI サービスには最低限これを設定します。

```text
N8N_LUNCH_WEBHOOK_URL=https://ysjpn8n.zeabur.app/webhook/lunch-recommendation
LUNCH_UI_USERNAME=<your-ui-username>
LUNCH_UI_PASSWORD=<your-ui-password>
```

任意:

```text
LUNCH_UI_HOST=0.0.0.0
LUNCH_UI_PORT=8787
LUNCH_UI_ACCESS_TOKEN=
```

注意:

- `LUNCH_UI_USERNAME` と `LUNCH_UI_PASSWORD` を入れるなら `LUNCH_UI_ACCESS_TOKEN` は空で構いません
- 認証なし公開は避けるのがおすすめです

## 確認ポイント

デプロイ後は次を確認します。

1. Zeabur の service URL にアクセスできる
2. Basic 認証が効く
3. `/healthz` が `ok` を返す
4. フォーム送信で n8n の検索結果が返る

## 404 のときにまず見る場所

公開 URL が `404` の場合は、まず Zeabur の `Deployments` / `Runtime Logs` を確認します。

特に次を見てください。

1. Python サービスとして認識されているか
2. `main.py` が起動対象になっているか
3. `Lunch UI running on http://0.0.0.0:<PORT>` がログに出ているか
4. crash loop や command not found がないか

`py -3.14 ...` のような Windows 向けコマンドは Linux では使わないでください。Zeabur では `python` / `python3` 系、または `_startup` を使うのが安全です。

## 更新フロー

GitHub 連携では、push すると Zeabur が自動再デプロイします。

```powershell
git add .
git commit -m "Update lunch UI"
git push
```

## 補足

もし Zeabur 側で entrypoint を環境変数で指定したいなら、公式 docs にある通り次でも動きます。

```text
ZBPACK_PYTHON_ENTRY=scripts/lunch_ui.py
```

このリポジトリでは `zbpack.json` で同じ指定をしています。
