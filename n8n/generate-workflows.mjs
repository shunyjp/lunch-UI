import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const rootDir = process.cwd();
const workflowsDir = path.join(rootDir, 'n8n', 'workflows');

fs.mkdirSync(workflowsDir, { recursive: true });

function id() {
  return crypto.randomUUID();
}

function codeNode(name, jsCode, position) {
  return {
    parameters: {
      jsCode,
    },
    id: id(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function postgresNode(name, query, replacements, position) {
  return {
    parameters: {
      operation: 'executeQuery',
      query,
      options: {
        queryReplacement: replacements,
      },
    },
    id: id(),
    name,
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position,
    alwaysOutputData: true,
  };
}

const normalizeInputCode = `
const input = $json.body ?? $json;
const stationName = String(input.station_name ?? '').trim();
const lunchDate = String(input.lunch_date ?? '').trim();
const lunchTime = String(input.lunch_time ?? '').trim();

if (!stationName) {
  throw new Error('station_name は必須です');
}

if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(lunchDate)) {
  throw new Error('lunch_date は YYYY-MM-DD 形式で指定してください');
}

if (!/^\\d{2}:\\d{2}$/.test(lunchTime)) {
  throw new Error('lunch_time は HH:mm 形式で指定してください');
}

return [{
  json: {
    station_name: stationName,
    station_query: stationName.endsWith('駅') ? stationName : \`\${stationName}駅\`,
    lunch_date: lunchDate,
    lunch_time: lunchTime,
    max_walk_minutes: Number(input.max_walk_minutes ?? 10),
    min_rating: Number(input.min_rating ?? 3.5),
    prefer_salad_bar: input.prefer_salad_bar ?? true,
    avoid_zakkyo_building: input.avoid_zakkyo_building ?? true,
    avoid_independent_store_in_aircon_sensitive_season:
      input.avoid_independent_store_in_aircon_sensitive_season ?? true,
    prefer_large_building: input.prefer_large_building ?? true,
    exclude_high_stairs_risk: input.exclude_high_stairs_risk ?? true,
    output_format: String(input.output_format ?? 'markdown').toLowerCase() === 'html' ? 'html' : 'markdown',
  }
}];
`;

const searchRawCandidatesCode = `
const config = $json;

function requireEnv(name) {
  const value = $env[name];
  if (!value) {
    throw new Error(\`\${name} が未設定です\`);
  }
  return value;
}

function toQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    .join('&');
}

async function callJson(url, options = {}) {
  const requestOptions = {
    url,
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    json: true,
  };

  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      try {
        requestOptions.body = JSON.parse(options.body);
      } catch {
        requestOptions.body = options.body;
        requestOptions.json = false;
      }
    } else {
      requestOptions.body = options.body;
    }
  }

  return await this.helpers.httpRequest(requestOptions);
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function toDifyText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function unwrapDifyOutput(output) {
  if (output && typeof output === 'object' && output.result && typeof output.result === 'string') {
    const rawResult = output.result.trim();
    const fence = String.fromCharCode(96, 96, 96);
    const normalizedResult = rawResult.startsWith(fence)
      ? rawResult
          .replace(new RegExp('^' + fence + '[a-zA-Z0-9_-]*\\\\s*'), '')
          .replace(new RegExp('\\\\s*' + fence + '$'), '')
      : rawResult;
    try {
      return JSON.parse(normalizedResult);
    } catch {
      return output;
    }
  }
  return output;
}

function ensureGoogleStatus(response, allowedStatuses, label) {
  const status = response?.status;
  if (!allowedStatuses.includes(status)) {
    const detail = response?.error_message ? ': ' + response.error_message : '';
    throw new Error(label + ' failed with status ' + (status ?? 'unknown') + detail);
  }
}

function ensureGoogleApiSuccess(response, label) {
  const apiError = response?.error;
  if (apiError) {
    const message = apiError.message ?? apiError.status ?? JSON.stringify(apiError);
    throw new Error(label + ' failed: ' + message);
  }
}

function inferOpeningStatus(details) {
  if (details?.currentOpeningHours?.openNow === true) return 'open_confirmed';
  if (details?.regularOpeningHours?.openNow === true) return 'likely_open';
  if (details?.current_opening_hours?.open_now === true) return 'open_confirmed';
  if (details?.opening_hours?.open_now === true) return 'likely_open';

  const text = JSON.stringify(
    details?.currentOpeningHours ??
    details?.regularOpeningHours ??
    details?.current_opening_hours ??
    details?.opening_hours ??
    {},
  );
  if (text.includes(config.lunch_time)) return 'likely_open';
  return 'unknown';
}

function inferNonSmokingStatus(hotpepperShop, details) {
  const joined = [
    hotpepperShop?.non_smoking,
    hotpepperShop?.catch,
    hotpepperShop?.genre?.name,
    details?.editorialSummary?.overview,
  ]
    .filter(Boolean)
    .join(' ');

  if (/禁煙/.test(joined)) return 'non_smoking';
  if (/分煙/.test(joined)) return 'separated_smoking';
  if (/喫煙可/.test(joined)) return 'smoking_only';
  return 'unknown';
}

function parseBuildingName(address) {
  if (!address) return '';
  const parts = String(address).split(/[、,]/).map((value) => value.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : '';
}

function parseFloorText(address) {
  const match = String(address ?? '').match(/(B?\\d+F|地下\\d+階|\\d+階)/i);
  return match ? match[1] : '';
}

function isChainCandidate(name) {
  if (!name) return false;
  const chainHints = [
    '大戸屋', 'やよい軒', 'サイゼリヤ', 'ガスト', 'デニーズ', 'ジョナサン', 'ロイヤルホスト',
    '日高屋', 'リンガーハット', '松屋', '吉野家', 'すき家', 'てんや', 'ココス', 'びっくりドンキー',
  ];
  return chainHints.some((hint) => String(name).includes(hint));
}

async function runDify(payload) {
  const workflowUrl = $env.DIFY_WORKFLOW_URL;
  const apiKey = $env.DIFY_API_KEY;

  if (!workflowUrl || !apiKey) {
    return {
      has_salad_bar: false,
      protein_score: 0,
      vegetable_score: 0,
      low_carb_score: 0,
      building_type: 'unknown',
      aircon_reliability: 'unknown',
      stairs_risk: 'unknown',
      confidence: 0,
      reason: ['Dify 未設定のため AI 判定をスキップ'],
      needs_manual_check: ['AI 判定未実行'],
    };
  }

  try {
    const response = await callJson(workflowUrl, {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${apiKey}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: payload,
        response_mode: 'blocking',
        user: 'n8n-lunch-recommendation',
      }),
    });

    const output = unwrapDifyOutput(
      response?.data?.outputs ??
      response?.workflow_run?.outputs ??
      response?.outputs ??
      response?.data?.output ??
      response,
    );

    return {
      has_salad_bar: Boolean(output?.has_salad_bar),
      protein_score: Number(output?.protein_score ?? 0),
      vegetable_score: Number(output?.vegetable_score ?? 0),
      low_carb_score: Number(output?.low_carb_score ?? 0),
      building_type: output?.building_type ?? 'unknown',
      aircon_reliability: output?.aircon_reliability ?? 'unknown',
      stairs_risk: output?.stairs_risk ?? 'unknown',
      confidence: Number(output?.confidence ?? 0),
      reason: Array.isArray(output?.reason) ? output.reason : ['AI 判定結果の整形に失敗'],
      needs_manual_check: Array.isArray(output?.needs_manual_check) ? output.needs_manual_check : ['AI 判定結果の整形に失敗'],
    };
  } catch (error) {
    return {
      has_salad_bar: false,
      protein_score: 0,
      vegetable_score: 0,
      low_carb_score: 0,
      building_type: 'unknown',
      aircon_reliability: 'unknown',
      stairs_risk: 'unknown',
      confidence: 0,
      reason: [\`Dify 判定失敗: \${error.message}\`],
      needs_manual_check: ['AI 判定失敗'],
    };
  }
}

const googleMapsApiKey = requireEnv('GOOGLE_MAPS_API_KEY');
const hotpepperApiKey = $env.HOTPEPPER_API_KEY;

const geocode = await callJson(
  \`https://maps.googleapis.com/maps/api/geocode/json?\${toQuery({
    address: \`\${config.station_query} 日本\`,
    key: googleMapsApiKey,
  })}\`,
);
ensureGoogleStatus(geocode, ['OK', 'ZERO_RESULTS'], 'Google Geocoding API');

if (!Array.isArray(geocode.results) || geocode.results.length === 0) {
  throw new Error('駅名を特定できませんでした。駅名に「駅」を付けるか、都道府県名を追加してください。');
}

const station = geocode.results[0];
const stationLat = station.geometry.location.lat;
const stationLng = station.geometry.location.lng;
const radius = Math.min(Math.max(config.max_walk_minutes * 120, 600), 1500);

const nearby = await callJson(
  'https://places.googleapis.com/v1/places:searchNearby',
  {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': googleMapsApiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: 8,
      languageCode: 'ja',
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: {
            latitude: stationLat,
            longitude: stationLng,
          },
          radius,
        },
      },
    }),
  },
);
ensureGoogleApiSuccess(nearby, 'Google Places Nearby Search');

const candidates = (nearby.places ?? [])
  .filter((shop) => Number(shop.rating ?? 0) >= config.min_rating)
  .slice(0, 5);

const outputItems = [];
const startedAt = Date.now();
const timeBudgetMs = 45000;

for (const candidate of candidates) {
  if (Date.now() - startedAt > timeBudgetMs) {
    break;
  }
  const placeId = candidate.id;
  if (!placeId) continue;

  const details = await callJson(
    'https://places.googleapis.com/v1/places/' +
      encodeURIComponent(placeId) +
      '?' +
      toQuery({
        languageCode: 'ja',
      }),
    {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': googleMapsApiKey,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount,googleMapsUri,types,currentOpeningHours,regularOpeningHours,editorialSummary',
      },
    },
  );
  ensureGoogleApiSuccess(details, 'Google Place Details');

  const place = details ?? {};
  const placeLat = place.location?.latitude;
  const placeLng = place.location?.longitude;

  let walkMinutes = 999;
  let walkText = '不明';
  if (placeLat && placeLng) {
    const route = await callJson(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'X-Goog-Api-Key': googleMapsApiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.localizedValues.duration,routes.distanceMeters',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: stationLat,
                longitude: stationLng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: placeLat,
                longitude: placeLng,
              },
            },
          },
          travelMode: 'WALK',
          languageCode: 'ja',
          units: 'METRIC',
        }),
      },
    );
    ensureGoogleApiSuccess(route, 'Google Routes API');

    const durationText = route?.routes?.[0]?.duration ?? null;
    const durationSeconds = durationText ? Number(String(durationText).replace('s', '')) : NaN;
    if (Number.isFinite(durationSeconds)) {
      walkMinutes = Math.ceil(durationSeconds / 60);
      walkText = route?.routes?.[0]?.localizedValues?.duration?.text ?? \`\${walkMinutes}分\`;
    }
  }

  let hotpepperShop = null;
  if (hotpepperApiKey && placeLat && placeLng) {
    try {
      const hotpepper = await callJson(
        \`https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?\${toQuery({
          key: hotpepperApiKey,
          name: place.displayName?.text ?? candidate.displayName?.text,
          lat: placeLat,
          lng: placeLng,
          range: 2,
          count: 1,
          format: 'json',
        })}\`,
      );
      hotpepperShop = hotpepper?.results?.shop?.[0] ?? null;
    } catch (error) {
      hotpepperShop = {
        catch: \`Hotpepper 取得失敗: \${error.message}\`,
      };
    }
  }

  const difyInput = {
    shop_id: toDifyText(place.id ?? placeId),
    shop_name: toDifyText(place.displayName?.text ?? candidate.displayName?.text),
    address: toDifyText(place.formattedAddress ?? candidate.formattedAddress ?? ''),
    building_name: toDifyText(parseBuildingName(place.formattedAddress ?? candidate.formattedAddress ?? '')),
    floor_text: toDifyText(parseFloorText(place.formattedAddress ?? candidate.formattedAddress ?? '')),
    genre: toDifyText(firstNonEmpty(hotpepperShop?.genre?.name, candidate.types?.join(','), '')),
    rating: toDifyText(firstNonEmpty(place.rating, candidate.rating, 0)),
    review_count: toDifyText(firstNonEmpty(place.userRatingCount, candidate.userRatingCount, 0)),
    opening_hours_text: toDifyText(JSON.stringify(place.currentOpeningHours ?? place.regularOpeningHours ?? {})),
    non_smoking_text: toDifyText(firstNonEmpty(hotpepperShop?.non_smoking, '')),
    menu_text: toDifyText(firstNonEmpty(hotpepperShop?.catch, hotpepperShop?.genre?.name, '')),
    reviews_text: toDifyText(firstNonEmpty(place.editorialSummary?.overview, '')),
    is_chain_candidate: toDifyText(isChainCandidate(place.displayName?.text ?? candidate.displayName?.text)),
    lunch_date: toDifyText(config.lunch_date),
    lunch_time: toDifyText(config.lunch_time),
  };

  const difyResult = await runDify(difyInput);

  outputItems.push({
    json: {
      shop_id: difyInput.shop_id,
      source: 'google_places',
      name: difyInput.shop_name,
      address: difyInput.address,
      lat: placeLat ?? candidate.location?.latitude ?? null,
      lng: placeLng ?? candidate.location?.longitude ?? null,
      google_place_id: difyInput.shop_id,
      hotpepper_id: hotpepperShop?.id ?? null,
      google_maps_url: place.googleMapsUri ?? \`https://www.google.com/maps/search/?api=1&query=\${encodeURIComponent(difyInput.shop_name)}\`,
      rating: difyInput.rating,
      review_count: difyInput.review_count,
      genre: difyInput.genre,
      building_name: difyInput.building_name,
      floor_text: difyInput.floor_text,
      open_status: inferOpeningStatus(place),
      non_smoking_status: inferNonSmokingStatus(hotpepperShop, place),
      has_salad_bar: difyResult.has_salad_bar,
      protein_score: difyResult.protein_score,
      vegetable_score: difyResult.vegetable_score,
      low_carb_score: difyResult.low_carb_score,
      building_type: difyResult.building_type,
      stairs_risk: difyResult.stairs_risk,
      aircon_reliability: difyResult.aircon_reliability,
      confidence: difyResult.confidence,
      reason_json: difyResult.reason,
      needs_manual_check_json: difyResult.needs_manual_check,
      walk_minutes: walkMinutes,
      walk_text: walkText,
      lunch_date: config.lunch_date,
      lunch_time: config.lunch_time,
      options: {
        ...config,
        aircon_sensitive_season: (() => {
          const date = new Date(\`\${config.lunch_date}T00:00:00+09:00\`);
          const mmdd = \`\${String(date.getMonth() + 1).padStart(2, '0')}-\${String(date.getDate()).padStart(2, '0')}\`;
          return mmdd >= '04-20' && mmdd <= '06-10';
        })(),
      },
      raw: {
        station,
        candidate,
        place,
        hotpepper: hotpepperShop,
      },
    },
  });
}

if (outputItems.length === 0) {
  return [{
    json: {
      no_candidates_summary: true,
      station_name: config.station_name,
      lunch_date: config.lunch_date,
      lunch_time: config.lunch_time,
      output_format: config.output_format,
      options: {
        ...config,
      },
      rendered_content: '候補店舗を取得できませんでした。検索条件を緩めるか、駅名を詳細化してください。',
      result_json: {
        recommended: [],
        conditional: [],
        avoid: [],
      },
      search_error: null,
    },
  }];
}

return outputItems;
`;

const buildingHeuristicsHelpersCode = `
const AIRCON_SENSITIVE_START = '04-20';
const AIRCON_SENSITIVE_END = '06-10';

function normalizeText(value) {
  return (value || '').toString().trim();
}

function isAirconSensitiveSeason(lunchDate) {
  if (!lunchDate) return false;
  const date = new Date(\`\${lunchDate}T00:00:00+09:00\`);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const mmdd = \`\${month}-\${day}\`;
  return mmdd >= AIRCON_SENSITIVE_START && mmdd <= AIRCON_SENSITIVE_END;
}

function inferFloorLevel(floorText) {
  const text = normalizeText(floorText).toUpperCase();
  const match = text.match(/([0-9]+)\\s*F/);
  if (match) return Number(match[1]);
  if (text.includes('B1')) return -1;
  if (text.includes('B2')) return -2;
  return null;
}

function applyBuildingHeuristics(shop, options = {}) {
  const buildingName = normalizeText(shop.building_name);
  const floorText = normalizeText(shop.floor_text);
  const isChainCandidate = Boolean(shop.is_chain_candidate);
  const airconSensitiveSeason = isAirconSensitiveSeason(options.lunch_date);
  const floorLevel = inferFloorLevel(floorText);

  let buildingType = shop.building_type || 'unknown';
  let airconReliability = shop.aircon_reliability || 'unknown';
  let stairsRisk = shop.stairs_risk || 'unknown';
  const reasons = [];

  const keywordMap = [
    { keyword: 'ルミネ', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: 'アトレ', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: 'エキュート', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: 'グランスタ', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: '高島屋', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '伊勢丹', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '三越', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '西武', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: 'そごう', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: 'イオン', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: 'ららぽーと', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: 'パルコ', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: 'マルイ', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: 'ホテル', buildingType: 'hotel', aircon: 'high', stairs: 'low' },
  ];

  const keywordHit = keywordMap.find((item) => buildingName.includes(item.keyword));
  if (keywordHit) {
    buildingType = keywordHit.buildingType;
    airconReliability = keywordHit.aircon;
    stairsRisk = keywordHit.stairs;
    reasons.push(\`建物名に \${keywordHit.keyword} を含むため補正\`);
  }

  if (buildingType === 'unknown' && isChainCandidate && !buildingName) {
    buildingType = 'chain_roadside';
    if (airconReliability === 'unknown') airconReliability = 'medium_high';
    if (stairsRisk === 'unknown') stairsRisk = 'low';
    reasons.push('チェーン店候補のため路面チェーン寄りに補正');
  }

  if (buildingType === 'zakkyo_building' && floorLevel !== null && floorLevel >= 2) {
    stairsRisk = 'high';
    reasons.push('雑居ビル 2F 以上のため階段リスクを上げた');
  }

  if (buildingType === 'independent_roadside' && airconSensitiveSeason) {
    if (airconReliability === 'unknown' || airconReliability === 'medium') {
      airconReliability = 'low_medium';
    }
    reasons.push('空調不安期間の個人店として空調評価を厳しめにした');
  }

  if (buildingType === 'zakkyo_building' && airconSensitiveSeason) {
    airconReliability = 'low';
    reasons.push('空調不安期間の雑居ビルとして空調評価を低くした');
  }

  if (floorLevel !== null && floorLevel >= 2 && stairsRisk === 'unknown') {
    stairsRisk = 'medium';
    reasons.push('2F 以上だが昇降設備不明のため注意扱い');
  }

  return {
    ...shop,
    floor_level: floorLevel,
    building_type: buildingType,
    aircon_reliability: airconReliability,
    stairs_risk: stairsRisk,
    heuristic_reasons: reasons,
  };
}
`;

const scoringHelpersCode = `
const ratingScoreMap = [
  { min: 4.3, score: 5 },
  { min: 4.0, score: 4 },
  { min: 3.8, score: 3 },
  { min: 3.5, score: 2 },
  { min: 0, score: 0 },
];

const buildingScoreMap = {
  station_building: 10,
  large_commercial_facility: 10,
  department_store: 10,
  office_building: 10,
  hotel: 10,
  chain_roadside: 8,
  independent_roadside: 5,
  basement: 4,
  zakkyo_building: 2,
  unknown: 3,
};

const airconScoreMap = {
  high: 10,
  medium_high: 8,
  medium: 6,
  low_medium: 3,
  low: 0,
  unknown: 4,
};

const stairsScoreMap = {
  low: 10,
  medium: 5,
  high: 0,
  unknown: 4,
};

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getRatingScore(rating) {
  const value = toNumber(rating, 0);
  const match = ratingScoreMap.find((item) => value >= item.min);
  return match ? match.score : 0;
}

function getLunchOpenScore(openStatus) {
  if (openStatus === 'open_confirmed') return 10;
  if (openStatus === 'likely_open') return 7;
  if (openStatus === 'unknown') return 3;
  return 0;
}

function getNonSmokingScore(status) {
  if (status === 'non_smoking') return 7;
  if (status === 'separated_smoking') return 5;
  if (status === 'unknown') return 2;
  return 0;
}

function getWalkScore(walkMinutes, maxWalkMinutes) {
  const walk = toNumber(walkMinutes, 999);
  const max = toNumber(maxWalkMinutes, 10);
  if (walk > max) return 0;
  if (walk <= 5) return 3;
  if (walk <= 8) return 2;
  return 1;
}

function computeMealScore(shop) {
  const salad = shop.has_salad_bar ? 20 : 0;
  const protein = Math.min(toNumber(shop.protein_score, 0), 5) * 2;
  const vegetable = Math.min(toNumber(shop.vegetable_score, 0), 5) * 2;
  const lowCarb = Math.min(toNumber(shop.low_carb_score, 0), 5);
  return salad + protein + vegetable + lowCarb;
}

function computeComfortScore(shop) {
  return (
    (buildingScoreMap[shop.building_type] ?? 3) +
    (airconScoreMap[shop.aircon_reliability] ?? 4) +
    (stairsScoreMap[shop.stairs_risk] ?? 4)
  );
}

function computeBasicScore(shop, options) {
  return (
    getLunchOpenScore(shop.open_status) +
    getNonSmokingScore(shop.non_smoking_status) +
    getRatingScore(shop.rating) +
    getWalkScore(shop.walk_minutes, options.max_walk_minutes)
  );
}

function computeRiskPenalty(shop, options) {
  let penalty = 0;
  const reasons = [];

  if (toNumber(shop.walk_minutes, 999) > toNumber(options.max_walk_minutes, 10)) {
    penalty += 100;
    reasons.push('徒歩上限超過');
  }

  if (shop.non_smoking_status === 'smoking_only') {
    penalty += 100;
    reasons.push('喫煙可のみ');
  }

  if (shop.open_status === 'closed_or_unknown_strict') {
    penalty += 40;
    reasons.push('ランチ営業を確認できない');
  }

  if (shop.stairs_risk === 'high' && (shop.floor_level ?? 0) >= 2) {
    penalty += 50;
    reasons.push('高階段リスク');
  }

  if (shop.aircon_reliability === 'low' && options.aircon_sensitive_season) {
    penalty += 40;
    reasons.push('空調不安期間に空調低評価');
  }

  if (toNumber(shop.rating, 0) > 0 && toNumber(shop.rating, 0) < 3.3) {
    penalty += 30;
    reasons.push('評価が低い');
  }

  if (shop.building_type === 'zakkyo_building') {
    penalty += 10;
    reasons.push('雑居ビル');
  }

  return { penalty, reasons };
}

function classify(shop, totalScore, penaltyReasons) {
  if (penaltyReasons.includes('徒歩上限超過') || penaltyReasons.includes('喫煙可のみ')) {
    return 'avoid';
  }

  if (
    totalScore >= 70 &&
    shop.stairs_risk === 'low' &&
    ['high', 'medium_high'].includes(shop.aircon_reliability) &&
    ['non_smoking', 'separated_smoking'].includes(shop.non_smoking_status) &&
    ['open_confirmed', 'likely_open'].includes(shop.open_status)
  ) {
    return 'recommended';
  }

  if (totalScore >= 45) {
    return 'conditional';
  }

  return 'avoid';
}
`;

const mergeManualAndScoreCode = `
${buildingHeuristicsHelpersCode}

const sourceItems = $('Search Raw Candidates').all();
const manualRows = $input.all();

function normalizeManualRows(rows) {
  const map = new Map();
  for (const rowItem of rows) {
    const row = rowItem.json ?? {};
    if (!row.shop_id) continue;
    map.set(row.shop_id, row);
  }
  return map;
}

const manualMap = normalizeManualRows(manualRows);

const merged = sourceItems.map((item) => {
  const shop = { ...item.json };
  if (!shop.shop_id) {
    return {
      json: {
        ...shop,
        skip_persistence: true,
      },
    };
  }
  const manual = manualMap.get(shop.shop_id);

  if (manual) {
    shop.building_type = manual.building_type || shop.building_type;
    shop.floor_text = manual.floor_text || shop.floor_text;
    shop.stairs_risk = manual.stairs_risk || shop.stairs_risk;
    shop.aircon_reliability = manual.aircon_reliability || shop.aircon_reliability;
    shop.manual_note = manual.manual_note || null;
    shop.reason_json = [
      ...(Array.isArray(shop.reason_json) ? shop.reason_json : []),
      'manual_checks の結果を優先適用',
    ];
  }

  return { json: applyBuildingHeuristics(shop, shop.options) };
});

items = merged;

${scoringHelpersCode}

return items.map((item) => {
  const shop = item.json;
  const options = shop.options || {};
  const mealScore = computeMealScore(shop);
  const comfortScore = computeComfortScore(shop);
  const basicScore = computeBasicScore(shop, options);
  const { penalty, reasons } = computeRiskPenalty(shop, options);
  const totalScore = Math.max(0, mealScore + comfortScore + basicScore - penalty);
  const category = classify(shop, totalScore, reasons);

  item.json = {
    ...shop,
    meal_score: mealScore,
    comfort_score: comfortScore,
    basic_score: basicScore,
    risk_penalty: penalty,
    penalty_reasons: reasons,
    total_score: totalScore,
    category,
  };

  return item;
});
`;

const rankAndRenderCode = `
const itemsIn = $input.all().map((item) => item.json);
const shopItems = itemsIn.filter((item) => item.shop_id);
const summaryItem = itemsIn.find((item) => item.no_candidates_summary) ?? null;

function section(label, list) {
  if (list.length === 0) {
    return \`## \${label}\\n\\n該当なし\\n\`;
  }

  return [
    \`## \${label}\`,
    '',
    ...list.map((shop, index) => [
      \`### \${index + 1}. \${shop.name}\`,
      '',
      \`- 総合スコア: \${shop.total_score}\`,
      \`- 徒歩: \${shop.walk_text}\`,
      \`- 評価: \${shop.rating ?? '不明'}\`,
      \`- 営業: \${shop.open_status}\`,
      \`- 禁煙/分煙: \${shop.non_smoking_status}\`,
      \`- 建物タイプ: \${shop.building_type}\`,
      \`- 空調信頼度: \${shop.aircon_reliability}\`,
      \`- 階段リスク: \${shop.stairs_risk}\`,
      \`- サラダバー: \${shop.has_salad_bar ? 'あり' : '未確認/なし'}\`,
      \`- タンパク質: \${shop.protein_score}\`,
      \`- 野菜: \${shop.vegetable_score}\`,
      \`- 糖質調整: \${shop.low_carb_score}\`,
      \`- Google Maps: \${shop.google_maps_url}\`,
      '- 判定理由:',
      ...((shop.reason_json ?? []).map((reason) => \`  - \${reason}\`)),
      '- 要確認:',
      ...((shop.needs_manual_check_json ?? []).map((reason) => \`  - \${reason}\`)),
      ...(shop.penalty_reasons?.length ? ['- 減点理由:', ...shop.penalty_reasons.map((reason) => \`  - \${reason}\`)] : []),
      '',
    ].join('\\n')),
  ].join('\\n');
}

function toHtml(sections) {
  return \`
  <html>
    <body style="font-family: sans-serif; line-height: 1.6; padding: 24px;">
      <h1>ランチ推薦結果</h1>
      \${sections.map(({ label, list }) => \`
        <section style="margin-bottom: 32px;">
          <h2>\${label}</h2>
          \${list.length === 0 ? '<p>該当なし</p>' : list.map((shop, index) => \`
            <article style="border: 1px solid #ddd; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
              <h3>\${index + 1}. \${shop.name}</h3>
              <ul>
                <li>総合スコア: \${shop.total_score}</li>
                <li>徒歩: \${shop.walk_text}</li>
                <li>評価: \${shop.rating ?? '不明'}</li>
                <li>営業: \${shop.open_status}</li>
                <li>禁煙/分煙: \${shop.non_smoking_status}</li>
                <li>建物タイプ: \${shop.building_type}</li>
                <li>空調信頼度: \${shop.aircon_reliability}</li>
                <li>階段リスク: \${shop.stairs_risk}</li>
                <li>サラダバー: \${shop.has_salad_bar ? 'あり' : '未確認/なし'}</li>
                <li>タンパク質: \${shop.protein_score}</li>
                <li>野菜: \${shop.vegetable_score}</li>
                <li>糖質調整: \${shop.low_carb_score}</li>
                <li><a href="\${shop.google_maps_url}">Google Maps</a></li>
              </ul>
            </article>
          \`).join('')}
        </section>
      \`).join('')}
    </body>
  </html>\`;
}

const recommended = shopItems
  .filter((shop) => shop.category === 'recommended')
  .sort((a, b) => b.total_score - a.total_score)
  .slice(0, 10);

const conditional = shopItems
  .filter((shop) => shop.category === 'conditional')
  .sort((a, b) => b.total_score - a.total_score)
  .slice(0, 10);

const avoid = shopItems
  .filter((shop) => shop.category === 'avoid')
  .sort((a, b) => b.total_score - a.total_score)
  .slice(0, 10);

const config = shopItems[0]?.options ?? summaryItem?.options ?? {};
if (shopItems.length === 0 && summaryItem?.rendered_content) {
  return [{
    json: {
      station_name: summaryItem.station_name ?? null,
      lunch_date: summaryItem.lunch_date ?? null,
      lunch_time: summaryItem.lunch_time ?? null,
      max_walk_minutes: summaryItem.max_walk_minutes ?? config.max_walk_minutes ?? 10,
      output_format: summaryItem.output_format ?? config.output_format ?? 'markdown',
      rendered_content: summaryItem.rendered_content,
      result_json: summaryItem.result_json ?? {
        recommended: [],
        conditional: [],
        avoid: [],
      },
    },
  }];
}
const markdown = [
  \`# ランチ推薦結果 (\${config.station_name ?? ''})\`,
  '',
  \`- 日付: \${config.lunch_date ?? ''}\`,
  \`- 時刻: \${config.lunch_time ?? ''}\`,
  '',
  section('おすすめ', recommended),
  '',
  section('条件付き候補', conditional),
  '',
  section('避けた候補', avoid),
].join('\\n');

const html = toHtml([
  { label: 'おすすめ', list: recommended },
  { label: '条件付き候補', list: conditional },
  { label: '避けた候補', list: avoid },
]);

return [{
  json: {
    station_name: config.station_name ?? null,
    lunch_date: config.lunch_date ?? null,
    lunch_time: config.lunch_time ?? null,
    max_walk_minutes: config.max_walk_minutes ?? 10,
    output_format: config.output_format ?? 'markdown',
    rendered_content: (config.output_format ?? 'markdown') === 'html' ? html : markdown,
    result_json: {
      recommended,
      conditional,
      avoid,
    },
  },
}];
`;

const responsePayloadCode = `
const ranked = $('Rank And Render').first().json;

return [{
  json: {
    station_name: ranked.station_name,
    lunch_date: ranked.lunch_date,
    lunch_time: ranked.lunch_time,
    output_format: ranked.output_format,
    rendered_content: ranked.rendered_content,
    result_json: ranked.result_json,
  },
}];
`;

const manualCheckNormalizeCode = `
const input = $json.body ?? $json;
const allowedBuildingTypes = [
  'station_building',
  'large_commercial_facility',
  'department_store',
  'office_building',
  'hotel',
  'chain_roadside',
  'independent_roadside',
  'zakkyo_building',
  'basement',
  'unknown',
];

const allowedStairsRisk = ['low', 'medium', 'high', 'unknown'];
const allowedAircon = ['high', 'medium_high', 'medium', 'low_medium', 'low', 'unknown'];

const shopId = String(input.shop_id ?? '').trim();
if (!shopId) {
  throw new Error('shop_id は必須です');
}

const buildingType = String(input.building_type ?? 'unknown');
const stairsRisk = String(input.stairs_risk ?? 'unknown');
const airconReliability = String(input.aircon_reliability ?? 'unknown');

if (!allowedBuildingTypes.includes(buildingType)) {
  throw new Error('building_type が不正です');
}

if (!allowedStairsRisk.includes(stairsRisk)) {
  throw new Error('stairs_risk が不正です');
}

if (!allowedAircon.includes(airconReliability)) {
  throw new Error('aircon_reliability が不正です');
}

return [{
  json: {
    shop_id: shopId,
    building_type: buildingType,
    floor_text: String(input.floor_text ?? '').trim(),
    stairs_risk: stairsRisk,
    aircon_reliability: airconReliability,
    manual_note: String(input.manual_note ?? '').trim(),
  },
}];
`;

const manualCheckResponseCode = `
return [{
  json: {
    status: 'ok',
    message: 'manual_checks に登録しました',
    data: $('Normalize Manual Check').first().json,
  },
}];
`;

const workflowA = {
  name: 'LunchRecommendation_Search',
  nodes: [],
  connections: {},
  pinData: {},
  settings: {
    executionOrder: 'v1',
  },
};

const wfAWebhook = {
  parameters: {
    httpMethod: 'POST',
    path: 'lunch-recommendation',
    responseMode: 'lastNode',
    options: {},
  },
  id: id(),
  name: 'Lunch Search Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2.1,
  position: [260, 300],
  webhookId: id(),
};

const wfANormalize = codeNode('Normalize Input', normalizeInputCode, [500, 300]);
const wfASearch = codeNode('Search Raw Candidates', searchRawCandidatesCode, [760, 300]);
const wfAManualChecks = postgresNode(
  'Load Manual Checks',
  `
SELECT shop_id, building_type, floor_text, stairs_risk, aircon_reliability, manual_note
FROM manual_checks
WHERE shop_id = $1
ORDER BY checked_at DESC
LIMIT 1;
  `.trim(),
  '={{ [$json.shop_id] }}',
  [1020, 300],
);

const wfAMerge = codeNode('Merge Manual And Score', mergeManualAndScoreCode, [1280, 300]);
const wfASaveShops = postgresNode(
  'Upsert Shops',
  `
INSERT INTO shops (
  shop_id, source, name, address, lat, lng, google_place_id, hotpepper_id,
  google_maps_url, rating, review_count, genre, building_name, floor_text
) SELECT
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
WHERE $1 IS NOT NULL
ON CONFLICT (shop_id) DO UPDATE SET
  source = EXCLUDED.source,
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  google_place_id = EXCLUDED.google_place_id,
  hotpepper_id = EXCLUDED.hotpepper_id,
  google_maps_url = EXCLUDED.google_maps_url,
  rating = EXCLUDED.rating,
  review_count = EXCLUDED.review_count,
  genre = EXCLUDED.genre,
  building_name = EXCLUDED.building_name,
  floor_text = EXCLUDED.floor_text;
  `.trim(),
  '={{ [$json.shop_id, $json.source, $json.name, $json.address, $json.lat, $json.lng, $json.google_place_id, $json.hotpepper_id, $json.google_maps_url, $json.rating, $json.review_count, $json.genre, $json.building_name, $json.floor_text] }}',
  [1540, 160],
);

const wfASaveJudgements = postgresNode(
  'Insert Judgements',
  `
INSERT INTO shop_judgements (
  shop_id, lunch_date, lunch_time, open_status, non_smoking_status, has_salad_bar,
  protein_score, vegetable_score, low_carb_score, building_type, stairs_risk,
  aircon_reliability, confidence, reason_json, needs_manual_check_json, total_score, source_type
) SELECT
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17
WHERE $1 IS NOT NULL;
  `.trim(),
  '={{ [$json.shop_id, $json.lunch_date, $json.lunch_time, $json.open_status, $json.non_smoking_status, $json.has_salad_bar, $json.protein_score, $json.vegetable_score, $json.low_carb_score, $json.building_type, $json.stairs_risk, $json.aircon_reliability, $json.confidence, JSON.stringify($json.reason_json ?? []), JSON.stringify($json.needs_manual_check_json ?? []), $json.total_score, $json.manual_note ? "manual_override" : "ai"] }}',
  [1540, 440],
);

const wfARank = codeNode('Rank And Render', rankAndRenderCode, [1540, 720]);
const wfASaveLog = postgresNode(
  'Insert Search Log',
  `
INSERT INTO search_logs (
  station_name, lunch_date, lunch_time, max_walk_minutes, result_json
) VALUES (
  $1, $2, $3, $4, $5::jsonb
);
  `.trim(),
  '={{ [$json.station_name, $json.lunch_date, $json.lunch_time, $json.max_walk_minutes, JSON.stringify($json.result_json)] }}',
  [1800, 720],
);
const wfAResponse = codeNode('Response Payload', responsePayloadCode, [2060, 720]);

workflowA.nodes.push(
  wfAWebhook,
  wfANormalize,
  wfASearch,
  wfAManualChecks,
  wfAMerge,
  wfASaveShops,
  wfASaveJudgements,
  wfARank,
  wfASaveLog,
  wfAResponse,
);

workflowA.connections = {
  'Lunch Search Webhook': {
    main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]],
  },
  'Normalize Input': {
    main: [[{ node: 'Search Raw Candidates', type: 'main', index: 0 }]],
  },
  'Search Raw Candidates': {
    main: [[{ node: 'Load Manual Checks', type: 'main', index: 0 }]],
  },
  'Load Manual Checks': {
    main: [[{ node: 'Merge Manual And Score', type: 'main', index: 0 }]],
  },
  'Merge Manual And Score': {
    main: [
      [{ node: 'Upsert Shops', type: 'main', index: 0 }],
      [{ node: 'Insert Judgements', type: 'main', index: 0 }],
      [{ node: 'Rank And Render', type: 'main', index: 0 }],
    ],
  },
  'Rank And Render': {
    main: [[{ node: 'Insert Search Log', type: 'main', index: 0 }]],
  },
  'Insert Search Log': {
    main: [[{ node: 'Response Payload', type: 'main', index: 0 }]],
  },
};

const workflowB = {
  name: 'LunchRecommendation_ManualCheck',
  nodes: [],
  connections: {},
  pinData: {},
  settings: {
    executionOrder: 'v1',
  },
};

const wfBWebhook = {
  parameters: {
    httpMethod: 'POST',
    path: 'lunch-manual-check',
    responseMode: 'lastNode',
    options: {},
  },
  id: id(),
  name: 'Manual Check Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2.1,
  position: [260, 300],
  webhookId: id(),
};

const wfBNormalize = codeNode('Normalize Manual Check', manualCheckNormalizeCode, [520, 300]);
const wfBInsert = postgresNode(
  'Insert Manual Check',
  `
INSERT INTO manual_checks (
  shop_id, building_type, floor_text, stairs_risk, aircon_reliability, manual_note
) VALUES (
  $1, $2, $3, $4, $5, $6
);
  `.trim(),
  '={{ [$json.shop_id, $json.building_type, $json.floor_text, $json.stairs_risk, $json.aircon_reliability, $json.manual_note] }}',
  [780, 300],
);
const wfBResponse = codeNode('Manual Check Response', manualCheckResponseCode, [1040, 300]);

workflowB.nodes.push(wfBWebhook, wfBNormalize, wfBInsert, wfBResponse);
workflowB.connections = {
  'Manual Check Webhook': {
    main: [[{ node: 'Normalize Manual Check', type: 'main', index: 0 }]],
  },
  'Normalize Manual Check': {
    main: [[{ node: 'Insert Manual Check', type: 'main', index: 0 }]],
  },
  'Insert Manual Check': {
    main: [[{ node: 'Manual Check Response', type: 'main', index: 0 }]],
  },
};

fs.writeFileSync(
  path.join(workflowsDir, 'workflow-a-lunch-search.json'),
  JSON.stringify(workflowA, null, 2),
  'utf8',
);

fs.writeFileSync(
  path.join(workflowsDir, 'workflow-b-manual-check.json'),
  JSON.stringify(workflowB, null, 2),
  'utf8',
);

console.log('Generated workflow JSON files.');
