export const TIER_BUDGETS = Object.freeze({ light: 800, medium: 1500, heavy: 3000 });
import { renderPhysiology } from './physiology.js';
import { recallVectors } from './vector.js';

const BLOCK_CAPS = Object.freeze({
  light: { system: 180, player: 100, roster: 180, worldbook: 220, restatement: 140, time: 80, brief: 0 },
  medium: { system: 240, player: 180, roster: 330, worldbook: 360, restatement: 300, time: 150, brief: 180 },
  heavy: { system: 260, player: 300, roster: 620, worldbook: 700, restatement: 620, time: 300, brief: 320 },
});

export const SYSTEM_DECLARATION = '这是一个不围着任何人转的世界。玩家会被拒绝、欺骗、伤害或遗忘；NPC 有自己的生活、欲望、关系与日程。不要替玩家决定行动。';

export function buildInjectionModel({
  entities = [], facts = [], timeline = [], worldbook = [], contextText = '', turnSeq = 0, worldTime = 0, settings = {},
  vectorIndex = null, vectorScores = {}, handoff = '', physiology = {},
} = {}) {
  const tier = TIER_BUDGETS[settings.tier] ? settings.tier : 'medium';
  const caps = BLOCK_CAPS[tier];
  const roster = buildRoster(entities, contextText, caps.roster, physiology, worldTime);
  const recalled = recallWorldbook(worldbook, contextText, tier === 'light' ? 3 : tier === 'heavy' ? 12 : 8, vectorIndex, vectorScores, settings.vectorThreshold);
  const importantFacts = facts
    .filter((fact) => !fact.superseded_by && Number(fact.importance) >= 0.65)
    .sort((a, b) => Number(b.importance) - Number(a.importance) || Number(b.confidence) - Number(a.confidence));
  const restatement = importantFacts
    .filter((fact) => !fact.last_confirmed_at || turnSeq - Number(fact.last_confirmed_at) >= (tier === 'heavy' ? 5 : 10))
    .slice(0, tier === 'light' ? 3 : tier === 'heavy' ? 12 : 8)
    .map((fact) => `- ${fact.content}`)
    .join('\n');
  const recent = [...timeline].sort((a, b) => Number(b.turn_seq) - Number(a.turn_seq)).slice(0, tier === 'light' ? 1 : 3);
  const brief = recent.map((event) => `- ${event.description}`).join('\n');

  const blocks = [
    { key: 'system', priority: 10, text: clip(`【世界运行原则】\n${SYSTEM_DECLARATION}`, caps.system) },
    { key: 'handoff', priority: 11, text: clip(handoff ? `【继任交接】\n${handoff}` : '', caps.system) },
    { key: 'player', priority: 9, text: clip(`【玩家局限】\n玩家不是全知、全能或必然成功的主角。`, caps.player) },
    { key: 'roster', priority: 8, text: clip(roster, caps.roster) },
    { key: 'worldbook', priority: 7, text: clip(formatWorldbook(recalled), caps.worldbook) },
    { key: 'restatement', priority: 7, text: clip(restatement ? `【必须遵守的事实】\n${restatement}` : '', caps.restatement) },
    { key: 'time', priority: 6, text: clip(`【当前世界时间】${formatWorldTime(worldTime)}`, caps.time) },
    { key: 'brief', priority: 4, text: clip(brief ? `【最近世界动态】\n${brief}` : '', caps.brief) },
  ].filter((block) => block.text);

  let remaining = TIER_BUDGETS[tier];
  const trimmed = blocks.map((block) => {
    const text = clip(block.text, remaining * 4);
    remaining = Math.max(0, remaining - estimateTokens(text));
    return { ...block, text };
  }).filter((block) => block.text);

  const textByKey = Object.fromEntries(trimmed.map((block) => [block.key, block.text]));
  return {
    tier,
    blocks: trimmed,
    assembled: {
    top: [textByKey.handoff, textByKey.system, textByKey.player].filter(Boolean).join('\n'),
      mid: [textByKey.roster, textByKey.worldbook, textByKey.time].filter(Boolean).join('\n'),
      bottom: [textByKey.restatement, textByKey.brief].filter(Boolean).join('\n'),
    },
    recalledWorldbook: recalled,
    stats: { budget: TIER_BUDGETS[tier], estimatedTokens: trimmed.reduce((sum, block) => sum + estimateTokens(block.text), 0), blocks: trimmed.length },
  };
}

export function applyInjectionToText(prompt, assembled = {}) {
  const source = String(prompt || '');
  return [assembled.top, source, assembled.mid, assembled.bottom].filter(Boolean).join('\n\n');
}

export function estimateTokens(value) {
  const text = String(value || '');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = text.replace(/[\u3400-\u9fff]/g, '').trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(cjk / 2 + latin / 0.75);
}

function buildRoster(entities, contextText, limit, physiology = {}, worldTime = 0) {
  const lowered = String(contextText || '').toLowerCase();
  const items = [...entities]
    .filter((entity) => entity.status !== 'archived')
    .map((entity) => ({ entity, match: [entity.name, ...(entity.aliases || [])].some((name) => lowered.includes(String(name).toLowerCase())) }))
    .sort((a, b) => Number(b.match) - Number(a.match) || Number(b.entity.salience) - Number(a.entity.salience) || Number(b.entity.importance) - Number(a.entity.importance))
    .slice(0, 30)
    .map(({ entity }) => `- ${entity.name}（${entity.type || 'npc'}${entity.status === 'dormant' ? '，休眠' : ''}）：${entity.current_state || entity.introduction || '状态未知'}${entity.goals?.length ? `；目标：${entity.goals.join('、')}` : ''}${entity.location ? `；地点：${entity.location}` : ''}${physiology[entity.id] ? `；生理：${renderPhysiology(physiology[entity.id], worldTime)}` : ''}`)
    .join('\n');
  return clip(items ? `【当前演员表】\n${items}` : '', limit);
}

function recallWorldbook(entries, contextText, maxEntries, vectorIndex, vectorScores, vectorThreshold = 0.22) {
  const source = String(contextText || '').toLowerCase();
  const lexical = entries.map((entry) => {
    const keys = Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : [];
    const keyword = keys.some((key) => source.includes(String(key).toLowerCase()));
    const score = keyword ? 1 : similarity(entry.content || '', source);
    return { entry, score, source: keyword ? 'keyword' : 'semantic' };
  }).filter((item) => item.score >= (item.source === 'keyword' ? 1 : 0.25));
  const vector = vectorIndex ? recallVectors(vectorIndex, contextText, { threshold: Number(vectorThreshold) || 0.22, limit: maxEntries, precomputedScores: vectorScores }) : [];
  const merged = new Map();
  for (const item of [...lexical, ...vector]) {
    const id = String(item.entry.id ?? item.entry.title ?? item.entry.comment ?? merged.size);
    const prior = merged.get(id);
    if (!prior || item.score > prior.score || item.source === 'keyword') merged.set(id, item);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, maxEntries);
}

function formatWorldbook(items) {
  if (!items.length) return '';
  return `【相关世界书】\n${items.map(({ entry, source }) => `- ${entry.title || entry.comment || '未命名'}（${source}）：${clip(entry.content, 480)}`).join('\n')}`;
}

function similarity(a, b) {
  const left = bigrams(String(a).toLowerCase());
  const right = bigrams(String(b).toLowerCase());
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return overlap / Math.max(left.size, right.size);
}

function bigrams(value) {
  const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function formatWorldTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '未知';
  return `第 ${Math.floor(value / 86400) + 1} 日 ${new Date(value * 1000).toISOString().slice(11, 16)}`;
}

function clip(value, maxTokens) {
  const text = String(value || '').trim();
  if (!text || maxTokens <= 0) return '';
  const maxChars = Math.max(30, Math.floor(maxTokens * 2.2));
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}
