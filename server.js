import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createEmptyCard, normalizeCard, validateCard } from './src/card.js';
import { analyzePresetJson } from './src/presets.js';
import {
  generateCardWithOpenAICompatible,
  generateWorldbookCard,
  generateWorldbookPlan,
  testOpenAICompatibleConnection,
} from './src/openai.js';
import { buildPreviewModel } from './src/render.js';
import { normalizeRegexScript, previewRegexScripts, validateRegexScripts } from './src/regex.js';
import {
  buildWorldbookPreviewModel,
  createEmptyWorldbook,
  normalizeWorldbookPackage,
  validateWorldbook,
} from './src/worldbook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8787);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, name: 'st-card-writer' });
});

app.get('/api/empty-card', (_request, response) => {
  const card = createEmptyCard();
  response.json({ card, preview: buildPreviewModel(card) });
});

app.get('/api/empty-worldbook-card', (_request, response) => {
  const pack = normalizeWorldbookPackage({ worldbook: createEmptyWorldbook() });
  response.json({ ...pack, preview: buildWorldbookPreviewModel(pack) });
});

app.post('/api/generate-card', async (request, response) => {
  try {
    const result = await generateCardWithOpenAICompatible(request.body || {});
    response.json({
      card: result.card,
      regexScripts: result.regexScripts,
      validation: result.validation,
      preview: buildPreviewModel(result.card),
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/test-connection', async (request, response) => {
  const result = await testOpenAICompatibleConnection(request.body || {});
  response.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/analyze-preset', (request, response) => {
  response.json(analyzePresetJson(request.body?.preset || request.body?.content || request.body || {}, request.body?.fileName));
});

app.post('/api/generate-plan', async (request, response) => {
  try {
    const result = await generateWorldbookPlan(request.body || {});
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/generate-worldbook-card', async (request, response) => {
  try {
    const result = await generateWorldbookCard(request.body || {});
    response.json({
      ...result,
      preview: buildWorldbookPreviewModel(result, {
        theme: request.body?.theme,
        regexTestText: request.body?.regexTestText,
      }),
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/validate-card', (request, response) => {
  const validation = validateCard(request.body?.card || request.body || {});
  response.json(validation);
});

app.post('/api/validate-worldbook', (request, response) => {
  response.json(validateWorldbook(request.body || {}));
});

app.post('/api/validate-regex', (request, response) => {
  const validation = validateRegexScripts(request.body?.regexScripts || request.body?.regex || []);
  response.json(validation);
});

app.post('/api/render-preview', (request, response) => {
  if (request.body?.worldbook || request.body?.worldInfo || request.body?.card?.data?.character_book) {
    const pack = normalizeWorldbookPackage(request.body || {});
    response.json({
      ...pack,
      preview: buildWorldbookPreviewModel(pack, {
        theme: request.body?.theme,
        regexTestText: request.body?.regexTestText,
      }),
    });
    return;
  }

  const card = normalizeCard(request.body?.card || {});
  const preview = buildPreviewModel(card, {
    theme: request.body?.theme,
    regexTestText: request.body?.regexTestText,
  });
  response.json({ preview, card });
});

app.post('/api/regex-preview', (request, response) => {
  const scripts = (request.body?.regexScripts || []).map(normalizeRegexScript);
  response.json(previewRegexScripts(request.body?.text || '', scripts));
});

app.post('/api/export', (request, response) => {
  if (request.body?.worldbook || request.body?.worldInfo || request.body?.card?.data?.character_book) {
    const pack = normalizeWorldbookPackage(request.body || {});
    const regexScripts = validateRegexScripts(request.body?.regexScripts || pack.regexScripts || []).normalized;
    const embedRegex = request.body?.embedRegex !== false;
    const exportPack = normalizeWorldbookPackage({
      worldbook: pack.worldbook,
      card: pack.card,
      regexScripts: embedRegex ? regexScripts : [],
    });
    const baseName = slugify(exportPack.worldbook.name || exportPack.card.data.name || 'worldbook');

    response.json({
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
    });
    return;
  }

  const card = normalizeCard(request.body?.card || {});
  const regexScripts = validateRegexScripts(request.body?.regexScripts || card.data.extensions.regex_scripts || []).normalized;
  const embedRegex = Boolean(request.body?.embedRegex);
  const exportCard = embedRegex ? normalizeCard(card, regexScripts) : normalizeCard(card, []);
  const baseName = slugify(exportCard.data.name || 'character');

  response.json({
    cardFileName: `${baseName}.card.json`,
    regexFileName: `regex-${baseName}.json`,
    card: exportCard,
    regexScripts,
    cardJson: JSON.stringify(exportCard, null, 4),
    regexJson: JSON.stringify(regexScripts, null, 4),
  });
});

app.listen(port, () => {
  console.log(`SillyTavern card writer running at http://localhost:${port}`);
});

function slugify(value) {
  return String(value || 'character')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'character';
}
