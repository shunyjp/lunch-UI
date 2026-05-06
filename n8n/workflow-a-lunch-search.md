# Workflow A: ランチ検索

## 入力

- `station_name`
- `lunch_date`
- `lunch_time`
- `max_walk_minutes`
- `min_rating`
- `prefer_salad_bar`
- `avoid_zakkyo_building`
- `avoid_independent_store_in_aircon_sensitive_season`
- `prefer_large_building`
- `exclude_high_stairs_risk`
- `output_format`

## 推奨ノード構成

1. `Webhook` または `n8n Form Trigger`
2. `Code`
3. `HTTP Request` for Google Geocoding
4. `Code`
5. `HTTP Request` for Google Places Nearby Search
6. `Split In Batches`
7. `HTTP Request` for Google Place Details
8. `HTTP Request` for Google Directions
9. `HTTP Request` for Hotpepper
10. `Postgres` for `shops` upsert
11. `Postgres` for latest `manual_checks`
12. `Postgres` for latest `shop_judgements`
13. `Code` for heuristic merge
14. `IF` for Dify call required
15. `HTTP Request` for Dify Workflow
16. `Postgres` for `shop_judgements` insert
17. `Code` for scoring
18. `Code` for classification
19. `Code` for Markdown / HTML rendering
20. `Postgres` for `search_logs` insert
21. `Respond to Webhook`

## ノード詳細

### 1. Input Validation

`Code` ノードで次を検証します。

- `station_name` が空でない
- `lunch_date` が妥当な日付
- `lunch_time` が `HH:mm` 形式
- `max_walk_minutes` の既定値は `10`
- `min_rating` の既定値は `3.5`

バリデーションエラー時の返却文言:

```text
駅名を特定できませんでした。駅名に「駅」を付けるか、都道府県名を追加してください。
```

### 2. 駅座標取得

Google Geocoding API で `station_name` を検索し、緯度経度を取得します。

クエリ例:

```text
{station_name} 日本
```

### 3. 候補店取得

Google Places Nearby Search で `restaurant` と `cafe` を対象に検索します。

推奨条件:

- 半径は 1200m 前後
- 最大 20 件
- 評価順ではなく取得後に絞り込む

### 4. 徒歩時間取得

Google Directions API を利用して駅から各店舗への徒歩時間を算出し、`max_walk_minutes` を超える候補を落とします。

### 5. 店舗詳細取得

Place Details では次を優先取得します。

- `name`
- `formatted_address`
- `rating`
- `user_ratings_total`
- `types`
- `url`
- `opening_hours`
- `reviews`
- `editorial_summary`
- `business_status`

### 6. ホットペッパー補完

店舗名と緯度経度近傍で検索し、次を補完します。

- 禁煙 / 分煙
- ランチ営業の記述
- ジャンル
- 予算
- 店舗 URL

### 7. DB 保存

`shops` は `shop_id` を主キーに upsert します。推奨 `shop_id` は `google_place_id` ベースです。

### 8. 手動確認の優先適用

`manual_checks` から `shop_id` ごとの最新レコードを取得し、次を上書きします。

- `building_type`
- `floor_text`
- `stairs_risk`
- `aircon_reliability`

### 9. Dify 呼び出し条件

次のどれかを満たす場合のみ Dify を呼び出します。

- 手動確認がない
- 直近判定が存在しない
- 判定日が古い
- メニューや口コミの情報量が増えた

### 10. スコアリング

`n8n/code/scoring.js` を使います。

出力項目:

- `total_score`
- `category`
- `exclude_reason`

### 11. 出力生成

`output_format=markdown` の場合は Markdown を返し、`html` の場合は簡易 HTML を返します。

区分:

1. `おすすめ`
2. `条件付き候補`
3. `避けた候補`

## SQL の考え方

### `shops` upsert

`INSERT ... ON CONFLICT (shop_id) DO UPDATE`

### 最新手動確認取得

```sql
SELECT DISTINCT ON (shop_id) *
FROM manual_checks
WHERE shop_id = $1
ORDER BY shop_id, checked_at DESC;
```

### 直近 AI 判定取得

```sql
SELECT *
FROM shop_judgements
WHERE shop_id = $1
ORDER BY judged_at DESC
LIMIT 1;
```
