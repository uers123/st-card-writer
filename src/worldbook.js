import { normalizeCard, validateCard } from './card.js';
import { previewRegexScripts, validateRegexScripts } from './regex.js';
import { clamp, estimateTokens, isObject, number, text, toStringArray, uniqueStrings } from './value-utils.js';

export const WORLD_INFO_POSITIONS = Object.freeze({
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
  outlet: 7,
});

const VALID_POSITIONS = new Set(Object.values(WORLD_INFO_POSITIONS));
const POSITION_LABELS = Object.freeze({
  0: 'Before Character',
  1: 'After Character',
  2: 'Author Note Top',
  3: 'Author Note Bottom',
  4: 'At Depth',
  5: 'Example Message Top',
  6: 'Example Message Bottom',
  7: 'Outlet',
});

const DEFAULT_COLORS = ['#58a6ff', '#8b5cf6', '#16a34a', '#f97316', '#dc2626', '#0891b2'];
const DEEP_ROLE_DEFAULTS = Object.freeze({
  enabled: true,
  version: '1.0.0',
  injectionKey: 'st-card-writer-deep-role',
  defaultDepth: 4,
  defaultRole: 'system',
  antiCompliance: true,
  autoSummarize: true,
});

export function createEmptyWorldbook(overrides = {}) {
  return normalizeWorldbook({
    name: '',
    description: '',
    summary: '',
    tags: ['worldbook-card'],
    creator: '',
    version: '1.0.0',
    first_mes: '',
    system_prompt: '',
    post_history_instructions: '',
    entries: [],
    ...overrides,
  });
}

export function normalizeWorldbook(input = {}) {
  const source = extractWorldbookSource(input);
  const entries = rawEntries(source).map((entry, index) => normalizeWorldbookEntry(entry, index));
  const name = text(source.name || source.title || input?.data?.name || input?.name || 'Untitled Worldbook');
  const description = text(source.description || source.summary || input?.data?.description || input?.description);
  const tags = uniqueStrings(['worldbook-card', ...toStringArray(source.tags || input?.data?.tags)]);

  return {
    name,
    description,
    summary: text(source.summary || description),
    tags,
    creator: text(source.creator || input?.data?.creator),
    version: text(source.version || source.character_version || input?.data?.character_version || '1.0.0'),
    first_mes: text(source.first_mes || source.firstMessage || input?.data?.first_mes),
    system_prompt: text(source.system_prompt || source.systemPrompt || input?.data?.system_prompt),
    post_history_instructions: text(source.post_history_instructions || source.postHistoryInstructions || input?.data?.post_history_instructions),
    scanDepth: number(source.scan_depth ?? source.scanDepth, 4),
    tokenBudget: number(source.token_budget ?? source.tokenBudget, 2048),
    recursiveScanning: Boolean(source.recursive_scanning ?? source.recursiveScanning),
    render: normalizeRenderConfig(source.render || source.visual || source.extensions?.st_card_writer?.render),
    storyAugment: normalizeStoryAugmentMetadata(source.storyAugment || source.story_augment || source.extensions?.st_card_writer?.story_augment),
    deepRole: normalizeDeepRoleMetadata(source.deepRole || source.deep_role || source.extensions?.st_card_writer?.deep_role),
    entries,
  };
}

export function normalizeWorldbookEntry(entry = {}, index = 0) {
  const extensions = isObject(entry.extensions) ? entry.extensions : {};
  const stMeta = isObject(extensions.st_card_writer) ? extensions.st_card_writer : {};
  const visualSource = isObject(entry.visual) ? entry.visual : isObject(stMeta.visual) ? stMeta.visual : {};
  const keys = uniqueStrings(toStringArray(entry.keys ?? entry.key ?? entry.keywords ?? entry.primaryKeys));
  const secondaryKeys = uniqueStrings(toStringArray(entry.secondaryKeys ?? entry.secondary_keys ?? entry.keysecondary));
  const constant = Boolean(entry.constant || entry.alwaysActive || entry.triggerLogic === 'constant');
  const selective = Boolean(entry.selective || secondaryKeys.length > 0 || entry.triggerLogic === 'selective');
  const id = number(entry.id ?? entry.uid, index);
  const group = text(entry.group ?? extensions.group ?? stMeta.group ?? 'Core') || 'Core';
  const title = text(entry.title || entry.name || entry.comment || stMeta.title || `Entry ${index + 1}`);
  const position = normalizePosition(entry.position ?? extensions.position);

  return {
    id,
    title,
    keys,
    secondaryKeys,
    triggerLogic: constant ? 'constant' : selective ? 'selective' : 'keyword',
    content: text(entry.content || entry.body || entry.entry),
    position,
    positionLabel: POSITION_LABELS[position] || 'Unknown',
    priority: number(entry.priority ?? entry.order ?? entry.insertion_order, 100 + index),
    group,
    enabled: entry.enabled === undefined ? !Boolean(entry.disable) : Boolean(entry.enabled),
    constant,
    selective,
    selectiveLogic: number(entry.selectiveLogic ?? extensions.selectiveLogic, 0),
    probability: clamp(number(entry.probability ?? extensions.probability, 100), 0, 100),
    useProbability: Boolean(entry.useProbability ?? extensions.useProbability ?? false),
    depth: number(entry.depth ?? extensions.depth, 4),
    role: number(entry.role ?? extensions.role, 0),
    scanDepth: entry.scanDepth ?? extensions.scan_depth ?? null,
    matchWholeWords: nullableBoolean(entry.matchWholeWords ?? extensions.match_whole_words),
    caseSensitive: nullableBoolean(entry.caseSensitive ?? extensions.case_sensitive),
    useGroupScoring: Boolean(entry.useGroupScoring ?? extensions.use_group_scoring ?? false),
    imageUrl: text(entry.imageUrl || visualSource.imageUrl || stMeta.imageUrl),
    placeholder: text(entry.placeholder || visualSource.placeholder || stMeta.placeholder || initials(title)),
    color: normalizeColor(entry.color || visualSource.color || stMeta.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]),
    visualType: text(entry.visualType || visualSource.type || stMeta.visualType || 'panel'),
    visualNote: text(entry.visualNote || visualSource.note || stMeta.visualNote),
    source: normalizeEntrySource(entry.source || stMeta.source),
  };
}

export function normalizeWorldbookPackage(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const worldbook = normalizeWorldbook(source.worldbook || source.worldInfo || source.card || source);
  const rawRegex = source.regexScripts
    || source.regex_scripts
    || source.card?.data?.extensions?.regex_scripts
    || source.card?.data?.extensions?.regexScripts
    || [];
  const regexScripts = validateRegexScripts(rawRegex).normalized;
  const card = source.card
    ? embedWorldbookInCard(source.card, worldbook, regexScripts)
    : createWorldbookCard(worldbook, regexScripts);

  return {
    worldbook,
    card,
    characterBook: card.data.character_book,
    worldInfo: toStandaloneWorldInfo(worldbook),
    regexScripts,
  };
}

export function importWorldbookJson({ content, json, fileName = 'worldbook.json', mode = 'replace', targetWorldbook } = {}) {
  const parsed = parseWorldbookImportInput(content ?? json);
  const source = selectImportSource(parsed);
  const importedPack = normalizeWorldbookPackage(source.input);
  const pack = mode === 'story-augment'
    ? normalizeWorldbookPackage({
      worldbook: mergeStoryAugmentWorldbook({
        targetWorldbook,
        importedWorldbook: importedPack.worldbook,
        fileName,
        sourceType: source.type,
      }),
      regexScripts: importedPack.regexScripts,
    })
    : importedPack;
  const validation = validateWorldbook(pack);

  return {
    ...pack,
    validation,
    importReport: buildImportReport(pack.worldbook, {
      fileName,
      sourceType: source.type,
      mode,
      previousEntryCount: mode === 'story-augment' ? targetEntryCount(targetWorldbook) : 0,
      importedEntryCount: importedPack.worldbook.entries.length,
      appendedEntryCount: mode === 'story-augment' ? importedPack.worldbook.entries.length : 0,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    }),
  };
}

export function createWorldbookCard(worldbookInput = {}, regexScripts = []) {
  const worldbook = normalizeWorldbook(worldbookInput);
  const card = normalizeCard({
    data: {
      name: worldbook.name,
      description: worldbook.description || worldbook.summary || 'A SillyTavern worldbook carrier card.',
      personality: 'Worldbook carrier card. The embedded lorebook entries are the source of truth.',
      scenario: worldbook.summary || worldbook.description,
      first_mes: worldbook.first_mes || `Worldbook "${worldbook.name}" is ready. Import the embedded lorebook or open the viewer extension.`,
      mes_example: '',
      creator_notes: 'Generated by st-card-writer as a worldbook carrier card.',
      system_prompt: worldbook.system_prompt || 'Use the embedded worldbook entries as setting, rules, lore, factions, locations, states, and triggerable facts.',
      post_history_instructions: worldbook.post_history_instructions,
      alternate_greetings: [],
      tags: worldbook.tags,
      creator: worldbook.creator,
      character_version: worldbook.version,
      extensions: {},
    },
  }, regexScripts);

  return embedWorldbookInCard(card, worldbook, regexScripts);
}

export function embedWorldbookInCard(cardInput = {}, worldbookInput = {}, regexScripts = []) {
  const worldbook = normalizeWorldbook(worldbookInput);
  const characterBook = toCharacterBook(worldbook);
  const base = normalizeCard(cardInput, regexScripts);
  const data = {
    ...base.data,
    name: base.data.name || worldbook.name,
    description: base.data.description || worldbook.description || worldbook.summary,
    scenario: base.data.scenario || worldbook.summary,
    first_mes: base.data.first_mes || worldbook.first_mes || `Worldbook "${worldbook.name}" is ready.`,
    system_prompt: base.data.system_prompt || worldbook.system_prompt,
    post_history_instructions: base.data.post_history_instructions || worldbook.post_history_instructions,
    tags: uniqueStrings([...(base.data.tags || []), ...worldbook.tags]),
    creator: base.data.creator || worldbook.creator,
    character_version: base.data.character_version || worldbook.version,
    character_book: characterBook,
    extensions: {
      ...base.data.extensions,
      world: base.data.extensions?.world || worldbook.name,
      regex_scripts: regexScripts,
      st_card_writer: buildStCardWriterMetadata(worldbook),
    },
  };

  return normalizeCard({ ...base, data }, regexScripts);
}

export function toCharacterBook(worldbookInput = {}) {
  const worldbook = normalizeWorldbook(worldbookInput);

  return {
    name: worldbook.name,
    description: worldbook.description,
    scan_depth: worldbook.scanDepth,
    token_budget: worldbook.tokenBudget,
    recursive_scanning: worldbook.recursiveScanning,
    extensions: {
      st_card_writer: buildStCardWriterMetadata(worldbook),
    },
    entries: worldbook.entries.map(toCharacterBookEntry),
  };
}

export function toStandaloneWorldInfo(worldbookInput = {}) {
  const worldbook = normalizeWorldbook(worldbookInput);
  const entries = {};
  worldbook.entries.forEach((entry, index) => {
    entries[String(entry.id)] = toWorldInfoEntry(entry, index);
  });

  return {
    name: worldbook.name,
    description: worldbook.description,
    entries,
    extensions: {
      st_card_writer: buildStCardWriterMetadata(worldbook),
    },
  };
}

export function validateWorldbook(input = {}) {
  const errors = [];
  const warnings = [];
  const pack = normalizeWorldbookPackage(input);
  const { worldbook, card, characterBook, worldInfo } = pack;

  if (!worldbook.name.trim()) warnings.push('worldbook.name is empty.');
  if (!worldbook.description.trim()) warnings.push('worldbook.description is empty.');
  if (!Array.isArray(worldbook.entries)) errors.push('worldbook.entries must be an array.');
  if (!characterBook || !Array.isArray(characterBook.entries)) {
    errors.push('card.data.character_book.entries must be an array.');
  }
  if (!worldInfo || !isObject(worldInfo.entries)) {
    errors.push('standalone World Info JSON must contain entries object.');
  }

  worldbook.entries.forEach((entry, index) => {
    if (!entry.title.trim()) warnings.push(`entries[${index}].title is empty.`);
    if (!entry.content.trim()) errors.push(`entries[${index}].content is required.`);
    if (entry.keys.length === 0 && !entry.constant) {
      warnings.push(`entries[${index}].keys is empty, so the entry will not trigger unless set constant.`);
    }
    if (!VALID_POSITIONS.has(entry.position)) {
      errors.push(`entries[${index}].position must be a SillyTavern World Info position number.`);
    }
  });

  const cardValidation = validateCard(card);
  if (!cardValidation.valid) {
    errors.push(...cardValidation.errors.map((error) => `card.${error}`));
  }
  warnings.push(...cardValidation.warnings.map((warning) => `card.${warning}`));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    worldbook,
    card: cardValidation.card,
    characterBook,
    worldInfo,
  };
}

export function buildWorldbookPreviewModel(input = {}, options = {}) {
  const pack = normalizeWorldbookPackage(input);
  const { worldbook, card, regexScripts } = pack;
  const groups = groupEntries(worldbook.entries);
  const filledEntries = worldbook.entries.filter((entry) => entry.content.trim() && (entry.keys.length || entry.constant)).length;
  const completeFields = [
    worldbook.name,
    worldbook.description,
    worldbook.summary,
    worldbook.entries.length ? 'entries' : '',
  ].filter((value) => String(value || '').trim()).length;

  return {
    theme: options.theme || worldbook.render.theme || 'dark',
    header: {
      name: worldbook.name || 'Untitled Worldbook',
      subtitle: worldbook.description || 'SillyTavern Worldbook Card',
      creator: worldbook.creator,
      version: worldbook.version,
      coverImageUrl: worldbook.render.coverImageUrl,
      accentColor: worldbook.render.accentColor,
    },
    tags: worldbook.tags,
    completion: {
      core: Math.round((completeFields / 4) * 100),
      entries: worldbook.entries.length ? Math.round((filledEntries / worldbook.entries.length) * 100) : 0,
      filledEntries,
      totalEntries: worldbook.entries.length,
    },
    metrics: {
      chars: worldbook.entries.reduce((sum, entry) => sum + entry.content.length, 0),
      estimatedTokens: estimateTokens(worldbook.entries.map((entry) => entry.content).join('\n')),
      groups: groups.length,
      entries: worldbook.entries.length,
      regexCount: regexScripts.length,
    },
    sections: [
      section('summary', 'World Summary', worldbook.summary || worldbook.description),
      section('first_mes', 'Opening Preview', card.data.first_mes),
      section('system_prompt', 'System Prompt', card.data.system_prompt),
      section('post_history_instructions', 'Post-History Instructions', card.data.post_history_instructions),
    ],
    groups,
    entries: worldbook.entries,
    regexScripts,
    regexPreview: previewRegexScripts(options.regexTestText || '', regexScripts),
  };
}

export function normalizeWorldbookPlan(input = {}, brief = '') {
  const source = input.plan && isObject(input.plan) ? input.plan : input;
  const entries = rawEntries(source).map((entry, index) => ({
    title: text(entry.title || entry.name || entry.comment || `Entry ${index + 1}`),
    group: text(entry.group || 'Core') || 'Core',
    purpose: text(entry.purpose || entry.summary || entry.description || entry.content),
    keys: uniqueStrings(toStringArray(entry.keys || entry.key || entry.keywords)),
    visualHint: text(entry.visualHint || entry.visual || entry.imageHint),
  }));

  return {
    worldName: text(source.worldName || source.name || source.title || 'Untitled Worldbook'),
    summary: text(source.summary || source.description || brief),
    style: text(source.style || source.tone),
    groups: uniqueStrings(toStringArray(source.groups).concat(entries.map((entry) => entry.group))).filter(Boolean),
    entries,
    risks: toStringArray(source.risks || source.gaps),
    visualPlan: text(source.visualPlan || source.visual_plan || source.renderPlan),
  };
}

function extractWorldbookSource(input = {}) {
  if (input.worldbook) return input.worldbook;
  if (input.worldInfo) return input.worldInfo;
  if (input.characterBook) return input.characterBook;
  if (input.card?.data?.character_book) return input.card.data.character_book;
  if (input.data?.character_book) return input.data.character_book;
  return input;
}

function parseWorldbookImportInput(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) throw new Error('Imported worldbook JSON is empty.');
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Imported worldbook JSON parse failed: ${error.message}`);
    }
  }
  if (isObject(input)) return input;
  throw new Error('Imported worldbook must be a JSON object or JSON text.');
}

function selectImportSource(parsed) {
  if (parsed.worldbook || parsed.worldInfo || parsed.characterBook || parsed.card) {
    return { type: parsed.worldbook ? 'st_card_writer_package' : 'worldbook_package', input: parsed };
  }

  if (parsed.spec === 'chara_card_v2' || parsed.data?.character_book) {
    return { type: 'tavern_card_v2_character_book', input: { card: parsed } };
  }

  if (isObject(parsed.entries)) {
    return { type: 'sillytavern_world_info', input: { worldInfo: parsed } };
  }

  if (Array.isArray(parsed.entries)) {
    const hasWorldInfoFields = parsed.entries.some((entry) => entry?.key || entry?.keysecondary || entry?.comment || entry?.uid !== undefined);
    return {
      type: hasWorldInfoFields ? 'sillytavern_character_book' : 'worldbook',
      input: hasWorldInfoFields ? { characterBook: parsed } : { worldbook: parsed },
    };
  }

  throw new Error('Imported JSON does not look like a SillyTavern World Info, character_book, or worldbook card.');
}

function buildImportReport(worldbook, { fileName, sourceType, mode = 'replace', previousEntryCount = 0, importedEntryCount = worldbook.entries.length, appendedEntryCount = 0, valid, errors, warnings }) {
  const groups = uniqueStrings(worldbook.entries.map((entry) => entry.group || 'Core'));
  const keywords = uniqueStrings(worldbook.entries.flatMap((entry) => entry.keys || []));
  const enabledCount = worldbook.entries.filter((entry) => entry.enabled).length;

  return {
    fileName,
    sourceType,
    mode,
    valid,
    name: worldbook.name,
    entryCount: worldbook.entries.length,
    previousEntryCount,
    importedEntryCount,
    appendedEntryCount,
    enabledCount,
    disabledCount: worldbook.entries.length - enabledCount,
    groupCount: groups.length,
    groups,
    keywordCount: keywords.length,
    errors,
    warnings,
  };
}

function rawEntries(source = {}) {
  const entries = source.entries || source.items || source.lore || [];
  if (Array.isArray(entries)) return entries;
  if (isObject(entries)) return Object.values(entries);
  return [];
}

function toCharacterBookEntry(entry, index) {
  return {
    id: entry.id,
    keys: entry.keys,
    secondary_keys: entry.secondaryKeys,
    comment: entry.title,
    content: entry.content,
    constant: entry.constant,
    selective: entry.selective,
    insertion_order: entry.priority,
    enabled: entry.enabled,
    position: entry.position === WORLD_INFO_POSITIONS.before ? 'before_char' : 'after_char',
    use_regex: false,
    extensions: exportEntryExtensions(entry, index),
  };
}

function toWorldInfoEntry(entry, index) {
  return {
    uid: entry.id,
    key: entry.keys,
    keysecondary: entry.secondaryKeys,
    comment: entry.title,
    content: entry.content,
    constant: entry.constant,
    selective: entry.selective,
    selectiveLogic: entry.selectiveLogic,
    order: entry.priority,
    position: entry.position,
    disable: !entry.enabled,
    addMemo: Boolean(entry.title),
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    displayIndex: index,
    probability: entry.probability,
    useProbability: entry.useProbability,
    depth: entry.depth,
    role: entry.role,
    group: entry.group,
    groupOverride: false,
    groupWeight: 100,
    scanDepth: entry.scanDepth,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    useGroupScoring: entry.useGroupScoring,
    automationId: '',
    sticky: null,
    cooldown: null,
    delay: null,
    vectorized: false,
    characterFilter: { isExclude: false, names: [], tags: [] },
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    triggers: [],
    ignoreBudget: false,
    extensions: exportEntryExtensions(entry, index),
  };
}

function exportEntryExtensions(entry, index) {
  return {
    position: entry.position,
    display_index: index,
    probability: entry.probability,
    useProbability: entry.useProbability,
    depth: entry.depth,
    selectiveLogic: entry.selectiveLogic,
    group: entry.group,
    scan_depth: entry.scanDepth,
    match_whole_words: entry.matchWholeWords,
    case_sensitive: entry.caseSensitive,
    use_group_scoring: entry.useGroupScoring,
    role: entry.role,
    st_card_writer: {
      title: entry.title,
      group: entry.group,
      source: entry.source || null,
      imageUrl: entry.imageUrl,
      placeholder: entry.placeholder,
      color: entry.color,
      visual: {
        type: entry.visualType,
        imageUrl: entry.imageUrl,
        placeholder: entry.placeholder,
        color: entry.color,
        note: entry.visualNote,
      },
    },
  };
}

function buildStCardWriterMetadata(worldbook) {
  return {
    schema_version: '1.0.0',
    kind: 'worldbook-card',
    generated_by: 'st-card-writer',
    worldName: worldbook.name,
    entryCount: worldbook.entries.length,
    groups: uniqueStrings(worldbook.entries.map((entry) => entry.group)),
    render: {
      theme: worldbook.render.theme,
      accentColor: worldbook.render.accentColor,
      coverImageUrl: worldbook.render.coverImageUrl,
      layout: 'interactive-worldbook',
    },
    story_augment: normalizeStoryAugmentMetadata(worldbook.storyAugment),
    deep_role: normalizeDeepRoleMetadata(worldbook.deepRole),
  };
}

function mergeStoryAugmentWorldbook({ targetWorldbook, importedWorldbook, fileName, sourceType }) {
  const imported = normalizeWorldbook(importedWorldbook);
  const hasTarget = hasMeaningfulWorldbook(targetWorldbook);
  const target = hasTarget
    ? normalizeWorldbook(targetWorldbook)
    : normalizeWorldbook({
      name: imported.name,
      description: imported.description,
      summary: imported.summary,
      tags: imported.tags,
      entries: [],
    });
  const importedAt = new Date().toISOString();
  const nextId = nextEntryId(target.entries);
  const sourceRecord = {
    fileName: text(fileName || 'worldbook.json'),
    sourceType: text(sourceType || 'unknown'),
    importedAt,
    entryCount: imported.entries.length,
  };
  const appendedEntries = imported.entries.map((entry, index) => ({
    ...entry,
    id: nextId + index,
    source: {
      ...sourceRecord,
      originalId: entry.id,
      originalTitle: entry.title,
    },
  }));
  const storyAugment = normalizeStoryAugmentMetadata(target.storyAugment);

  return {
    ...target,
    name: target.name?.trim() ? target.name : imported.name,
    description: target.description?.trim() ? target.description : imported.description,
    summary: target.summary?.trim() ? target.summary : imported.summary,
    tags: uniqueStrings([...(target.tags || []), ...(imported.tags || []), 'story-augment']),
    entries: [...target.entries, ...appendedEntries],
    storyAugment: {
      enabled: true,
      importedEntryCount: storyAugment.importedEntryCount + imported.entries.length,
      sources: [...storyAugment.sources, sourceRecord],
    },
    deepRole: normalizeDeepRoleMetadata({
      ...target.deepRole,
      enabled: true,
      antiCompliance: true,
      autoSummarize: true,
    }),
  };
}

function hasMeaningfulWorldbook(value) {
  if (!isObject(value)) return false;
  const source = extractWorldbookSource(value);
  return rawEntries(source).length > 0
    || Boolean(text(source.name || source.title || value?.data?.name || value?.name).trim())
    || Boolean(text(source.description || source.summary || value?.data?.description || value?.description).trim());
}

function targetEntryCount(value) {
  if (!hasMeaningfulWorldbook(value)) return 0;
  return normalizeWorldbook(value).entries.length;
}

function nextEntryId(entries) {
  return entries.reduce((max, entry) => Math.max(max, number(entry.id, -1)), -1) + 1;
}

function normalizeStoryAugmentMetadata(input = {}) {
  const source = isObject(input) ? input : {};
  const sources = Array.isArray(source.sources)
    ? source.sources.map(normalizeStoryAugmentSource).filter(Boolean)
    : [];
  return {
    enabled: source.enabled !== false,
    importedEntryCount: number(source.importedEntryCount ?? source.imported_entry_count, 0),
    sources,
  };
}

function normalizeStoryAugmentSource(input = {}) {
  if (!isObject(input)) return null;
  return {
    fileName: text(input.fileName || input.file_name || 'worldbook.json'),
    sourceType: text(input.sourceType || input.source_type || 'unknown'),
    importedAt: text(input.importedAt || input.imported_at),
    entryCount: number(input.entryCount || input.entry_count, 0),
  };
}

function normalizeDeepRoleMetadata(input = {}) {
  const source = isObject(input) ? input : {};
  return {
    ...DEEP_ROLE_DEFAULTS,
    ...source,
    enabled: source.enabled !== false,
    defaultDepth: number(source.defaultDepth ?? source.default_depth, DEEP_ROLE_DEFAULTS.defaultDepth),
    antiCompliance: Boolean(source.antiCompliance ?? source.anti_compliance ?? DEEP_ROLE_DEFAULTS.antiCompliance),
    autoSummarize: Boolean(source.autoSummarize ?? source.auto_summarize ?? DEEP_ROLE_DEFAULTS.autoSummarize),
  };
}

function normalizeEntrySource(input = {}) {
  if (!isObject(input)) return null;
  const fileName = text(input.fileName || input.file_name);
  const sourceType = text(input.sourceType || input.source_type);
  const importedAt = text(input.importedAt || input.imported_at);
  if (!fileName && !sourceType && !importedAt && input.originalId === undefined && input.original_id === undefined) return null;
  return {
    fileName,
    sourceType,
    importedAt,
    originalId: input.originalId ?? input.original_id ?? null,
    originalTitle: text(input.originalTitle || input.original_title),
  };
}

function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const groupName = entry.group || 'Core';
    if (!groups.has(groupName)) {
      groups.set(groupName, {
        name: groupName,
        entries: [],
        enabled: 0,
        disabled: 0,
        keywords: new Set(),
      });
    }
    const group = groups.get(groupName);
    group.entries.push(entry);
    if (entry.enabled) group.enabled += 1;
    else group.disabled += 1;
    entry.keys.forEach((key) => group.keywords.add(key));
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    keywords: Array.from(group.keywords),
  }));
}

function section(id, title, content) {
  const value = text(content);
  return {
    id,
    title,
    content: value,
    empty: value.trim().length === 0,
    chars: value.length,
    estimatedTokens: estimateTokens(value),
  };
}

function normalizePosition(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'before_char' || normalized === 'before') return WORLD_INFO_POSITIONS.before;
    if (normalized === 'after_char' || normalized === 'after') return WORLD_INFO_POSITIONS.after;
    if (normalized === 'atdepth' || normalized === 'at_depth') return WORLD_INFO_POSITIONS.atDepth;
    if (normalized === 'antop') return WORLD_INFO_POSITIONS.ANTop;
    if (normalized === 'anbottom') return WORLD_INFO_POSITIONS.ANBottom;
    if (normalized === 'emtop') return WORLD_INFO_POSITIONS.EMTop;
    if (normalized === 'embottom') return WORLD_INFO_POSITIONS.EMBottom;
    if (normalized === 'outlet') return WORLD_INFO_POSITIONS.outlet;
  }

  const numeric = Number(value);
  return VALID_POSITIONS.has(numeric) ? numeric : WORLD_INFO_POSITIONS.before;
}

function normalizeRenderConfig(input = {}) {
  const source = isObject(input) ? input : {};
  return {
    theme: ['dark', 'light', 'contrast'].includes(source.theme) ? source.theme : 'dark',
    accentColor: normalizeColor(source.accentColor || source.color || '#58a6ff'),
    coverImageUrl: text(source.coverImageUrl || source.imageUrl),
  };
}

function nullableBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  return Boolean(value);
}

function normalizeColor(value) {
  const textValue = text(value).trim();
  return /^#[0-9a-f]{6}$/i.test(textValue) ? textValue : '#58a6ff';
}

function initials(value) {
  return text(value).split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join('') || 'WB';
}
