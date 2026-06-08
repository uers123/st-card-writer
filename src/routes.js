import express from 'express';
import { createEmptyCard, normalizeCard, validateCard } from './card.js';
import { getSafeLocalConfig } from './local-config.js';
import { analyzePresetJson } from './presets.js';
import {
  generateCardWithOpenAICompatible,
  generateWorldbookCard,
  generateWorldbookPlan,
  refineWorldbookWithOpenAICompatible,
  testOpenAICompatibleConnection,
} from './openai.js';
import { buildPreviewModel } from './render.js';
import { normalizeRegexScript, previewRegexScripts, validateRegexScripts } from './regex.js';
import {
  buildWorldbookPreviewModel,
  createEmptyWorldbook,
  importWorldbookJson,
  normalizeWorldbookPackage,
  validateWorldbook,
} from './worldbook.js';

export function createApiRouter() {
  const router = express.Router();

  router.get('/health', (_request, response) => {
    response.json({ ok: true, name: 'st-card-writer' });
  });

  router.get('/local-config', (_request, response) => {
    response.json(getSafeLocalConfig());
  });

  router.get('/empty-card', (_request, response) => {
    const card = createEmptyCard();
    response.json({ card, preview: buildPreviewModel(card) });
  });

  router.get('/empty-worldbook-card', (_request, response) => {
    const pack = normalizeWorldbookPackage({ worldbook: createEmptyWorldbook() });
    response.json({ ...pack, preview: buildWorldbookPreviewModel(pack) });
  });

  router.post('/generate-card', asyncHandler(async (request, response) => {
    const result = await generateCardWithOpenAICompatible(request.body || {});
    response.json({
      card: result.card,
      regexScripts: result.regexScripts,
      validation: result.validation,
      preview: buildPreviewModel(result.card),
    });
  }));

  router.post('/test-connection', async (request, response) => {
    const result = await testOpenAICompatibleConnection(request.body || {});
    response.status(result.ok ? 200 : 400).json(result);
  });

  router.post('/analyze-preset', (request, response) => {
    response.json(analyzePresetJson(request.body?.preset || request.body?.content || request.body || {}, request.body?.fileName));
  });

  router.post('/generate-plan', asyncHandler(async (request, response) => {
    response.json(await generateWorldbookPlan(request.body || {}));
  }));

  router.post('/generate-worldbook-card', asyncHandler(async (request, response) => {
    const result = await generateWorldbookCard(request.body || {});
    response.json({
      ...result,
      preview: buildWorldbookPreviewModel(result, previewOptions(request.body)),
    });
  }));

  router.post('/import-worldbook', asyncHandler(async (request, response) => {
    const result = importWorldbookJson({
      content: request.body?.content,
      json: request.body?.json || request.body?.worldbook || request.body,
      fileName: request.body?.fileName,
      mode: request.body?.mode,
      targetWorldbook: request.body?.targetWorldbook,
    });
    response.json({
      ...result,
      preview: buildWorldbookPreviewModel(result, previewOptions(request.body)),
    });
  }));

  router.post('/refine-worldbook', asyncHandler(async (request, response) => {
    const result = await refineWorldbookWithOpenAICompatible(request.body || {});
    response.json({
      ...result,
      preview: buildWorldbookPreviewModel(result, previewOptions(request.body)),
    });
  }));

  router.post('/validate-card', (request, response) => {
    response.json(validateCard(request.body?.card || request.body || {}));
  });

  router.post('/validate-worldbook', (request, response) => {
    response.json(validateWorldbook(request.body || {}));
  });

  router.post('/validate-regex', (request, response) => {
    response.json(validateRegexScripts(request.body?.regexScripts || request.body?.regex || []));
  });

  router.post('/render-preview', (request, response) => {
    if (isWorldbookPayload(request.body)) {
      const pack = normalizeWorldbookPackage(request.body || {});
      response.json({
        ...pack,
        preview: buildWorldbookPreviewModel(pack, previewOptions(request.body)),
      });
      return;
    }

    const card = normalizeCard(request.body?.card || {});
    response.json({ preview: buildPreviewModel(card, previewOptions(request.body)), card });
  });

  router.post('/regex-preview', (request, response) => {
    const scripts = (request.body?.regexScripts || []).map(normalizeRegexScript);
    response.json(previewRegexScripts(request.body?.text || '', scripts));
  });

  router.post('/export', (request, response) => {
    if (isWorldbookPayload(request.body)) {
      response.json(buildWorldbookExport(request.body || {}));
      return;
    }

    response.json(buildCardExport(request.body || {}));
  });

  return router;
}

function asyncHandler(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  };
}

function isWorldbookPayload(body = {}) {
  return Boolean(body?.worldbook || body?.worldInfo || body?.card?.data?.character_book);
}

function previewOptions(body = {}) {
  return {
    theme: body?.theme,
    regexTestText: body?.regexTestText,
  };
}

function buildWorldbookExport(body) {
  const pack = normalizeWorldbookPackage(body);
  const regexScripts = validateRegexScripts(body?.regexScripts || pack.regexScripts || []).normalized;
  const embedRegex = body?.embedRegex !== false;
  const exportPack = normalizeWorldbookPackage({
    worldbook: pack.worldbook,
    card: pack.card,
    regexScripts: embedRegex ? regexScripts : [],
  });
  const baseName = slugify(exportPack.worldbook.name || exportPack.card.data.name || 'worldbook');

  return {
    cardFileName: `${baseName}.worldcard.json`,
    worldInfoFileName: `${baseName}.worldinfo.json`,
    regexFileName: `regex-${baseName}.json`,
    card: exportPack.card,
    worldbook: exportPack.worldbook,
    worldInfo: exportPack.worldInfo,
    characterBook: exportPack.characterBook,
    regexScripts,
    cardJson: JSON.stringify(exportPack.card, null, 4),
    worldInfoJson: JSON.stringify(exportPack.worldInfo, null, 4),
    regexJson: JSON.stringify(regexScripts, null, 4),
  };
}

function buildCardExport(body) {
  const card = normalizeCard(body?.card || {});
  const regexScripts = validateRegexScripts(body?.regexScripts || card.data.extensions.regex_scripts || []).normalized;
  const embedRegex = Boolean(body?.embedRegex);
  const exportCard = embedRegex ? normalizeCard(card, regexScripts) : normalizeCard(card, []);
  const baseName = slugify(exportCard.data.name || 'character');

  return {
    cardFileName: `${baseName}.card.json`,
    regexFileName: `regex-${baseName}.json`,
    card: exportCard,
    regexScripts,
    cardJson: JSON.stringify(exportCard, null, 4),
    regexJson: JSON.stringify(regexScripts, null, 4),
  };
}

function slugify(value) {
  return String(value || 'character')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'character';
}
