const DAY = 24 * 60 * 60;
const YEAR = 365.25 * DAY;

export const PHYSIOLOGY_GROUPS = Object.freeze(['pregnancy', 'injury', 'addiction', 'aging', 'contraception', 'std']);

export const DEFAULT_PHYSIOLOGY_RULES = Object.freeze({
  pregnancy: {
    enabled: true,
    dueDays: 300,
    stages: [
      { days: [0, 90], render: '孕早期，外表变化不明显，可能有妊娠反应。' },
      { days: [90, 180], render: '孕中期，小腹开始隆起。' },
      { days: [180, 270], render: '孕晚期，腹部明显隆起，行动渐缓。' },
      { days: [270, 300], render: '临产期，行动不便，需要准备分娩。' },
    ],
  },
  injury: { enabled: true, healDaysPerLevel: 10, permanentPossible: true, deathSeverity: 4 },
  addiction: { enabled: true, withdrawalDays: 3, levels: 3, effects: { 1: '有轻微依赖倾向。', 2: '依赖影响日常行为。', 3: '戒断症状严重，行为受到明显限制。' } },
  aging: {
    enabled: true,
    bands: [
      { max: 12, label: '幼年' }, { max: 18, label: '少年' }, { max: 30, label: '青年' },
      { max: 50, label: '壮年' }, { max: 65, label: '中年' }, { max: Infinity, label: '老年' },
    ],
    naturalDeathAge: 70,
  },
  contraception: { enabled: true, methods: [] },
  std: { enabled: true, diseases: [] },
});

export function normalizePhysiologyState(value = {}) {
  return {
    pregnancy: value.pregnancy && typeof value.pregnancy === 'object' ? { ...value.pregnancy } : null,
    injury: Array.isArray(value.injury) ? value.injury.map((item) => ({ ...item })) : [],
    addiction: value.addiction && typeof value.addiction === 'object' ? { ...value.addiction } : null,
    aging: value.aging && typeof value.aging === 'object' ? { ...value.aging } : {},
    contraception: Array.isArray(value.contraception) ? value.contraception.map((item) => ({ ...item })) : [],
    disease: Array.isArray(value.disease) ? value.disease.map((item) => ({ ...item })) : [],
    healthLow: value.healthLow === true,
    updatedAt: finite(value.updatedAt, 0),
  };
}

export function normalizePhysiologyRules(overrides = {}) {
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    pregnancy: { ...DEFAULT_PHYSIOLOGY_RULES.pregnancy, ...(source.pregnancy || {}), stages: Array.isArray(source.pregnancy?.stages) ? source.pregnancy.stages : DEFAULT_PHYSIOLOGY_RULES.pregnancy.stages },
    injury: { ...DEFAULT_PHYSIOLOGY_RULES.injury, ...(source.injury || {}) },
    addiction: { ...DEFAULT_PHYSIOLOGY_RULES.addiction, ...(source.addiction || {}), effects: { ...DEFAULT_PHYSIOLOGY_RULES.addiction.effects, ...(source.addiction?.effects || {}) } },
    aging: { ...DEFAULT_PHYSIOLOGY_RULES.aging, ...(source.aging || {}), bands: Array.isArray(source.aging?.bands) ? source.aging.bands : DEFAULT_PHYSIOLOGY_RULES.aging.bands },
    contraception: { ...DEFAULT_PHYSIOLOGY_RULES.contraception, ...(source.contraception || {}), methods: Array.isArray(source.contraception?.methods) ? source.contraception.methods : [] },
    std: { ...DEFAULT_PHYSIOLOGY_RULES.std, ...(source.std || {}), diseases: Array.isArray(source.std?.diseases) ? source.std.diseases : [] },
  };
}

export function advancePhysiology({ state = {}, fromTime = 0, worldTime = 0, rules = {} } = {}) {
  const normalized = normalizePhysiologyState(state);
  const config = normalizePhysiologyRules(rules);
  const now = finite(worldTime, 0);
  const previous = finite(fromTime, normalized.updatedAt || now);
  const elapsedDays = Math.max(0, now - previous) / DAY;
  const events = [];
  const deaths = [];

  if (config.pregnancy.enabled && normalized.pregnancy) {
    const pregnancy = normalized.pregnancy;
    const ageDays = Math.max(0, (now - finite(pregnancy.since, now)) / DAY);
    const dueDays = finite(pregnancy.dueDays, config.pregnancy.dueDays);
    if (ageDays >= dueDays) {
      events.push({ type: 'birth', label: '分娩', fatherId: pregnancy.fatherId || '', at: now, newEntity: true });
      normalized.pregnancy = null;
    }
  }

  if (config.injury.enabled) {
    normalized.injury = normalized.injury.flatMap((injury) => {
      const ageDays = Math.max(0, (now - finite(injury.since, now)) / DAY);
      if (Number(injury.severity) >= Number(config.injury.deathSeverity) && !injury.medicalIntervention) {
        deaths.push({ type: 'death', cause: `未治疗的${injury.name || '致命伤'}`, at: now });
        return [injury];
      }
      if (injury.permanent || injury.severity <= 0) return injury.severity > 0 ? [injury] : [];
      const healed = Math.floor(ageDays / Math.max(1, Number(config.injury.healDaysPerLevel) || 10));
      const severity = Math.max(0, Number(injury.initialSeverity || injury.severity) - healed);
      return severity > 0 ? [{ ...injury, severity, initialSeverity: injury.initialSeverity || injury.severity }] : [];
    });
  }

  if (config.addiction.enabled && normalized.addiction) {
    const lastDose = finite(normalized.addiction.lastDose, now);
    normalized.addiction = { ...normalized.addiction, withdrawal: (now - lastDose) / DAY >= Number(config.addiction.withdrawalDays) };
    if (normalized.addiction.withdrawal) events.push({ type: 'withdrawal', at: now, label: '出现戒断症状' });
  }

  if (config.aging.enabled) {
    const birthEpoch = finite(normalized.aging.birthEpoch, null);
    if (birthEpoch !== null) {
      const age = Math.max(0, (now - birthEpoch) / YEAR);
      const band = config.aging.bands.find((item) => age < Number(item.max)) || config.aging.bands.at(-1);
      normalized.aging = { ...normalized.aging, age: Number(age.toFixed(2)), band: band?.label || '未知年龄段' };
      if (age >= Number(config.aging.naturalDeathAge) && normalized.healthLow) {
        deaths.push({ type: 'death', cause: '高龄且健康状况低下', at: now });
      }
    }
  }

  if (config.contraception.enabled) normalized.contraception = normalized.contraception.filter((item) => finite(item.until, Infinity) > now);

  if (config.std.enabled) {
    normalized.disease = normalized.disease.map((disease) => {
      const ageDays = Math.max(0, (now - finite(disease.since, now)) / DAY);
      const definition = config.std.diseases.find((item) => item.id === disease.stdId || item.name === disease.name);
      const latency = finite(disease.latencyDays, definition?.latencyDays || 0);
      return { ...disease, stage: disease.cured ? 'cured' : ageDays < latency ? 'latent' : (disease.stage === 'chronic' ? 'chronic' : 'symptomatic') };
    });
  }

  normalized.updatedAt = now;
  return { state: normalized, events: dedupeEvents(events), deaths: dedupeDeaths(deaths), elapsedDays };
}

export function renderPhysiology(state = {}, worldTime = 0, rules = {}) {
  const normalized = normalizePhysiologyState(state);
  const config = normalizePhysiologyRules(rules);
  const lines = [];
  if (normalized.pregnancy && config.pregnancy.enabled) {
    const days = Math.max(0, (finite(worldTime, 0) - finite(normalized.pregnancy.since, worldTime)) / DAY);
    const stage = config.pregnancy.stages.find((item) => days >= Number(item.days?.[0] || 0) && days < Number(item.days?.[1] || Infinity));
    lines.push(`怀孕第 ${Math.floor(days)} 天：${stage?.render || '孕期状态'}`);
  }
  if (normalized.injury.length && config.injury.enabled) lines.push(`伤势：${normalized.injury.map((item) => `${item.name || '伤处'}（${item.severity}级）`).join('、')}`);
  if (normalized.addiction && config.addiction.enabled) lines.push(`成瘾：${normalized.addiction.substance || '未知物质'}（${normalized.addiction.level || 1}级${normalized.addiction.withdrawal ? '，戒断中' : ''}）`);
  if (normalized.aging.age !== undefined && config.aging.enabled) lines.push(`年龄：${normalized.aging.age}岁，${normalized.aging.band || '年龄段未知'}`);
  if (normalized.contraception.length && config.contraception.enabled) lines.push(`节育：${normalized.contraception.map((item) => item.method || '已采取措施').join('、')}`);
  if (normalized.disease.length && config.std.enabled) lines.push(`疾病：${normalized.disease.map((item) => `${item.name || item.stdId || '未知病种'}（${item.stage || '观察中'}）`).join('、')}`);
  return lines.join('；') || '暂无特殊生理状态。';
}

export function settleSexualContact({ states = {}, actorIds = [], worldTime = 0, rules = {}, rng = Math.random } = {}) {
  const config = normalizePhysiologyRules(rules);
  const ids = [...new Set(Array.isArray(actorIds) ? actorIds.map(String).filter(Boolean) : [])];
  const result = { pregnancy: [], disease: [], rolls: [] };
  if (ids.length < 2) return result;
  const contraception = ids.flatMap((id) => normalizePhysiologyState(states[id]).contraception);
  const effectiveness = Math.max(0, Math.min(1, contraception.reduce((value, item) => Math.max(value, Number(item.effectiveness) || 0), 0)));
  const pregnancyRoll = Number(rng());
  result.rolls.push({ type: 'pregnancy', value: pregnancyRoll });
  if (config.pregnancy.enabled && pregnancyRoll >= effectiveness) result.pregnancy.push({ carrierId: ids[0], partnerId: ids[1], since: worldTime, due: worldTime + Number(config.pregnancy.dueDays) * DAY });
  for (const sourceId of ids) {
    for (const disease of normalizePhysiologyState(states[sourceId]).disease.filter((item) => item.stage !== 'cured')) {
      const definition = config.std.diseases.find((item) => item.id === disease.stdId || item.name === disease.name);
      const contagion = Number(definition?.contagion ?? disease.contagion ?? 0);
      const roll = Number(rng());
      result.rolls.push({ type: 'disease', sourceId, disease: disease.name || disease.stdId, value: roll });
      if (config.std.enabled && roll < contagion) result.disease.push({ targetIds: ids.filter((id) => id !== sourceId), name: disease.name || disease.stdId, stdId: disease.stdId, since: worldTime, latencyDays: definition?.latencyDays || disease.latencyDays || 0 });
    }
  }
  return result;
}

function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function dedupeEvents(items) { return items.filter((item, index, values) => values.findIndex((other) => other.type === item.type && other.at === item.at) === index); }
function dedupeDeaths(items) { return items.filter((item, index, values) => values.findIndex((other) => other.cause === item.cause && other.at === item.at) === index); }
