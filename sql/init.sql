CREATE TABLE IF NOT EXISTS shops (
    shop_id TEXT PRIMARY KEY,
    source TEXT,
    name TEXT NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    google_place_id TEXT,
    hotpepper_id TEXT,
    google_maps_url TEXT,
    rating NUMERIC,
    review_count INTEGER,
    genre TEXT,
    building_name TEXT,
    floor_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shop_judgements (
    id SERIAL PRIMARY KEY,
    shop_id TEXT REFERENCES shops(shop_id),
    lunch_date DATE,
    lunch_time TEXT,
    open_status TEXT,
    non_smoking_status TEXT,
    has_salad_bar BOOLEAN,
    protein_score INTEGER,
    vegetable_score INTEGER,
    low_carb_score INTEGER,
    building_type TEXT,
    stairs_risk TEXT,
    aircon_reliability TEXT,
    confidence NUMERIC,
    reason_json JSONB,
    needs_manual_check_json JSONB,
    total_score INTEGER,
    source_type TEXT DEFAULT 'ai',
    judged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manual_checks (
    id SERIAL PRIMARY KEY,
    shop_id TEXT REFERENCES shops(shop_id),
    building_type TEXT,
    floor_text TEXT,
    stairs_risk TEXT,
    aircon_reliability TEXT,
    manual_note TEXT,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_logs (
    id SERIAL PRIMARY KEY,
    station_name TEXT,
    lunch_date DATE,
    lunch_time TEXT,
    max_walk_minutes INTEGER,
    result_json JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chain_brands (
    id SERIAL PRIMARY KEY,
    brand_name TEXT NOT NULL,
    aircon_reliability TEXT DEFAULT 'high',
    stairs_risk_default TEXT DEFAULT 'low',
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS building_keywords (
    id SERIAL PRIMARY KEY,
    keyword TEXT NOT NULL,
    building_type TEXT NOT NULL,
    aircon_reliability TEXT,
    stairs_risk TEXT,
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_shops_google_place_id
    ON shops (google_place_id);

CREATE INDEX IF NOT EXISTS idx_shops_hotpepper_id
    ON shops (hotpepper_id);

CREATE INDEX IF NOT EXISTS idx_shop_judgements_shop_id_judged_at
    ON shop_judgements (shop_id, judged_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_judgements_lunch_slot
    ON shop_judgements (lunch_date, lunch_time);

CREATE INDEX IF NOT EXISTS idx_manual_checks_shop_id_checked_at
    ON manual_checks (shop_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_logs_station_created_at
    ON search_logs (station_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chain_brands_brand_name
    ON chain_brands (brand_name);

CREATE INDEX IF NOT EXISTS idx_building_keywords_keyword
    ON building_keywords (keyword);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shops_set_updated_at ON shops;
CREATE TRIGGER trg_shops_set_updated_at
BEFORE UPDATE ON shops
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO building_keywords
    (keyword, building_type, aircon_reliability, stairs_risk, note)
VALUES
    ('ルミネ', 'station_building', 'high', 'low', '駅ビル'),
    ('アトレ', 'station_building', 'high', 'low', '駅ビル'),
    ('エキュート', 'station_building', 'high', 'low', '駅ナカ商業施設'),
    ('グランスタ', 'station_building', 'high', 'low', '駅ナカ商業施設'),
    ('高島屋', 'department_store', 'high', 'low', '百貨店'),
    ('伊勢丹', 'department_store', 'high', 'low', '百貨店'),
    ('三越', 'department_store', 'high', 'low', '百貨店'),
    ('西武', 'department_store', 'high', 'low', '百貨店'),
    ('そごう', 'department_store', 'high', 'low', '百貨店'),
    ('イオン', 'large_commercial_facility', 'high', 'low', '大型商業施設'),
    ('ららぽーと', 'large_commercial_facility', 'high', 'low', '大型商業施設'),
    ('パルコ', 'large_commercial_facility', 'high', 'low', '大型商業施設'),
    ('マルイ', 'large_commercial_facility', 'high', 'low', '大型商業施設'),
    ('ホテル', 'hotel', 'high', 'low', 'ホテル内')
ON CONFLICT DO NOTHING;
