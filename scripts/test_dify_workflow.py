from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

import requests


def load_env(path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.isidentifier():
            env[key] = value.strip()
    return env


def main() -> None:
    env = load_env(Path(".env"))
    workflow_url = env.get("DIFY_WORKFLOW_URL", "")
    api_key = env.get("DIFY_API_KEY", "")

    if not workflow_url:
        raise SystemExit("DIFY_WORKFLOW_URL is missing in .env")
    if not api_key:
        raise SystemExit("DIFY_API_KEY is missing in .env")

    payload = {
        "inputs": {
            "shop_id": "test-shop-001",
            "shop_name": "サンプル食堂",
            "address": "東京都千代田区丸の内1-1-1 丸の内ビル 3F",
            "building_name": "丸の内ビル",
            "floor_text": "3F",
            "genre": "定食",
            "rating": "4.1",
            "review_count": "128",
            "opening_hours_text": "11:00-15:00, 17:00-22:00",
            "non_smoking_text": "禁煙",
            "menu_text": "鶏のグリル定食、サラダ、雑穀米、ご飯少なめ対応あり",
            "reviews_text": "野菜が多く、ヘルシー。駅ビル内で使いやすい。",
            "is_chain_candidate": "false",
            "lunch_date": "2026-05-10",
            "lunch_time": "12:00",
        },
        "response_mode": "blocking",
        "user": "local-test",
    }

    response = requests.post(
        workflow_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )

    print(f"status_code: {response.status_code}")
    try:
        data = response.json()
    except Exception:
        print(response.text)
        raise SystemExit("Response was not JSON")

    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
