import { normalizeCard } from './card.js';
import { previewRegexScripts } from './regex.js';

const FIELD_MAP = [
  ['description', 'Description'],
  ['personality', 'Personality'],
  ['scenario', 'Scenario'],
  ['first_mes', 'First Message'],
  ['mes_example', 'Example Dialogue'],
  ['system_prompt', 'System Prompt'],
  ['post_history_instructions', 'Post-History Instructions'],
  ['creator_notes', 'Creator Notes'],
];

export function buildPreviewModel(cardInput, options = {}) {
  const card = normalizeCard(cardInput);
  const data = card.data;
  const sections = FIELD_MAP.map(([field, title]) => {
    const content = String(data[field] || '');
    return {
      id: field,
      title,
      content,
      empty: content.trim().length === 0,
      chars: content.length,
      words: countWords(content),
    };
  });

  const requiredComplete = ['name', 'description', 'first_mes'].filter((field) => String(data[field] || '').trim()).length;
  const allComplete = FIELD_MAP.filter(([field]) => String(data[field] || '').trim()).length;
  const regexScripts = data.extensions.regex_scripts || [];
  const regexPreview = previewRegexScripts(options.regexTestText || '', regexScripts);

  return {
    theme: options.theme || 'dark',
    header: {
      name: data.name || 'Untitled Character',
      subtitle: data.creator ? `by ${data.creator}` : 'SillyTavern TavernCard V2',
      version: data.character_version || '1.0.0',
    },
    tags: data.tags,
    completion: {
      required: Math.round((requiredComplete / 3) * 100),
      overall: Math.round((allComplete / FIELD_MAP.length) * 100),
      filledSections: allComplete,
      totalSections: FIELD_MAP.length,
    },
    metrics: {
      chars: sections.reduce((sum, section) => sum + section.chars, 0),
      words: sections.reduce((sum, section) => sum + section.words, 0),
      estimatedTokens: estimateTokens(sections.map((section) => section.content).join('\n')),
      regexCount: regexScripts.length,
      greetingCount: 1 + data.alternate_greetings.length,
    },
    sections,
    firstMessage: data.first_mes,
    alternateGreetings: data.alternate_greetings,
    regexScripts,
    regexPreview,
  };
}

function countWords(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length || 0;
  const latin = text.replace(/[\u3400-\u9fff]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}

function estimateTokens(value) {
  return Math.ceil(String(value || '').length / 3.5);
}
