import crypto from 'node:crypto';

export const REGEX_PLACEMENTS = Object.freeze({
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
});

const VALID_PLACEMENTS = new Set(Object.values(REGEX_PLACEMENTS));

export function createRegexScript(overrides = {}) {
  return normalizeRegexScript({
    id: crypto.randomUUID(),
    scriptName: 'New Regex Script',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [REGEX_PLACEMENTS.AI_OUTPUT],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    ...overrides,
  });
}

export function normalizeRegexScript(script = {}) {
  return {
    id: typeof script.id === 'string' && script.id ? script.id : crypto.randomUUID(),
    scriptName: String(script.scriptName || 'Untitled Regex Script'),
    findRegex: String(script.findRegex || ''),
    replaceString: String(script.replaceString || ''),
    trimStrings: Array.isArray(script.trimStrings)
      ? script.trimStrings.map(String).filter(Boolean)
      : [],
    placement: Array.isArray(script.placement)
      ? script.placement.map(Number).filter((value) => VALID_PLACEMENTS.has(value))
      : [],
    disabled: Boolean(script.disabled),
    markdownOnly: Boolean(script.markdownOnly),
    promptOnly: Boolean(script.promptOnly),
    runOnEdit: Boolean(script.runOnEdit),
    substituteRegex: [0, 1, 2].includes(Number(script.substituteRegex)) ? Number(script.substituteRegex) : 0,
    minDepth: Number.isFinite(Number(script.minDepth)) ? Number(script.minDepth) : null,
    maxDepth: Number.isFinite(Number(script.maxDepth)) ? Number(script.maxDepth) : null,
  };
}

export function validateRegexScripts(input) {
  const scripts = Array.isArray(input) ? input : input ? [input] : [];
  const errors = [];
  const normalized = scripts.map((script, index) => {
    const normalizedScript = normalizeRegexScript(script);

    if (!normalizedScript.scriptName.trim()) {
      errors.push(`regex[${index}].scriptName is required.`);
    }
    if (!normalizedScript.findRegex.trim()) {
      errors.push(`regex[${index}].findRegex is required.`);
    }
    if (normalizedScript.placement.length === 0) {
      errors.push(`regex[${index}].placement must include at least one valid SillyTavern placement.`);
    }

    const compiled = compileRegex(normalizedScript.findRegex);
    if (!compiled.ok) {
      errors.push(`regex[${index}].findRegex cannot compile: ${compiled.error}`);
    }

    return normalizedScript;
  });

  return { valid: errors.length === 0, errors, normalized };
}

export function compileRegex(value) {
  try {
    const source = String(value || '');
    if (!source) {
      return { ok: false, error: 'empty regex' };
    }

    if (source.startsWith('/')) {
      const lastSlash = source.lastIndexOf('/');
      if (lastSlash > 0) {
        const pattern = source.slice(1, lastSlash);
        const flags = source.slice(lastSlash + 1);
        return { ok: true, regex: new RegExp(pattern, flags) };
      }
    }

    return { ok: true, regex: new RegExp(source, 'g') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function previewRegexScripts(rawText, scriptsInput) {
  const scripts = Array.isArray(scriptsInput) ? scriptsInput.map(normalizeRegexScript) : [];
  let output = String(rawText || '');
  const steps = [];

  for (const script of scripts) {
    const before = output;
    if (script.disabled || !script.findRegex) {
      steps.push({ scriptName: script.scriptName, skipped: true, before, after: before });
      continue;
    }

    const compiled = compileRegex(script.findRegex);
    if (!compiled.ok) {
      steps.push({ scriptName: script.scriptName, error: compiled.error, before, after: before });
      continue;
    }

    output = output.replace(compiled.regex, (...args) => {
      const match = args[0] || '';
      let replacement = script.replaceString.replace(/{{match}}/gi, '$0');
      replacement = replacement.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
        const selected = num ? args[Number(num)] : args.at(-1)?.[groupName];
        return stripTrimStrings(selected || '', script.trimStrings);
      });
      return replacement.replace('$0', stripTrimStrings(match, script.trimStrings));
    });

    steps.push({ scriptName: script.scriptName, before, after: output, changed: before !== output });
  }

  return { input: String(rawText || ''), output, steps };
}

function stripTrimStrings(value, trimStrings) {
  let result = String(value || '');
  for (const trimString of trimStrings) {
    result = result.replaceAll(trimString, '');
  }
  return result;
}
