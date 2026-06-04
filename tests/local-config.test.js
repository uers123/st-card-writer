import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLocalConfigCacheForTests, getSafeLocalConfig, withLocalApiDefaults } from '../src/local-config.js';

test('local config merges defaults without exposing API key in safe config', (t) => {
  const originalValues = {
    ST_CARD_WRITER_BASE_URL: process.env.ST_CARD_WRITER_BASE_URL,
    ST_CARD_WRITER_API_KEY: process.env.ST_CARD_WRITER_API_KEY,
    ST_CARD_WRITER_MODEL: process.env.ST_CARD_WRITER_MODEL,
  };

  t.after(() => {
    for (const [key, value] of Object.entries(originalValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearLocalConfigCacheForTests();
  });

  process.env.ST_CARD_WRITER_BASE_URL = 'https://api.example.test/v1';
  process.env.ST_CARD_WRITER_API_KEY = 'secret-token-for-local-test';
  process.env.ST_CARD_WRITER_MODEL = 'local-default-model';
  clearLocalConfigCacheForTests();

  const merged = withLocalApiDefaults({});
  const safe = getSafeLocalConfig();

  assert.equal(merged.baseUrl, 'https://api.example.test/v1');
  assert.equal(merged.apiKey, 'secret-token-for-local-test');
  assert.equal(merged.model, 'local-default-model');
  assert.equal(safe.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(safe, 'apiKey'), false);
});
