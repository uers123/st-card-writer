import { normalizeRegexScript, validateRegexScripts } from './regex.js';

export const REQUIRED_V2_FIELDS = Object.freeze([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'alternate_greetings',
  'tags',
  'creator',
  'character_version',
  'extensions',
]);

export function createEmptyCard() {
  return normalizeCard({
    data: {
      name: '',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1.0.0',
      extensions: {},
    },
  });
}

export function normalizeCard(input = {}, regexScripts = undefined) {
  const source = input && typeof input === 'object' ? structuredClone(input) : {};
  const sourceData = source.data && typeof source.data === 'object' ? source.data : source;
  const data = {
    name: text(sourceData.name || source.name),
    description: text(sourceData.description || source.description),
    personality: text(sourceData.personality || source.personality),
    scenario: text(sourceData.scenario || source.scenario),
    first_mes: text(sourceData.first_mes || source.first_mes),
    mes_example: text(sourceData.mes_example || source.mes_example),
    creator_notes: text(sourceData.creator_notes || source.creatorcomment || source.creator_notes),
    system_prompt: text(sourceData.system_prompt),
    post_history_instructions: text(sourceData.post_history_instructions),
    alternate_greetings: toStringArray(sourceData.alternate_greetings),
    tags: toStringArray(sourceData.tags),
    creator: text(sourceData.creator || source.creator),
    character_version: text(sourceData.character_version || '1.0.0'),
    extensions: normalizeExtensions(sourceData.extensions, regexScripts),
  };

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    creatorcomment: data.creator_notes,
    avatar: 'none',
    chat: source.chat || `${data.name || 'Character'} - New Chat`,
    talkativeness: data.extensions.talkativeness,
    fav: false,
    tags: data.tags,
    create_date: source.create_date || new Date().toISOString(),
    data,
  };
}

export function validateCard(input) {
  const errors = [];
  const warnings = [];
  const card = normalizeCard(input);
  const data = card.data;

  if (card.spec !== 'chara_card_v2') errors.push('spec must be chara_card_v2.');
  if (card.spec_version !== '2.0') errors.push('spec_version must be 2.0.');

  for (const field of REQUIRED_V2_FIELDS) {
    if (!Object.hasOwn(data, field)) {
      errors.push(`data.${field} is required.`);
    }
  }

  for (const field of ['alternate_greetings', 'tags']) {
    if (!Array.isArray(data[field])) {
      errors.push(`data.${field} must be an array.`);
    }
  }

  if (!data.extensions || typeof data.extensions !== 'object' || Array.isArray(data.extensions)) {
    errors.push('data.extensions must be an object.');
  }

  for (const field of ['name', 'description', 'first_mes']) {
    if (!String(data[field] || '').trim()) {
      warnings.push(`data.${field} is empty.`);
    }
  }

  const regexValidation = validateRegexScripts(data.extensions.regex_scripts || []);
  if (!regexValidation.valid) {
    errors.push(...regexValidation.errors.map((error) => `data.extensions.${error}`));
  }

  return { valid: errors.length === 0, errors, warnings, card };
}

export function mergeCardPatch(card, patch) {
  return normalizeCard({
    ...card,
    data: {
      ...(card?.data || {}),
      ...(patch?.data || patch || {}),
      extensions: {
        ...(card?.data?.extensions || {}),
        ...(patch?.data?.extensions || patch?.extensions || {}),
      },
    },
  });
}

function normalizeExtensions(extensions = {}, regexScripts) {
  const source = extensions && typeof extensions === 'object' && !Array.isArray(extensions) ? extensions : {};
  const embeddedRegex = regexScripts ?? source.regex_scripts ?? [];
  return {
    ...source,
    talkativeness: Number.isFinite(Number(source.talkativeness)) ? Number(source.talkativeness) : 0.5,
    fav: Boolean(source.fav),
    world: text(source.world),
    depth_prompt: {
      prompt: text(source.depth_prompt?.prompt),
      depth: Number.isFinite(Number(source.depth_prompt?.depth)) ? Number(source.depth_prompt.depth) : 4,
      role: ['system', 'user', 'assistant'].includes(source.depth_prompt?.role) ? source.depth_prompt.role : 'system',
    },
    regex_scripts: Array.isArray(embeddedRegex) ? embeddedRegex.map(normalizeRegexScript) : [],
  };
}

function text(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}
