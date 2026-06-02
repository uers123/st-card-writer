import { normalizeCard, validateCard } from './card.js';
import { createRegexScript, normalizeRegexScript } from './regex.js';

export async function generateCardWithOpenAICompatible({ api, brief, presets = {}, generation = {} }) {
  const baseUrl = String(api?.baseUrl || '').replace(/\/+$/, '');
  const apiKey = String(api?.apiKey || '');
  const model = String(api?.model || '');

  if (!baseUrl || !apiKey || !model) {
    throw new Error('baseUrl, apiKey and model are required.');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: Number(generation.temperature ?? 0.8),
      max_tokens: Number(generation.maxTokens ?? 1800),
      messages: buildMessages(brief, presets),
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Generation API failed with ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  const parsed = parseJsonContent(content);
  const rawCard = parsed.card || parsed.character || parsed;
  const rawRegex = parsed.regexScripts || parsed.regex_scripts || rawCard?.data?.extensions?.regex_scripts || [];
  const regexScripts = Array.isArray(rawRegex)
    ? rawRegex.map(normalizeRegexScript)
    : rawRegex
      ? [normalizeRegexScript(rawRegex)]
      : [createRegexScript({ scriptName: 'Trim Assistant Prefix', findRegex: '/^Assistant:\\s*/i', replaceString: '', placement: [2] })];

  const card = normalizeCard(rawCard, regexScripts);
  const validation = validateCard(card);

  return { card: validation.card, regexScripts, validation };
}

function buildMessages(brief, presets) {
  const presetText = [
    presets.sysprompt?.content,
    presets.context?.story_string,
    presets.instruct?.input_sequence ? `Instruct input: ${presets.instruct.input_sequence}` : '',
    presets.openai?.prompts ? `OpenAI prompts: ${JSON.stringify(presets.openai.prompts).slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n');

  return [
    {
      role: 'system',
      content: [
        'You create SillyTavern TavernCard V2 data.',
        'Return JSON only with keys: card, regexScripts.',
        'card must contain spec "chara_card_v2", spec_version "2.0", and complete data fields.',
        'regexScripts must use SillyTavern regex script objects with placement numbers 1,2,3,5,6.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Preset context:\n${presetText || '(none)'}\n\nCharacter request:\n${brief || 'Create an original roleplay character.'}`,
    },
  ];
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  if (!text) throw new Error('Generation returned empty content.');
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Generation did not contain valid JSON.');
  }
}
