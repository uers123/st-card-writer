import { isObject } from './value-utils.js';

export function analyzePresetJson(input, fileName = 'preset.json') {
  const errors = [];
  let parsed = input;

  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      return {
        fileName,
        recognizedType: 'unknown',
        valid: false,
        keyCount: 0,
        errors: [`JSON parse failed: ${error.message}`],
        fields: [],
      };
    }
  }

  if (!isObject(parsed)) {
    return {
      fileName,
      recognizedType: 'unknown',
      valid: false,
      keyCount: 0,
      errors: ['Preset must be a JSON object.'],
      fields: [],
    };
  }

  const detectors = [
    detectOpenAiPreset(parsed),
    detectInstructPreset(parsed),
    detectContextPreset(parsed),
    detectSystemPromptPreset(parsed),
  ].filter(Boolean);

  const best = detectors.sort((a, b) => b.keyCount - a.keyCount)[0] || {
    recognizedType: 'unknown',
    keyCount: Object.keys(parsed).length,
    fields: Object.keys(parsed).slice(0, 20),
  };

  if (best.recognizedType === 'unknown') {
    errors.push('Could not recognize OpenAI, Instruct, Context, or System Prompt preset fields.');
  }

  return {
    fileName,
    recognizedType: best.recognizedType,
    valid: errors.length === 0,
    keyCount: best.keyCount,
    errors,
    fields: best.fields,
    preset: parsed,
  };
}

function detectOpenAiPreset(value) {
  const fields = [
    'prompts',
    'prompt_order',
    'assistant_prefill',
    'openai_max_context',
    'wi_format',
    'names_behavior',
  ].filter((key) => key in value);

  if (Array.isArray(value.prompts)) fields.push('prompts[]');
  if (fields.length === 0) return null;

  return {
    recognizedType: 'openai',
    keyCount: fields.length,
    fields,
  };
}

function detectInstructPreset(value) {
  const fields = [
    'input_sequence',
    'output_sequence',
    'system_sequence',
    'stop_sequence',
    'wrap',
    'macro',
    'activation_regex',
  ].filter((key) => key in value);

  if (fields.length === 0) return null;

  return {
    recognizedType: 'instruct',
    keyCount: fields.length,
    fields,
  };
}

function detectContextPreset(value) {
  const fields = [
    'story_string',
    'example_separator',
    'chat_start',
    'use_stop_strings',
    'allow_jailbreak',
    'always_force_name2',
  ].filter((key) => key in value);

  if (fields.length === 0) return null;

  return {
    recognizedType: 'context',
    keyCount: fields.length,
    fields,
  };
}

function detectSystemPromptPreset(value) {
  const fields = ['content', 'prompt', 'system_prompt', 'name'].filter((key) => key in value);
  const hasPromptText = ['content', 'prompt', 'system_prompt'].some((key) => typeof value[key] === 'string' && value[key].trim());
  if (!hasPromptText) return null;

  return {
    recognizedType: 'system_prompt',
    keyCount: fields.length,
    fields,
  };
}
