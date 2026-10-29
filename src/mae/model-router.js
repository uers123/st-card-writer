import { getLocalApiDefaults, withLocalApiDefaults } from '../local-config.js';

export const MODEL_SLOTS = Object.freeze(['main', 'extract', 'audit_A', 'audit_B', 'tick', 'gaiden']);

export class ModelRouter {
  constructor({ defaultApi = getLocalApiDefaults(), routes = {}, fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.defaultApi = sanitizeApi(defaultApi);
    this.routes = normalizeRoutes(routes);
  }

  getRoutes() { return { default: safeApi(this.defaultApi), slots: Object.fromEntries(MODEL_SLOTS.map((slot) => [slot, safeRoute(this.routes[slot])])) }; }

  getRawRoutes() { return { default: { ...this.defaultApi }, slots: Object.fromEntries(MODEL_SLOTS.map((slot) => [slot, { ...this.routes[slot] }])) }; }

  setRoutes({ defaultApi, slots } = {}) {
    if (defaultApi) this.defaultApi = sanitizeApi({ ...this.defaultApi, ...defaultApi });
    if (slots && typeof slots === 'object') {
      const merged = { ...this.routes };
      for (const [slot, patch] of Object.entries(slots)) merged[slot] = { ...(this.routes[slot] || {}), ...(patch || {}) };
      this.routes = normalizeRoutes(merged);
    }
    return this.getRoutes();
  }

  resolve(slot = 'main') {
    const route = this.routes[slot] || {};
    if (route.followMain !== false && slot !== 'main') return { ...this.resolve('main'), slot };
    return { ...this.defaultApi, ...sanitizeApi(route), slot };
  }

  isConfigured(slot = 'main') {
    const api = this.resolve(slot);
    return Boolean(api.baseUrl && api.apiKey && api.model);
  }

  async json(slot, messages, options = {}) {
    const result = await this.call(slot, messages, { ...options, json: true });
    return result.json;
  }

  async call(slot, messages, { maxTokens = 800, temperature = 0.2, timeoutMs = 45000, json = false, retries = 2 } = {}) {
    const api = this.resolve(slot);
    if (!api.baseUrl || !api.apiKey || !api.model) throw new Error(`模型槽 ${slot} 未配置完整的 base_url、api_key 或 model。`);
    const url = `${String(api.baseUrl).replace(/\/+$/u, '')}/chat/completions`;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetch(url, {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${api.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: api.model, temperature, max_tokens: maxTokens, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(`模型槽 ${slot} 请求失败：${response.status}`);
          if (!retryable(response.status) || attempt >= retries) throw error;
          lastError = error;
          continue;
        }
        const content = body?.choices?.[0]?.message?.content ?? '';
        return { slot, model: api.model, content, json: json ? parseJson(content) : null, usage: body.usage || null };
      } catch (error) {
        lastError = error?.name === 'AbortError' ? new Error(`模型槽 ${slot} 请求超时。`) : error;
        if (attempt >= retries || (error?.name === 'AbortError')) throw lastError;
      } finally { clearTimeout(timer); }
    }
    throw lastError || new Error(`模型槽 ${slot} 请求失败。`);
  }
}

export function createDefaultModelRouter(options = {}) { return new ModelRouter(options); }

function normalizeRoutes(routes = {}) {
  return Object.fromEntries(MODEL_SLOTS.map((slot) => [slot, { followMain: slot !== 'main', ...(routes[slot] || {}) }]));
}
function sanitizeApi(value = {}) { const api = withLocalApiDefaults(value); return { baseUrl: String(api.baseUrl || ''), apiKey: String(api.apiKey || ''), model: String(api.model || ''), temperature: api.temperature, maxTokens: api.maxTokens }; }
function safeApi(api = {}) { return { baseUrl: api.baseUrl || '', model: api.model || '', apiKeyConfigured: Boolean(api.apiKey) }; }
function safeRoute(route = {}) { return { followMain: route.followMain !== false, baseUrl: route.baseUrl || '', model: route.model || '', apiKeyConfigured: Boolean(route.apiKey) }; }
function retryable(status) { return status === 408 || status === 429 || status >= 500; }
function parseJson(content) { try { return JSON.parse(String(content || '{}')); } catch { const match = String(content || '').match(/\{[\s\S]*\}/u); return match ? JSON.parse(match[0]) : {}; } }
