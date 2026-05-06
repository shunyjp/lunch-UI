const AIRCON_SENSITIVE_START = '04-20';
const AIRCON_SENSITIVE_END = '06-10';

function normalizeText(value) {
  return (value || '').toString().trim();
}

function isAirconSensitiveSeason(lunchDate) {
  if (!lunchDate) return false;
  const date = new Date(`${lunchDate}T00:00:00+09:00`);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const mmdd = `${month}-${day}`;
  return mmdd >= AIRCON_SENSITIVE_START && mmdd <= AIRCON_SENSITIVE_END;
}

function inferFloorLevel(floorText) {
  const text = normalizeText(floorText).toUpperCase();
  const match = text.match(/([0-9]+)\s*F/);
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
    reasons.push(`建物名に ${keywordHit.keyword} を含むため補正`);
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
    building_type: buildingType,
    aircon_reliability: airconReliability,
    stairs_risk: stairsRisk,
    heuristic_reasons: reasons,
  };
}

return items.map((item) => {
  item.json = applyBuildingHeuristics(item.json, $json.options || {});
  return item;
});
