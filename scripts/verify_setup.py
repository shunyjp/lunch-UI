from __future__ import annotations

from pathlib import Path
from typing import Dict

import psycopg


REQUIRED_ENV_KEYS = [
    "GOOGLE_MAPS_API_KEY",
    "HOTPEPPER_API_KEY",
    "DIFY_API_KEY",
    "DIFY_WORKFLOW_URL",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
]


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


def mask(value: str) -> str:
    if not value:
        return "(empty)"
    if len(value) <= 6:
        return "*" * len(value)
    return value[:3] + "*" * (len(value) - 6) + value[-3:]


def connect_and_report(env: Dict[str, str]) -> None:
    conninfo = (
        f"host={env['POSTGRES_HOST']} "
        f"port={env['POSTGRES_PORT']} "
        f"dbname={env['POSTGRES_DB']} "
        f"user={env['POSTGRES_USER']} "
        f"password={env['POSTGRES_PASSWORD']}"
    )

    table_queries = {
        "shops": "select count(*) from shops",
        "shop_judgements": "select count(*) from shop_judgements",
        "manual_checks": "select count(*) from manual_checks",
        "search_logs": "select count(*) from search_logs",
        "building_keywords": "select count(*) from building_keywords",
    }

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute("select current_database(), current_user, version()")
            db_name, db_user, db_version = cur.fetchone()
            print("DB connection: OK")
            print(f"database: {db_name}")
            print(f"user: {db_user}")
            print(f"version: {db_version.split(',')[0]}")
            print("")

            print("Table counts:")
            for table_name, query in table_queries.items():
                cur.execute(query)
                count = cur.fetchone()[0]
                print(f"- {table_name}: {count}")


def main() -> None:
    env_path = Path(".env")
    if not env_path.exists():
        raise SystemExit(".env not found")

    env = load_env(env_path)

    print("Environment check:")
    missing = []
    for key in REQUIRED_ENV_KEYS:
        value = env.get(key, "")
        if value:
            print(f"- {key}: {mask(value)}")
        else:
            print(f"- {key}: (missing)")
            missing.append(key)

    print("")
    if missing:
        print("Warnings:")
        for key in missing:
            print(f"- {key} is not configured")
        print("")

    connect_and_report(env)


if __name__ == "__main__":
    main()
