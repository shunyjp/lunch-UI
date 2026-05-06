# Workflow B: 手動確認登録

## 入力

- `shop_id`
- `building_type`
- `floor_text`
- `stairs_risk`
- `aircon_reliability`
- `manual_note`

## 推奨ノード構成

1. `n8n Form Trigger`
2. `Code` for validation
3. `Postgres` insert into `manual_checks`
4. `Respond to Webhook` or `Form Success`

## 入力チェック

- `shop_id` は必須
- `building_type` は以下のどれか
  - `station_building`
  - `large_commercial_facility`
  - `department_store`
  - `office_building`
  - `hotel`
  - `chain_roadside`
  - `independent_roadside`
  - `zakkyo_building`
  - `basement`
  - `unknown`
- `stairs_risk` は `low` / `medium` / `high` / `unknown`
- `aircon_reliability` は `high` / `medium_high` / `medium` / `low_medium` / `low` / `unknown`

## 登録 SQL

```sql
INSERT INTO manual_checks (
    shop_id,
    building_type,
    floor_text,
    stairs_risk,
    aircon_reliability,
    manual_note
) VALUES (
    $1, $2, $3, $4, $5, $6
);
```

## 運用ルール

- 手動確認は AI 判定より優先
- `manual_note` にはエレベーター有無や商業施設名などを残す
- 同一店舗で複数回確認した場合は最新の `checked_at` を採用
