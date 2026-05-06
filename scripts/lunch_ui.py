from __future__ import annotations

import base64
import html
import json
import os
import urllib.error
import urllib.request
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs


DEFAULT_WEBHOOK_URL = "https://ysjpn8n.zeabur.app/webhook/lunch-recommendation"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8787


def load_env_file() -> None:
    env_path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()


def get_webhook_url() -> str:
    return os.environ.get("N8N_LUNCH_WEBHOOK_URL", DEFAULT_WEBHOOK_URL)


def to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "on", "yes"}


def build_payload(form: dict[str, str]) -> dict[str, object]:
    return {
        "station_name": form.get("station_name", "").strip(),
        "lunch_date": form.get("lunch_date", "").strip(),
        "lunch_time": form.get("lunch_time", "").strip(),
        "max_walk_minutes": int(form.get("max_walk_minutes", "10") or "10"),
        "min_rating": float(form.get("min_rating", "3.5") or "3.5"),
        "prefer_salad_bar": to_bool(form.get("prefer_salad_bar"), True),
        "avoid_zakkyo_building": to_bool(form.get("avoid_zakkyo_building"), True),
        "avoid_independent_store_in_aircon_sensitive_season": to_bool(
            form.get("avoid_independent_store_in_aircon_sensitive_season"),
            True,
        ),
        "prefer_large_building": to_bool(form.get("prefer_large_building"), True),
        "exclude_high_stairs_risk": to_bool(form.get("exclude_high_stairs_risk"), True),
        "output_format": form.get("output_format", "markdown").strip() or "markdown",
    }


def call_webhook(payload: dict[str, object]) -> dict[str, object]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        get_webhook_url(),
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        raw = response.read().decode(charset)
        return json.loads(raw)


def checked_attr(current: bool) -> str:
    return "checked" if current else ""


def selected_attr(current: str, expected: str) -> str:
    return "selected" if current == expected else ""


def get_default_values() -> dict[str, str]:
    return {
        "station_name": "大宮駅",
        "lunch_date": date.today().isoformat(),
        "lunch_time": "12:00",
        "max_walk_minutes": "10",
        "min_rating": "3.5",
        "output_format": "markdown",
        "prefer_salad_bar": "true",
        "avoid_zakkyo_building": "true",
        "avoid_independent_store_in_aircon_sensitive_season": "true",
        "prefer_large_building": "true",
        "exclude_high_stairs_risk": "true",
    }


def render_page(
    values: dict[str, str],
    result: dict[str, object] | None = None,
    error_message: str | None = None,
) -> str:
    result_json = ""
    rendered_content = ""
    if result is not None:
        result_json = json.dumps(result, ensure_ascii=False, indent=2)
        rendered_content = str(result.get("rendered_content", ""))

    station_name = html.escape(values.get("station_name", "大宮駅"))
    lunch_date = html.escape(values.get("lunch_date", date.today().isoformat()))
    lunch_time = html.escape(values.get("lunch_time", "12:00"))
    max_walk_minutes = html.escape(values.get("max_walk_minutes", "10"))
    min_rating = html.escape(values.get("min_rating", "3.5"))
    output_format = values.get("output_format", "markdown")

    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lunch Recommendation UI</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f4ea;
      --card: #fffdf7;
      --ink: #1e2a24;
      --muted: #5f6b63;
      --line: #d8d1bc;
      --accent: #2f6c4f;
      --danger: #a33a2b;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Yu Gothic UI", "Hiragino Sans", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(217,143,58,.16), transparent 30%),
        linear-gradient(180deg, #f6f1e2 0%, var(--bg) 60%);
      color: var(--ink);
    }}
    .wrap {{
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px;
    }}
    .hero {{
      margin-bottom: 20px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255,253,247,.84);
      backdrop-filter: blur(10px);
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 32px;
    }}
    .sub {{
      margin: 0;
      color: var(--muted);
    }}
    .grid {{
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 20px;
    }}
    .panel {{
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--card);
      padding: 20px;
      box-shadow: 0 10px 30px rgba(45, 56, 49, .06);
    }}
    label {{
      display: block;
      margin: 0 0 6px;
      font-size: 14px;
      color: var(--muted);
    }}
    input, select {{
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: white;
      font-size: 15px;
    }}
    .field {{ margin-bottom: 14px; }}
    .check {{
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fbf8ef;
    }}
    .check input {{
      width: auto;
      transform: scale(1.15);
    }}
    .actions {{
      display: flex;
      gap: 10px;
      margin-top: 18px;
    }}
    button {{
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 700;
    }}
    .primary {{
      background: var(--accent);
      color: white;
    }}
    .secondary {{
      background: #ece5d0;
      color: var(--ink);
    }}
    .meta {{
      margin-top: 14px;
      font-size: 13px;
      color: var(--muted);
      word-break: break-all;
    }}
    .error {{
      margin-bottom: 16px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #fff0ed;
      color: var(--danger);
      border: 1px solid #efc2ba;
    }}
    .result-box {{
      white-space: pre-wrap;
      word-break: break-word;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
      min-height: 240px;
      line-height: 1.6;
    }}
    details {{
      margin-top: 16px;
    }}
    summary {{
      cursor: pointer;
      color: var(--accent);
      font-weight: 700;
    }}
    pre {{
      margin: 12px 0 0;
      padding: 16px;
      border-radius: 16px;
      background: #17201b;
      color: #eaf4ee;
      overflow: auto;
      font-size: 12px;
      line-height: 1.5;
    }}
    @media (max-width: 900px) {{
      .grid {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Lunch Recommendation UI</h1>
      <p class="sub">外出先からでも、n8n のランチ検索をすぐ使える軽量フロントです。</p>
    </section>

    <div class="grid">
      <section class="panel">
        <form method="post" action="/search" accept-charset="utf-8">
          <div class="field">
            <label for="station_name">駅名</label>
            <input id="station_name" name="station_name" value="{station_name}" required>
          </div>
          <div class="field">
            <label for="lunch_date">日付</label>
            <input id="lunch_date" name="lunch_date" type="date" value="{lunch_date}" required>
          </div>
          <div class="field">
            <label for="lunch_time">ランチ時刻</label>
            <input id="lunch_time" name="lunch_time" type="time" value="{lunch_time}" required>
          </div>
          <div class="field">
            <label for="max_walk_minutes">徒歩上限（分）</label>
            <input id="max_walk_minutes" name="max_walk_minutes" type="number" min="1" max="30" value="{max_walk_minutes}">
          </div>
          <div class="field">
            <label for="min_rating">最低評価</label>
            <input id="min_rating" name="min_rating" type="number" step="0.1" min="0" max="5" value="{min_rating}">
          </div>
          <div class="field">
            <label for="output_format">出力形式</label>
            <select id="output_format" name="output_format">
              <option value="markdown" {selected_attr(output_format, "markdown")}>markdown</option>
              <option value="html" {selected_attr(output_format, "html")}>html</option>
            </select>
          </div>

          <label class="check"><input type="checkbox" name="prefer_salad_bar" value="true" {checked_attr(to_bool(values.get("prefer_salad_bar"), True))}>サラダバー優先</label>
          <label class="check"><input type="checkbox" name="avoid_zakkyo_building" value="true" {checked_attr(to_bool(values.get("avoid_zakkyo_building"), True))}>雑居ビル回避</label>
          <label class="check"><input type="checkbox" name="avoid_independent_store_in_aircon_sensitive_season" value="true" {checked_attr(to_bool(values.get("avoid_independent_store_in_aircon_sensitive_season"), True))}>空調不安期の個人店回避</label>
          <label class="check"><input type="checkbox" name="prefer_large_building" value="true" {checked_attr(to_bool(values.get("prefer_large_building"), True))}>大型施設優先</label>
          <label class="check"><input type="checkbox" name="exclude_high_stairs_risk" value="true" {checked_attr(to_bool(values.get("exclude_high_stairs_risk"), True))}>階段リスク高を除外</label>

          <div class="actions">
            <button class="primary" type="submit">検索する</button>
            <button class="secondary" type="button" onclick="window.location='/'">リセット</button>
          </div>
        </form>

        <div class="meta">Webhook: {html.escape(get_webhook_url())}</div>
      </section>

      <section class="panel">
        {f'<div class="error">{html.escape(error_message)}</div>' if error_message else ''}
        <div class="result-box">{html.escape(rendered_content or "まだ検索していません。左のフォームから実行できます。")}</div>
        <details>
          <summary>JSON を見る</summary>
          <pre>{html.escape(result_json or "{}")}</pre>
        </details>
      </section>
    </div>
  </div>
</body>
</html>
"""


def get_basic_auth_credentials() -> tuple[str, str] | None:
    username = os.environ.get("LUNCH_UI_USERNAME", "")
    password = os.environ.get("LUNCH_UI_PASSWORD", "")
    if username and password:
        return username, password
    return None


def get_access_token() -> str:
    return os.environ.get("LUNCH_UI_ACCESS_TOKEN", "")


class LunchUiHandler(BaseHTTPRequestHandler):
    server_version = "LunchUi/0.2"

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self.respond_text("ok")
            return

        if not self.authorize():
            return

        if self.path != "/":
            self.respond_text("Not Found", status=404)
            return

        self.respond_html(render_page(get_default_values()))

    def do_POST(self) -> None:
        if not self.authorize():
            return

        if self.path != "/search":
            self.respond_text("Not Found", status=404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        parsed = parse_qs(body, keep_blank_values=True)
        values = {key: parsed.get(key, [""])[0] for key in parsed}

        for key in (
            "prefer_salad_bar",
            "avoid_zakkyo_building",
            "avoid_independent_store_in_aircon_sensitive_season",
            "prefer_large_building",
            "exclude_high_stairs_risk",
        ):
            if key not in values:
                values[key] = ""

        try:
            payload = build_payload(values)
            result = call_webhook(payload)
            self.respond_html(render_page(values, result=result))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            self.respond_html(
                render_page(values, error_message=f"Webhook returned HTTP {error.code}: {detail}"),
                status=502,
            )
        except Exception as error:  # pragma: no cover
            self.respond_html(render_page(values, error_message=str(error)), status=500)

    def authorize(self) -> bool:
        token = get_access_token()
        if token:
            provided = self.headers.get("X-Access-Token", "")
            if provided == token:
                return True

            query_token = ""
            if "?" in self.path:
                query = self.path.split("?", 1)[1]
                query_token = parse_qs(query).get("token", [""])[0]
            if query_token == token:
                return True

            self.respond_text("Forbidden", status=403)
            return False

        credentials = get_basic_auth_credentials()
        if not credentials:
            return True

        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            self.request_basic_auth()
            return False

        try:
            decoded = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8")
        except Exception:
            self.request_basic_auth()
            return False

        username, _, password = decoded.partition(":")
        if (username, password) != credentials:
            self.request_basic_auth()
            return False

        return True

    def request_basic_auth(self) -> None:
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Lunch UI"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write("Authentication required".encode("utf-8"))

    def respond_html(self, page: str, status: int = 200) -> None:
        encoded = page.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def respond_text(self, text: str, status: int = 200) -> None:
        encoded = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    load_env_file()
    host = os.environ.get("LUNCH_UI_HOST", DEFAULT_HOST)
    port = int(os.environ.get("PORT", os.environ.get("LUNCH_UI_PORT", str(DEFAULT_PORT))))

    server = ThreadingHTTPServer((host, port), LunchUiHandler)

    print(f"Lunch UI running on http://{host}:{port}")
    print(f"Using webhook: {get_webhook_url()}")
    if get_access_token():
        print("Auth mode: access token")
    elif get_basic_auth_credentials():
        print("Auth mode: basic auth")
    else:
        print("Auth mode: none")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
