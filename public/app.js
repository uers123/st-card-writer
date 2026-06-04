import { getJson, postJson } from './modules/api.js';
import {
  renderConnectionFeedback,
  renderEntryEditor as renderEntryEditorView,
  renderEntryList as renderEntryListView,
  renderPlanOutline as renderPlanOutlineView,
  renderPresetFeedback as renderPresetFeedbackView,
  renderPreview as renderPreviewView,
  renderRegexPreview as renderRegexPreviewView,
  renderValidation,
} from './modules/renderers.js';
import { emptyWorldbook, state } from './modules/state.js';
import {
  $,
  downloadText,
  setBusy,
  setStatePill,
  showToast,
  splitList,
} from './modules/ui.js';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadApiSettings();
  bindEvents();
  try {
    const pack = await getJson('/api/empty-worldbook-card');
    applyPackage(pack);
  } catch (error) {
    showToast(`初始化失败：${error.message}`);
    applyPackage({ worldbook: emptyWorldbook(), regexScripts: [] });
  }
  renderAll();
}

function bindEvents() {
  ['baseUrl', 'model', 'temperature', 'maxTokens'].forEach((id) => {
    $(`#${id}`).addEventListener('input', saveApiSettings);
  });
  $('#themeSelect').addEventListener('change', () => {
    document.body.dataset.theme = $('#themeSelect').value;
    schedulePreview();
  });
  $('#testConnectionBtn').addEventListener('click', testConnection);
  $('#presetFile').addEventListener('change', importPresetFile);
  $('#generatePlanBtn').addEventListener('click', generatePlan);
  $('#generateWorldbookBtn').addEventListener('click', generateWorldbookCard);
  $('#validateBtn').addEventListener('click', validateImport);
  $('#exportCardBtn').addEventListener('click', () => exportDownload('card'));
  $('#exportWorldBtn').addEventListener('click', () => exportDownload('world'));
  $('#exportRegexBtn').addEventListener('click', () => exportDownload('regex'));
  $('#copyCardBtn').addEventListener('click', copyCardJson);
  $('#copyRegexPreviewBtn').addEventListener('click', copyRegexPreview);
  $('#addEntryBtn').addEventListener('click', addEntry);
  $('#applyRegexBtn').addEventListener('click', applyRegexJson);
  $('#regexTestText').addEventListener('input', schedulePreview);
  $('#brief').addEventListener('input', () => setStatePill($('#workflowState'), $('#brief').value.trim() ? '已输入' : '待输入'));
  $('#planJson').addEventListener('input', onPlanEdited);
  $('#worldName').addEventListener('input', () => updateWorldbookField('name', $('#worldName').value));
  $('#worldTags').addEventListener('input', () => updateWorldbookField('tags', splitList($('#worldTags').value)));
  $('#worldDesc').addEventListener('input', () => updateWorldbookField('description', $('#worldDesc').value));
  $('#entryList').addEventListener('click', onEntryListClick);
  $('#entryEditor').addEventListener('input', onEntryEditorInput);
  $('#entryEditor').addEventListener('change', onEntryEditorInput);
}

function loadApiSettings() {
  const saved = JSON.parse(localStorage.getItem('st-card-writer-api') || '{}');
  $('#baseUrl').value = saved.baseUrl || '';
  $('#model').value = saved.model || '';
  $('#temperature').value = saved.temperature ?? 0.7;
  $('#maxTokens').value = saved.maxTokens ?? 3200;
}

function saveApiSettings() {
  localStorage.setItem('st-card-writer-api', JSON.stringify({
    baseUrl: $('#baseUrl').value.trim(),
    model: $('#model').value.trim(),
    temperature: Number($('#temperature').value || 0.7),
    maxTokens: Number($('#maxTokens').value || 3200),
  }));
}

async function testConnection() {
  setBusy('#testConnectionBtn', true, '测试中...');
  setStatePill($('#apiState'), '测试中', 'warn');
  $('#apiFeedback').textContent = '正在测试 API 连接...';
  try {
    const result = await postJson('/api/test-connection', { api: readApiConfig() });
    setStatePill($('#apiState'), result.ok ? '成功' : '失败', result.ok ? 'ok' : 'fail');
    $('#apiFeedback').innerHTML = renderConnectionFeedback(result);
  } catch (error) {
    setStatePill($('#apiState'), '失败', 'fail');
    $('#apiFeedback').textContent = error.message;
  } finally {
    setBusy('#testConnectionBtn', false, '测试连接');
  }
}

async function importPresetFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    const result = await postJson('/api/analyze-preset', { content, fileName: file.name });
    state.presetAnalyses = [result, ...state.presetAnalyses.filter((item) => item.fileName !== result.fileName)].slice(0, 5);
    if (result.valid) {
      const key = presetStateKey(result.recognizedType);
      state.presets[key] = result.preset;
    }
    setStatePill($('#presetState'), result.valid ? result.recognizedType : '无效', result.valid ? 'ok' : 'fail');
    renderPresetFeedback();
  } catch (error) {
    setStatePill($('#presetState'), '无效', 'fail');
    $('#presetFeedback').textContent = error.message;
  } finally {
    event.target.value = '';
  }
}

async function generatePlan() {
  setBusy('#generatePlanBtn', true, '生成中...');
  setStatePill($('#workflowState'), '生成计划', 'warn');
  $('#workflowFeedback').textContent = '正在请求 AI 生成世界书结构计划。';
  try {
    const result = await postJson('/api/generate-plan', buildAiPayload());
    state.plan = result.plan;
    $('#planJson').value = JSON.stringify(state.plan, null, 2);
    setStatePill($('#planState'), '已生成', 'ok');
    setStatePill($('#workflowState'), '计划完成', 'ok');
    $('#workflowFeedback').textContent = '计划已生成。可以微调 JSON，然后点击“根据计划生成世界书卡”。';
    renderPlanOutline();
  } catch (error) {
    setStatePill($('#workflowState'), '计划失败', 'fail');
    $('#workflowFeedback').textContent = error.message;
  } finally {
    setBusy('#generatePlanBtn', false, '生成计划');
  }
}

async function generateWorldbookCard() {
  setBusy('#generateWorldbookBtn', true, '生成中...');
  setStatePill($('#workflowState'), '生成成卡', 'warn');
  $('#workflowFeedback').textContent = '正在根据需求和计划扩写世界书条目。';
  try {
    let plan = readPlanJson();
    if ($('#planMode').checked && !plan) {
      await generatePlan();
      plan = state.plan;
      if (!plan) {
        throw new Error('Plan 生成失败，未继续生成世界书卡。');
      }
    }
    const result = await postJson('/api/generate-worldbook-card', {
      ...buildAiPayload(),
      plan: plan || {},
      theme: $('#themeSelect').value,
      regexTestText: $('#regexTestText').value,
    });
    applyPackage(result);
    setStatePill($('#workflowState'), '成卡完成', 'ok');
    $('#workflowFeedback').textContent = '世界书卡已生成。右侧可预览，必要时在结构化编辑区少量修改。';
    renderAll();
  } catch (error) {
    setStatePill($('#workflowState'), '成卡失败', 'fail');
    $('#workflowFeedback').textContent = error.message;
  } finally {
    setBusy('#generateWorldbookBtn', false, '根据计划生成世界书卡');
  }
}

async function validateImport() {
  try {
    const result = await postJson('/api/validate-worldbook', buildPackagePayload());
    applyValidation(result);
    showToast(result.valid ? '检查通过：可以导入。' : '检查未通过：请查看反馈。');
  } catch (error) {
    $('#validationOutput').textContent = error.message;
  }
}

async function exportDownload(type) {
  const data = await getExportPackage();
  if (type === 'card') {
    downloadText(data.cardFileName, data.cardJson);
    return;
  }
  if (type === 'world') {
    downloadText(data.worldInfoFileName, data.worldInfoJson);
    return;
  }
  downloadText(data.regexFileName, data.regexJson);
}

async function copyCardJson() {
  const data = await getExportPackage();
  await navigator.clipboard.writeText(data.cardJson);
  showToast('已复制卡片 JSON。');
}

async function copyRegexPreview() {
  const text = state.preview?.regexPreview?.output || '';
  await navigator.clipboard.writeText(text);
  showToast('已复制正则预览结果。');
}

async function getExportPackage() {
  const data = await postJson('/api/export', {
    ...buildPackagePayload(),
    embedRegex: $('#embedRegex').checked,
  });
  state.exportCache = data;
  return data;
}

function applyPackage(pack) {
  state.worldbook = pack.worldbook || state.worldbook || emptyWorldbook();
  state.card = pack.card || state.card || null;
  state.worldInfo = pack.worldInfo || state.worldInfo || null;
  state.characterBook = pack.characterBook || state.characterBook || null;
  state.regexScripts = Array.isArray(pack.regexScripts) ? pack.regexScripts : state.regexScripts || [];
  state.preview = pack.preview || state.preview;
  state.selectedEntryId = state.selectedEntryId ?? state.worldbook.entries?.[0]?.id ?? null;
  $('#regexScriptsJson').value = JSON.stringify(state.regexScripts, null, 2);
  syncEditorInputs();
}

function syncEditorInputs() {
  const worldbook = state.worldbook || emptyWorldbook();
  $('#worldName').value = worldbook.name || '';
  $('#worldDesc').value = worldbook.description || '';
  $('#worldTags').value = (worldbook.tags || []).join(', ');
}

function renderAll() {
  renderPlanOutline();
  renderEntryList();
  renderEntryEditor();
  renderPreview();
  renderRegexPreview();
}

function renderPresetFeedback() {
  renderPresetFeedbackView(state.presetAnalyses);
}

function renderPlanOutline() {
  const plan = readPlanJson() || state.plan;
  if (!plan) {
    $('#planOutline').innerHTML = '';
    setStatePill($('#planState'), '无大纲');
    return;
  }

  setStatePill($('#planState'), `${plan.entries?.length || 0} 条`, 'ok');
  renderPlanOutlineView(plan);
}

function renderEntryList() {
  const entries = state.worldbook?.entries || [];
  if (entries.length > 0 && !entries.some((entry) => entry.id === state.selectedEntryId)) {
    state.selectedEntryId = entries[0].id;
  }

  renderEntryListView(entries, state.selectedEntryId);
}

function renderEntryEditor() {
  renderEntryEditorView(selectedEntry(), deleteSelectedEntry);
}

function renderPreview() {
  renderPreviewView(state.preview);
}

function renderRegexPreview() {
  renderRegexPreviewView(state.preview);
}

function applyValidation(result) {
  renderValidation(result);
}

function onEntryListClick(event) {
  const button = event.target.closest('[data-entry-id]');
  if (!button) return;
  state.selectedEntryId = Number(button.dataset.entryId);
  renderEntryList();
  renderEntryEditor();
}

function onEntryEditorInput(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  const entry = selectedEntry();
  if (!entry) return;

  if (field === 'keys' || field === 'secondaryKeys') {
    entry[field] = splitList(event.target.value);
  } else if (['priority', 'position'].includes(field)) {
    entry[field] = Number(event.target.value);
  } else if (['enabled', 'constant'].includes(field)) {
    entry[field] = event.target.checked;
  } else {
    entry[field] = event.target.value;
  }

  state.exportCache = null;
  renderEntryList();
  schedulePreview();
}

function addEntry() {
  const entries = state.worldbook.entries || [];
  const nextId = entries.reduce((max, entry) => Math.max(max, Number(entry.id || 0)), -1) + 1;
  entries.push({
    id: nextId,
    title: `新条目 ${nextId + 1}`,
    keys: [],
    secondaryKeys: [],
    triggerLogic: 'keyword',
    content: '',
    position: 0,
    positionLabel: 'Before Character',
    priority: 100 + nextId,
    group: 'Core',
    enabled: true,
    constant: false,
    selective: false,
    color: '#24b47e',
    placeholder: 'WB',
    imageUrl: '',
  });
  state.selectedEntryId = nextId;
  renderEntryList();
  renderEntryEditor();
  schedulePreview();
}

function deleteSelectedEntry() {
  const entry = selectedEntry();
  if (!entry) return;
  state.worldbook.entries = state.worldbook.entries.filter((item) => item.id !== entry.id);
  state.selectedEntryId = state.worldbook.entries[0]?.id ?? null;
  renderEntryList();
  renderEntryEditor();
  schedulePreview();
}

function updateWorldbookField(field, value) {
  state.worldbook[field] = value;
  state.exportCache = null;
  schedulePreview();
}

async function schedulePreview() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(refreshPreview, 180);
}

async function refreshPreview() {
  try {
    const result = await postJson('/api/render-preview', {
      ...buildPackagePayload(),
      theme: $('#themeSelect').value,
      regexTestText: $('#regexTestText').value,
    });
    applyPackage(result);
    renderPreview();
    renderRegexPreview();
  } catch (error) {
    $('#previewState').textContent = '预览失败';
    $('#regexPreviewOutput').textContent = error.message;
  }
}

function applyRegexJson() {
  try {
    const parsed = JSON.parse($('#regexScriptsJson').value || '[]');
    state.regexScripts = Array.isArray(parsed) ? parsed : [parsed];
    schedulePreview();
    showToast('正则 JSON 已应用。');
  } catch (error) {
    showToast(`正则 JSON 解析失败：${error.message}`);
  }
}

function onPlanEdited() {
  const plan = readPlanJson();
  if (plan) {
    state.plan = plan;
    setStatePill($('#planState'), '已编辑', 'ok');
  } else if ($('#planJson').value.trim()) {
    setStatePill($('#planState'), 'JSON 无效', 'fail');
  }
  renderPlanOutline();
}

function readPlanJson() {
  const text = $('#planJson').value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function selectedEntry() {
  return (state.worldbook?.entries || []).find((entry) => entry.id === state.selectedEntryId) || null;
}

function buildAiPayload() {
  return {
    api: readApiConfig(),
    brief: $('#brief').value,
    presets: state.presets,
    generation: {
      temperature: Number($('#temperature').value || 0.7),
      maxTokens: Number($('#maxTokens').value || 3200),
    },
  };
}

function buildPackagePayload() {
  return {
    worldbook: state.worldbook || emptyWorldbook(),
    card: state.card,
    regexScripts: state.regexScripts || [],
  };
}

function readApiConfig() {
  return {
    baseUrl: $('#baseUrl').value.trim(),
    apiKey: $('#apiKey').value,
    model: $('#model').value.trim(),
  };
}

function presetStateKey(type) {
  if (type === 'system_prompt') return 'system_prompt';
  return type || 'unknown';
}
