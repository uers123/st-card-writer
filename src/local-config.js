import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_ENV_FILE = path.join(PROJECT_ROOT, '.env.local');
let cachedConfig = null;

export function getLocalApiDefaults() {
  if (!cachedConfig) {
    cachedConfig = {
      ...readDotEnvFile(path.join(process.cwd(), LOCAL_ENV_FILE)),
      ...process.env,
    };
  }

  return {
    baseUrl: firstValue(cachedConfig.ST_CARD_WRITER_BASE_URL, cachedConfig.DEEPSEEK_BASE_URL),
    apiKey: firstValue(cachedConfig.ST_CARD_WRITER_API_KEY, cachedConfig.DEEPSEEK_API_KEY),
    model: firstValue(cachedConfig.ST_CARD_WRITER_MODEL, cachedConfig.DEEPSEEK_MODEL),
    temperature: firstValue(cachedConfig.ST_CARD_WRITER_TEMPERATURE),
    maxTokens: firstValue(cachedConfig.ST_CARD_WRITER_MAX_TOKENS),
  };
}

export function withLocalApiDefaults(api = {}) {
  const defaults = getLocalApiDefaults();
  return {
    ...api,
    baseUrl: firstValue(api.baseUrl, api.base_url, defaults.baseUrl),
    apiKey: firstValue(api.apiKey, api.api_key, defaults.apiKey),
    model: firstValue(api.model, defaults.model),
  };
}

export function getSafeLocalConfig() {
  const defaults = getLocalApiDefaults();
  return {
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    temperature: defaults.temperature,
    maxTokens: defaults.maxTokens,
    apiKeyConfigured: Boolean(defaults.apiKey),
  };
}

export function clearLocalConfigCacheForTests() {
  cachedConfig = null;
}

function readDotEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator === -1) return null;
        const key = line.slice(0, separator).trim();
        const value = stripQuotes(line.slice(separator + 1).trim());
        return key ? [key, value] : null;
      })
      .filter(Boolean),
  );
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}
