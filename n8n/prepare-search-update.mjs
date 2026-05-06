import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowsDir = path.join(root, 'n8n', 'workflows');
const payloadPath = path.join(workflowsDir, 'upload-search-payload.json');
const workflowPath = path.join(workflowsDir, 'workflow-a-lunch-search.json');
const requestPath = path.join(workflowsDir, 'upload-search-request.min.json');

const normalizeInputCode = `
const input = $json.body ?? $json;
const stationName = String(input.station_name ?? '').trim();
const lunchDate = String(input.lunch_date ?? '').trim();
const lunchTime = String(input.lunch_time ?? '').trim();

if (!stationName) {
  throw new Error('station_name is required');
}

if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(lunchDate)) {
  throw new Error('lunch_date must be YYYY-MM-DD');
}

if (!/^\\d{2}:\\d{2}$/.test(lunchTime)) {
  throw new Error('lunch_time must be HH:mm');
}

return [{
  json: {
    station_name: stationName,
    station_query: stationName.endsWith('\\u99c5') ? stationName : stationName + '\\u99c5',
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
  },
}];
`.trimStart();

const searchRawCandidatesCode = `
const config = $json;

function requireEnv(name) {
  const value = $env[name];
  if (!value) {
    throw new Error(name + ' is not configured');
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

  if (joined.includes('\\u7981\\u7159')) return 'non_smoking';
  if (joined.includes('\\u5206\\u7159')) return 'separated_smoking';
  if (joined.includes('\\u55ab\\u7159')) return 'smoking_only';
  return 'unknown';
}

function parseBuildingName(address) {
  const value = String(address ?? '').trim();
  if (!value) return '';
  const parts = value
    .split(/[\\s,\\u3000]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : '';
}

function parseFloorText(address) {
  const match = String(address ?? '').match(/(B?\\d+F|\\u5730\\u4e0b\\d+\\u968e|\\d+\\u968e)/i);
  return match ? match[1] : '';
}

function isChainCandidate(name) {
  if (!name) return false;
  const chainHints = [
    '\\u5927\\u6238\\u5c4b',
    '\\u3084\\u3088\\u3044\\u8ed2',
    '\\u30b5\\u30a4\\u30bc\\u30ea\\u30e4',
    '\\u30ac\\u30b9\\u30c8',
    '\\u30c7\\u30cb\\u30fc\\u30ba',
    '\\u30b8\\u30e7\\u30ca\\u30b5\\u30f3',
    '\\u30ed\\u30a4\\u30e4\\u30eb\\u30db\\u30b9\\u30c8',
    '\\u65e5\\u9ad8\\u5c4b',
    '\\u30ea\\u30f3\\u30ac\\u30fc\\u30cf\\u30c3\\u30c8',
    '\\u677e\\u5c4b',
    '\\u5409\\u91ce\\u5bb6',
    '\\u3059\\u304d\\u5bb6',
    '\\u3066\\u3093\\u3084',
    '\\u30b3\\u30b3\\u30b9',
    '\\u3073\\u3063\\u304f\\u308a\\u30c9\\u30f3\\u30ad\\u30fc',
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
      reason: ['Dify is not configured'],
      needs_manual_check: ['AI judgement unavailable'],
    };
  }

  try {
    const response = await callJson(workflowUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
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
      reason: Array.isArray(output?.reason) ? output.reason : ['AI response was not structured'],
      needs_manual_check: Array.isArray(output?.needs_manual_check) ? output.needs_manual_check : ['AI response was not structured'],
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
      reason: ['Dify error: ' + error.message],
      needs_manual_check: ['AI judgement failed'],
    };
  }
}

const googleMapsApiKey = requireEnv('GOOGLE_MAPS_API_KEY');
const hotpepperApiKey = $env.HOTPEPPER_API_KEY;

const geocode = await callJson(
  'https://maps.googleapis.com/maps/api/geocode/json?' +
    toQuery({
      address: config.station_query + ' \\u65e5\\u672c',
      key: googleMapsApiKey,
    }),
);
ensureGoogleStatus(geocode, ['OK', 'ZERO_RESULTS'], 'Google Geocoding API');

if (!Array.isArray(geocode.results) || geocode.results.length === 0) {
  throw new Error('Station could not be resolved');
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
  let walkText = 'unknown';
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
      walkText = route?.routes?.[0]?.localizedValues?.duration?.text ?? walkMinutes + ' min';
    }
  }

  let hotpepperShop = null;
  if (hotpepperApiKey && placeLat && placeLng) {
    try {
      const hotpepper = await callJson(
        'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?' +
          toQuery({
            key: hotpepperApiKey,
            name: place.displayName?.text ?? candidate.displayName?.text,
            lat: placeLat,
            lng: placeLng,
            range: 2,
            count: 1,
            format: 'json',
          }),
      );
      hotpepperShop = hotpepper?.results?.shop?.[0] ?? null;
    } catch (error) {
      hotpepperShop = {
        catch: 'Hotpepper error: ' + error.message,
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
      google_maps_url: place.googleMapsUri ?? ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(difyInput.shop_name)),
      rating: difyInput.rating,
      review_count: difyInput.review_count,
      genre: difyInput.genre,
      building_name: difyInput.building_name,
      floor_text: difyInput.floor_text,
      is_chain_candidate: difyInput.is_chain_candidate,
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
          const date = new Date(config.lunch_date + 'T00:00:00+09:00');
          const mmdd = String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
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
      max_walk_minutes: config.max_walk_minutes,
      output_format: config.output_format,
      options: {
        ...config,
      },
      rendered_content: 'No candidates found. Please relax the filters or verify the station name.',
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
`.trimStart();

const mergeManualAndScoreCode = `
const AIRCON_SENSITIVE_START = '04-20';
const AIRCON_SENSITIVE_END = '06-10';

function normalizeText(value) {
  return (value || '').toString().trim();
}

function isAirconSensitiveSeason(lunchDate) {
  if (!lunchDate) return false;
  const date = new Date(lunchDate + 'T00:00:00+09:00');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const mmdd = month + '-' + day;
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
  const isChainCandidate = Boolean(shop.is_chain_candidate);
  const airconSensitiveSeason = isAirconSensitiveSeason(options.lunch_date);
  const floorLevel = inferFloorLevel(shop.floor_text);

  let buildingType = shop.building_type || 'unknown';
  let airconReliability = shop.aircon_reliability || 'unknown';
  let stairsRisk = shop.stairs_risk || 'unknown';
  const reasons = Array.isArray(shop.reason_json) ? [...shop.reason_json] : [];

  const keywordMap = [
    { keyword: '\\u30eb\\u30df\\u30cd', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30a2\\u30c8\\u30ec', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30a8\\u30ad\\u30e5\\u30fc\\u30c8', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30b0\\u30e9\\u30f3\\u30b9\\u30bf', buildingType: 'station_building', aircon: 'high', stairs: 'low' },
    { keyword: '\\u9ad8\\u5cf6\\u5c4b', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '\\u4f0a\\u52e2\\u4e39', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '\\u4e09\\u8d8a', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '\\u897f\\u6b66', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '\\u305d\\u3054\\u3046', buildingType: 'department_store', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30a4\\u30aa\\u30f3', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: '\\u3089\\u3089\\u307d\\u30fc\\u3068', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30d1\\u30eb\\u30b3', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30de\\u30eb\\u30a4', buildingType: 'large_commercial_facility', aircon: 'high', stairs: 'low' },
    { keyword: '\\u30db\\u30c6\\u30eb', buildingType: 'hotel', aircon: 'high', stairs: 'low' },
  ];

  const keywordHit = keywordMap.find((item) => buildingName.includes(item.keyword));
  if (keywordHit) {
    buildingType = keywordHit.buildingType;
    airconReliability = keywordHit.aircon;
    stairsRisk = keywordHit.stairs;
    reasons.push('Building keyword matched: ' + keywordHit.keyword);
  }

  if (buildingType === 'unknown' && isChainCandidate && !buildingName) {
    buildingType = 'chain_roadside';
    if (airconReliability === 'unknown') airconReliability = 'medium_high';
    if (stairsRisk === 'unknown') stairsRisk = 'low';
    reasons.push('Chain candidate without building info');
  }

  if (buildingType === 'zakkyo_building' && floorLevel !== null && floorLevel >= 2) {
    stairsRisk = 'high';
    reasons.push('Upper floor in zakkyo building');
  }

  if (buildingType === 'independent_roadside' && airconSensitiveSeason) {
    if (airconReliability === 'unknown' || airconReliability === 'medium') {
      airconReliability = 'low_medium';
    }
    reasons.push('Aircon sensitive season for independent roadside store');
  }

  if (buildingType === 'zakkyo_building' && airconSensitiveSeason) {
    airconReliability = 'low';
    reasons.push('Aircon sensitive season for zakkyo building');
  }

  if (floorLevel !== null && floorLevel >= 2 && stairsRisk === 'unknown') {
    stairsRisk = 'medium';
    reasons.push('Upper floor without elevator evidence');
  }

  return {
    ...shop,
    floor_level: floorLevel,
    building_type: buildingType,
    aircon_reliability: airconReliability,
    stairs_risk: stairsRisk,
    reason_json: reasons,
  };
}

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
    reasons.push('walk_limit_exceeded');
  }

  if (shop.non_smoking_status === 'smoking_only') {
    penalty += 100;
    reasons.push('smoking_only');
  }

  if (shop.open_status === 'closed_or_unknown_strict') {
    penalty += 40;
    reasons.push('open_status_unconfirmed');
  }

  if (shop.stairs_risk === 'high' && (shop.floor_level ?? 0) >= 2) {
    penalty += 50;
    reasons.push('high_stairs_risk_upper_floor');
  }

  if (shop.aircon_reliability === 'low' && options.aircon_sensitive_season) {
    penalty += 40;
    reasons.push('aircon_risk_in_sensitive_season');
  }

  if (toNumber(shop.rating, 0) > 0 && toNumber(shop.rating, 0) < 3.3) {
    penalty += 30;
    reasons.push('low_rating');
  }

  if (shop.building_type === 'zakkyo_building') {
    penalty += 10;
    reasons.push('zakkyo_building');
  }

  return { penalty, reasons };
}

function classify(shop, totalScore, penaltyReasons) {
  if (penaltyReasons.includes('walk_limit_exceeded') || penaltyReasons.includes('smoking_only')) {
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

return sourceItems.map((item) => {
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
      'manual_checks override applied',
    ];
  }

  const enriched = applyBuildingHeuristics(shop, shop.options);
  const options = enriched.options || {};
  const mealScore = computeMealScore(enriched);
  const comfortScore = computeComfortScore(enriched);
  const basicScore = computeBasicScore(enriched, options);
  const { penalty, reasons } = computeRiskPenalty(enriched, options);
  const totalScore = Math.max(0, mealScore + comfortScore + basicScore - penalty);
  const category = classify(enriched, totalScore, reasons);

  return {
    json: {
      ...enriched,
      meal_score: mealScore,
      comfort_score: comfortScore,
      basic_score: basicScore,
      risk_penalty: penalty,
      penalty_reasons: reasons,
      total_score: totalScore,
      category,
    },
  };
});
`.trimStart();

const rankAndRenderCode = `
const itemsIn = $input.all().map((item) => item.json);
const shopItems = itemsIn.filter((item) => item.shop_id);
const summaryItem = itemsIn.find((item) => item.no_candidates_summary) ?? null;

function bulletList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return ['- none'];
  }
  return values.map((value) => '- ' + value);
}

function sectionMarkdown(label, list) {
  if (list.length === 0) {
    return '## ' + label + '\\n\\nNo items';
  }

  return [
    '## ' + label,
    '',
    ...list.map((shop, index) => [
      '### ' + (index + 1) + '. ' + shop.name,
      '',
      '- Score: ' + shop.total_score,
      '- Walk: ' + shop.walk_text,
      '- Rating: ' + (shop.rating ?? 'unknown'),
      '- Open: ' + shop.open_status,
      '- Smoking: ' + shop.non_smoking_status,
      '- Building: ' + shop.building_type,
      '- Aircon: ' + shop.aircon_reliability,
      '- Stairs: ' + shop.stairs_risk,
      '- Salad bar: ' + (shop.has_salad_bar ? 'yes' : 'unknown_or_no'),
      '- Protein score: ' + shop.protein_score,
      '- Vegetable score: ' + shop.vegetable_score,
      '- Low carb score: ' + shop.low_carb_score,
      '- Google Maps: ' + shop.google_maps_url,
      '- Reasons:',
      ...bulletList(shop.reason_json),
      '- Needs manual check:',
      ...bulletList(shop.needs_manual_check_json),
      ...(shop.penalty_reasons?.length ? ['- Risk flags:', ...bulletList(shop.penalty_reasons)] : []),
      '',
    ].join('\\n')),
  ].join('\\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function sectionHtml(label, list) {
  if (list.length === 0) {
    return '<section><h2>' + escapeHtml(label) + '</h2><p>No items</p></section>';
  }

  return (
    '<section><h2>' +
    escapeHtml(label) +
    '</h2>' +
    list
      .map((shop, index) => {
        const reasons = bulletList(shop.reason_json).map((line) => '<li>' + escapeHtml(line.slice(2)) + '</li>').join('');
        const checks = bulletList(shop.needs_manual_check_json).map((line) => '<li>' + escapeHtml(line.slice(2)) + '</li>').join('');
        const penalties = bulletList(shop.penalty_reasons).map((line) => '<li>' + escapeHtml(line.slice(2)) + '</li>').join('');
        return (
          '<article style="border:1px solid #ddd;border-radius:12px;padding:16px;margin-bottom:16px;">' +
          '<h3>' + escapeHtml(String(index + 1) + '. ' + shop.name) + '</h3>' +
          '<ul>' +
          '<li>Score: ' + escapeHtml(shop.total_score) + '</li>' +
          '<li>Walk: ' + escapeHtml(shop.walk_text) + '</li>' +
          '<li>Rating: ' + escapeHtml(shop.rating ?? 'unknown') + '</li>' +
          '<li>Open: ' + escapeHtml(shop.open_status) + '</li>' +
          '<li>Smoking: ' + escapeHtml(shop.non_smoking_status) + '</li>' +
          '<li>Building: ' + escapeHtml(shop.building_type) + '</li>' +
          '<li>Aircon: ' + escapeHtml(shop.aircon_reliability) + '</li>' +
          '<li>Stairs: ' + escapeHtml(shop.stairs_risk) + '</li>' +
          '<li>Salad bar: ' + escapeHtml(shop.has_salad_bar ? 'yes' : 'unknown_or_no') + '</li>' +
          '<li>Protein score: ' + escapeHtml(shop.protein_score) + '</li>' +
          '<li>Vegetable score: ' + escapeHtml(shop.vegetable_score) + '</li>' +
          '<li>Low carb score: ' + escapeHtml(shop.low_carb_score) + '</li>' +
          '<li><a href="' + escapeHtml(shop.google_maps_url) + '">Google Maps</a></li>' +
          '</ul>' +
          '<h4>Reasons</h4><ul>' + reasons + '</ul>' +
          '<h4>Needs manual check</h4><ul>' + checks + '</ul>' +
          (shop.penalty_reasons?.length ? '<h4>Risk flags</h4><ul>' + penalties + '</ul>' : '') +
          '</article>'
        );
      })
      .join('') +
    '</section>'
  );
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
  '# Lunch Recommendation (' + (config.station_name ?? '') + ')',
  '',
  '- Date: ' + (config.lunch_date ?? ''),
  '- Time: ' + (config.lunch_time ?? ''),
  '',
  sectionMarkdown('Recommended', recommended),
  '',
  sectionMarkdown('Conditional', conditional),
  '',
  sectionMarkdown('Avoid', avoid),
].join('\\n');

const html =
  '<html><body style="font-family:sans-serif;line-height:1.6;padding:24px;">' +
  '<h1>Lunch Recommendation</h1>' +
  sectionHtml('Recommended', recommended) +
  sectionHtml('Conditional', conditional) +
  sectionHtml('Avoid', avoid) +
  '</body></html>';

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
`.trimStart();

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
`.trimStart();

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const codeMap = new Map([
  ['Normalize Input', normalizeInputCode],
  ['Search Raw Candidates', searchRawCandidatesCode],
  ['Merge Manual And Score', mergeManualAndScoreCode],
  ['Rank And Render', rankAndRenderCode],
  ['Response Payload', responsePayloadCode],
]);

function patchNodes(nodes) {
  return nodes.map((node) => {
    if (codeMap.has(node.name)) {
      return {
        ...node,
        parameters: {
          ...node.parameters,
          jsCode: codeMap.get(node.name),
        },
      };
    }
    return node;
  });
}

payload.nodes = patchNodes(payload.nodes);
workflow.nodes = patchNodes(workflow.nodes);

const syncedWorkflow = {
  ...workflow,
  name: payload.name ?? workflow.name,
  nodes: payload.nodes,
  connections: payload.connections,
  pinData: payload.pinData ?? workflow.pinData ?? {},
  settings: payload.settings ?? workflow.settings ?? {},
};

fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
fs.writeFileSync(workflowPath, JSON.stringify(syncedWorkflow, null, 2), 'utf8');
fs.writeFileSync(
  requestPath,
  JSON.stringify({
    workflow_id: payload.workflow_id,
    nodes: payload.nodes,
    connections: payload.connections,
  }),
  'utf8',
);

console.log('Prepared clean search workflow payload.');
