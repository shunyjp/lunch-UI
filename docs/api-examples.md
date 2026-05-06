# API 入力例

## ランチ検索

`POST /webhook/lunch-recommendation`

```json
{
  "station_name": "大宮駅",
  "lunch_date": "2026-05-10",
  "lunch_time": "12:00",
  "max_walk_minutes": 10,
  "min_rating": 3.5,
  "prefer_salad_bar": true,
  "avoid_zakkyo_building": true,
  "avoid_independent_store_in_aircon_sensitive_season": true,
  "prefer_large_building": true,
  "exclude_high_stairs_risk": true,
  "output_format": "markdown"
}
```

想定レスポンス:

```json
{
  "station_name": "大宮駅",
  "lunch_date": "2026-05-10",
  "lunch_time": "12:00",
  "output_format": "markdown",
  "rendered_content": "# ランチ推薦結果 ...",
  "result_json": {
    "recommended": [],
    "conditional": [],
    "avoid": []
  }
}
```

## 手動確認登録

`POST /webhook/lunch-manual-check`

```json
{
  "shop_id": "ChIJxxxxxxxxxxxx",
  "building_type": "station_building",
  "floor_text": "3F",
  "stairs_risk": "low",
  "aircon_reliability": "high",
  "manual_note": "駅ビル内、エレベーターあり、空調良好"
}
```

想定レスポンス:

```json
{
  "status": "ok",
  "message": "manual_checks に登録しました",
  "data": {
    "shop_id": "ChIJxxxxxxxxxxxx",
    "building_type": "station_building",
    "floor_text": "3F",
    "stairs_risk": "low",
    "aircon_reliability": "high",
    "manual_note": "駅ビル内、エレベーターあり、空調良好"
  }
}
```
