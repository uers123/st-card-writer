import { normalizeCard, validateCard } from './card.js';
import { createRegexScript, normalizeRegexScript } from './regex.js';
import { normalizeWorldbookPackage, normalizeWorldbookPlan, validateWorldbook } from './worldbook.js';

export async function testOpenAICompatibleConnection({ api = {} }) {
  const baseUrl = String(api.baseUrl || api.base_url || '').replace(/\/+$/, '');
  const apiKey = String(api.apiKey || api.api_key || '');
  const model = String(api.model || '');

  if (!baseUrl) {
    return { ok: false, message: 'base_url is required.', models: [], modelAvailable: false };
  }
  if (!apiKey) {
    return { ok: false, message: 'api_key is required.', models: [], modelAvailable: false };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const modelsResponse = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
    if (modelsResponse.ok) {
      const body = await modelsResponse.json().catch(() => ({}));
      const models = Array.isArray(body.data)
        ? body.data.map((item) => String(item.id || item.name || '')).filter(Boolean)
        : [];
      return {
        ok: true,
        method: 'GET /models',
        message: models.length ? `Connected. Found ${models.length} model(s).` : 'Connected. /models returned no model list.',
        models,
        modelAvailable: model ? models.includes(model) : null,
      };
    }

    if (![404, 405].includes(modelsResponse.status)) {
      const detail = await safeResponseText(modelsResponse);
      return {
        ok: false,
        method: 'GET /models',
        message: `Connection failed with ${modelsResponse.status}: ${redact(detail)}`,
        models: [],
        modelAvailable: false,
      };
    }
  } catch (error) {
    return {
      ok: false,
      method: 'GET /models',
      message: `Connection failed: ${redact(error.message)}`,
      models: [],
      modelAvailable: false,
    };
  }

  if (!model) {
    return {
      ok: false,
      method: 'POST /chat/completions',
      message: '/models is unavailable; model is required for a lightweight chat test.',
      models: [],
      modelAvailable: false,
    };
  }

  try {
    const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (!chatResponse.ok) {
      const detail = await safeResponseText(chatResponse);
      return {
        ok: false,
        method: 'POST /chat/completions',
        message: `Chat test failed with ${chatResponse.status}: ${redact(detail)}`,
        models: [],
        modelAvailable: false,
      };
    }

    return {
      ok: true,
      method: 'POST /chat/completions',
      message: `Connected. Model "${model}" accepted a lightweight chat request.`,
      models: [model],
      modelAvailable: true,
    };
  } catch (error) {
    return {
      ok: false,
      method: 'POST /chat/completions',
      message: `Chat test failed: ${redact(error.message)}`,
      models: [],
      modelAvailable: false,
    };
  }
}

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

export async function generateWorldbookPlan({ api, brief, presets = {}, generation = {} }) {
  const parsed = await callJsonChat({
    api,
    generation,
    messages: buildWorldbookPlanMessages(brief, presets),
    defaultMaxTokens: 1400,
  });
  const plan = normalizeWorldbookPlan(parsed.plan || parsed, brief);
  return { plan };
}

export async function generateWorldbookCard({ api, brief, plan = {}, presets = {}, generation = {} }) {
  const parsed = await callJsonChat({
    api,
    generation,
    messages: buildWorldbookCardMessages(brief, plan, presets),
    defaultMaxTokens: 3200,
  });
  const rawWorldbook = parsed.worldbook || parsed.worldInfo || parsed.character_book || parsed.card?.data?.character_book || parsed;
  const rawRegex = parsed.regexScripts || parsed.regex_scripts || parsed.card?.data?.extensions?.regex_scripts || [];
  const pack = normalizeWorldbookPackage({
    worldbook: rawWorldbook,
    card: parsed.card,
    regexScripts: Array.isArray(rawRegex) ? rawRegex.map(normalizeRegexScript) : rawRegex ? [normalizeRegexScript(rawRegex)] : [],
  });
  const validation = validateWorldbook(pack);

  return {
    worldbook: validation.worldbook,
    card: validation.card,
    worldInfo: validation.worldInfo,
    characterBook: validation.characterBook,
    regexScripts: pack.regexScripts,
    validation,
  };
}

async function callJsonChat({ api = {}, generation = {}, messages, defaultMaxTokens }) {
  const baseUrl = String(api?.baseUrl || api?.base_url || '').replace(/\/+$/, '');
  const apiKey = String(api?.apiKey || api?.api_key || '');
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
      temperature: Number(generation.temperature ?? 0.75),
      max_tokens: Number(generation.maxTokens ?? generation.max_tokens ?? defaultMaxTokens),
      messages,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`Generation API failed with ${response.status}: ${redact(detail).slice(0, 500)}`);
  }

  const body = await response.json();
  return parseJsonContent(body?.choices?.[0]?.message?.content);
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

function buildWorldbookPlanMessages(brief, presets) {
  return [
    {
      role: 'system',
      content: [
        'You design SillyTavern World Info / Lorebook structures.',
        'Return JSON only with key "plan".',
        'plan must include: worldName, summary, style, groups, entries, risks, visualPlan.',
        'Each plan entry must include: title, group, purpose, keys, visualHint.',
        'Do not write the full lore content yet; create a practical outline for the user to review.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Preset context:\n${presetText(presets) || '(none)'}\n\nWorldbook request:\n${brief || 'Create an original roleplay worldbook.'}`,
    },
  ];
}

function buildWorldbookCardMessages(brief, plan, presets) {
  return [
    {
      role: 'system',
      content: [
        'You create SillyTavern worldbook cards.',
        'Return JSON only with keys: worldbook, regexScripts.',
        'worldbook must include name, description, summary, tags, creator, version, first_mes, system_prompt, post_history_instructions, entries.',
        'Each worldbook entry must include title, keys, secondaryKeys, triggerLogic, content, position, priority, group, enabled, imageUrl, placeholder, color.',
        'Use position 0 for before character and 1 for after character unless the request explicitly needs another SillyTavern World Info position number.',
        'regexScripts must use SillyTavern Regex script objects with placement numbers 1,2,3,5,6. Return [] if no regex is needed.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Preset context:\n${presetText(presets) || '(none)'}`,
        `Worldbook request:\n${brief || 'Create an original roleplay worldbook.'}`,
        `Confirmed plan JSON:\n${JSON.stringify(normalizeWorldbookPlan(plan, brief), null, 2)}`,
      ].join('\n\n'),
    },
  ];
}

function presetText(presets) {
  return [
    presets.sysprompt?.content || presets.system_prompt?.content || presets.systemPrompt?.content,
    presets.context?.story_string,
    presets.instruct?.input_sequence ? `Instruct input: ${presets.instruct.input_sequence}` : '',
    presets.openai?.prompts ? `OpenAI prompts: ${JSON.stringify(presets.openai.prompts).slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n');
}

export function parseJsonContent(content) {
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

async function safeResponseText(response) {
  return (await response.text().catch(() => '')).slice(0, 1000);
}

function redact(value) {
  return String(value || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, 'api_key=***');
}
