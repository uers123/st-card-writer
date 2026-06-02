import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createEmptyCard, normalizeCard, validateCard } from './src/card.js';
import { generateCardWithOpenAICompatible } from './src/openai.js';
import { buildPreviewModel } from './src/render.js';
import { normalizeRegexScript, previewRegexScripts, validateRegexScripts } from './src/regex.js';

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

app.post('/api/validate-card', (request, response) => {
  const validation = validateCard(request.body?.card || request.body || {});
  response.json(validation);
});

app.post('/api/validate-regex', (request, response) => {
  const validation = validateRegexScripts(request.body?.regexScripts || request.body?.regex || []);
  response.json(validation);
});

app.post('/api/render-preview', (request, response) => {
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
