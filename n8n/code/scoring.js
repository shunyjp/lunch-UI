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
