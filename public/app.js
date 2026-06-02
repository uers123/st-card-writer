const state = {
  presets: {},
  presetAnalyses: [],
  plan: null,
  worldbook: null,
  card: null,
  worldInfo: null,
  characterBook: null,
  regexScripts: [],
  preview: null,
  selectedEntryId: null,
  exportCache: null,
  previewTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

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
  if (state.presetAnalyses.length === 0) {
    $('#presetFeedback').textContent = '尚未导入预设。';
    return;
  }

  $('#presetFeedback').innerHTML = state.presetAnalyses.map((item) => `
    <div class="message-list">
      <div class="${item.valid ? 'ok' : 'error'}">
        <strong>${escapeHtml(item.fileName)}</strong>：${escapeHtml(item.recognizedType)}
        · 关键字段 ${item.keyCount}
      </div>
      ${item.fields?.length ? `<div>字段：${escapeHtml(item.fields.join(', '))}</div>` : ''}
      ${item.errors?.map((error) => `<div class="error">${escapeHtml(error)}</div>`).join('') || ''}
    </div>
  `).join('');
}

function renderPlanOutline() {
  const plan = readPlanJson() || state.plan;
  if (!plan) {
    $('#planOutline').innerHTML = '';
    setStatePill($('#planState'), '无大纲');
    return;
  }

  setStatePill($('#planState'), `${plan.entries?.length || 0} 条`, 'ok');
  $('#planOutline').innerHTML = (plan.entries || []).map((entry) => `
    <div class="outline-item">
      <strong>${escapeHtml(entry.title || '未命名条目')}</strong>
      <span>${escapeHtml(entry.group || 'Core')} · ${escapeHtml((entry.keys || []).join(', ') || '无关键词')}</span>
      <span>${escapeHtml(entry.purpose || '')}</span>
    </div>
  `).join('');
}

function renderEntryList() {
  const entries = state.worldbook?.entries || [];
  if (entries.length === 0) {
    $('#entryList').innerHTML = '<div class="feedback muted">暂无条目。AI 生成后会出现在这里。</div>';
    return;
  }

  if (!entries.some((entry) => entry.id === state.selectedEntryId)) {
    state.selectedEntryId = entries[0].id;
  }

  $('#entryList').innerHTML = entries.map((entry) => `
    <button type="button" data-entry-id="${entry.id}" class="${entry.id === state.selectedEntryId ? 'active' : ''}">
      ${escapeHtml(entry.title || '未命名条目')}
      <small>${escapeHtml(entry.group || 'Core')} · ${entry.keys?.length || 0} 关键词</small>
    </button>
  `).join('');
}

function renderEntryEditor() {
  const entry = selectedEntry();
  if (!entry) {
    $('#entryEditor').innerHTML = '选择或添加条目后可编辑。';
    return;
  }

  $('#entryEditor').innerHTML = `
    <div class="entry-editor-grid">
      <label>标题<input data-field="title" type="text" value="${escapeAttr(entry.title)}"></label>
      <label>分组<input data-field="group" type="text" value="${escapeAttr(entry.group)}"></label>
      <label class="full">关键词<input data-field="keys" type="text" value="${escapeAttr((entry.keys || []).join(', '))}"></label>
      <label class="full">次级关键词<input data-field="secondaryKeys" type="text" value="${escapeAttr((entry.secondaryKeys || []).join(', '))}"></label>
      <label>位置
        <select data-field="position">
          ${positionOptions(entry.position)}
        </select>
      </label>
      <label>优先级<input data-field="priority" type="number" value="${Number(entry.priority || 100)}"></label>
      <label class="checkline"><input data-field="enabled" type="checkbox" ${entry.enabled ? 'checked' : ''}><span>启用</span></label>
      <label class="checkline"><input data-field="constant" type="checkbox" ${entry.constant ? 'checked' : ''}><span>常驻</span></label>
      <label>图片 URL<input data-field="imageUrl" type="url" value="${escapeAttr(entry.imageUrl || '')}"></label>
      <label>主题色<input data-field="color" type="color" value="${escapeAttr(entry.color || '#24b47e')}"></label>
      <label class="full">正文<textarea data-field="content" rows="8">${escapeHtml(entry.content || '')}</textarea></label>
    </div>
    <div class="button-row">
      <button type="button" id="deleteEntryBtn">删除条目</button>
    </div>
  `;
  $('#deleteEntryBtn').addEventListener('click', deleteSelectedEntry);
}

function renderPreview() {
  const preview = state.preview;
  if (!preview) {
    $('#renderPreview').innerHTML = '<div class="feedback muted">生成或编辑后会显示预览。</div>';
    return;
  }

  const header = preview.header || {};
  const accent = header.accentColor || '#24b47e';
  $('#renderPreview').innerHTML = `
    <article class="world-card" style="--accent:${escapeAttr(accent)}">
      <header class="world-hero">
        <div class="world-cover">${renderImageOrText(header.coverImageUrl, initials(header.name || 'WB'))}</div>
        <div>
          <h3>${escapeHtml(header.name || '未命名世界书')}</h3>
          <p>${escapeHtml(header.subtitle || '')}</p>
          <div class="tag-row">${(preview.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
        </div>
      </header>
      <div class="stat-row">
        <span class="stat">核心完整度 ${preview.completion?.core || 0}%</span>
        <span class="stat">条目完整度 ${preview.completion?.entries || 0}%</span>
        <span class="stat">${preview.metrics?.entries || 0} 条目</span>
        <span class="stat">${preview.metrics?.estimatedTokens || 0} tokens 估算</span>
      </div>
      ${renderPreviewSections(preview.sections || [])}
      ${renderPreviewGroups(preview.groups || [])}
    </article>
  `;
}

function renderPreviewSections(sections) {
  return sections.map((section) => `
    <details class="preview-section" ${section.empty ? '' : 'open'}>
      <summary>${escapeHtml(section.title)} · ${section.estimatedTokens || 0} tokens</summary>
      <pre>${escapeHtml(section.content || '(空)')}</pre>
    </details>
  `).join('');
}

function renderPreviewGroups(groups) {
  if (groups.length === 0) {
    return '<div class="preview-group muted">暂无世界书条目。</div>';
  }

  return groups.map((group) => `
    <details class="preview-group" open>
      <summary>${escapeHtml(group.name)} · ${group.entries.length} 条 · 启用 ${group.enabled}</summary>
      ${group.entries.map(renderPreviewEntry).join('')}
    </details>
  `).join('');
}

function renderPreviewEntry(entry) {
  return `
    <div class="preview-entry ${entry.enabled ? '' : 'disabled-entry'}" style="--entry-color:${escapeAttr(entry.color || '#24b47e')}">
      <div class="preview-entry-head">
        <div class="entry-thumb">${renderImageOrText(entry.imageUrl, entry.placeholder || initials(entry.title))}</div>
        <div class="entry-meta">
          <h4>${escapeHtml(entry.title)}</h4>
          <p>${escapeHtml(entry.positionLabel || '')} · 优先级 ${Number(entry.priority || 0)} · ${entry.enabled ? '启用' : '禁用'}</p>
          <div class="keyword-row">${(entry.keys || []).map((key) => `<span class="keyword">${escapeHtml(key)}</span>`).join('')}</div>
        </div>
      </div>
      <pre>${escapeHtml(entry.content || '(空)')}</pre>
    </div>
  `;
}

function renderRegexPreview() {
  const output = state.preview?.regexPreview?.output || '';
  $('#regexPreviewOutput').textContent = output || '暂无正则预览。';
}

function applyValidation(result) {
  const lines = [];
  lines.push(`<div class="${result.valid ? 'ok' : 'error'}">${result.valid ? '可以导入。' : '暂不能导入。'}</div>`);
  for (const error of result.errors || []) lines.push(`<div class="error">${escapeHtml(error)}</div>`);
  for (const warning of result.warnings || []) lines.push(`<div class="warning">${escapeHtml(warning)}</div>`);
  $('#validationOutput').innerHTML = `<div class="message-list">${lines.join('')}</div>`;
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

function emptyWorldbook() {
  return {
    name: '',
    description: '',
    summary: '',
    tags: ['worldbook-card'],
    creator: '',
    version: '1.0.0',
    entries: [],
  };
}

function presetStateKey(type) {
  if (type === 'system_prompt') return 'system_prompt';
  return type || 'unknown';
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function positionOptions(selected) {
  const options = [
    [0, 'Before Character'],
    [1, 'After Character'],
    [2, 'Author Note Top'],
    [3, 'Author Note Bottom'],
    [4, 'At Depth'],
    [5, 'Example Message Top'],
    [6, 'Example Message Bottom'],
    [7, 'Outlet'],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${label}</option>`).join('');
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: text };
  }
  if (!response.ok) throw new Error(parsed.error || parsed.message || text || `HTTP ${response.status}`);
  return parsed;
}

function downloadText(fileName, text) {
  const blob = new Blob([text || ''], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setBusy(selector, busy, text) {
  const button = $(selector);
  button.disabled = busy;
  button.textContent = text;
}

function setStatePill(element, text, status = '') {
  element.textContent = text;
  element.classList.remove('ok', 'warn', 'fail');
  if (status) element.classList.add(status);
}

function renderConnectionFeedback(result) {
  const modelLine = result.modelAvailable === null
    ? '未指定模型，未检查模型是否可用。'
    : result.modelAvailable
      ? '当前模型可用。'
      : '当前模型不在 /models 列表中，可能仍可通过 chat 请求使用。';
  return `
    <div class="message-list">
      <div class="${result.ok ? 'ok' : 'error'}">${escapeHtml(result.message || '')}</div>
      <div>测试方式：${escapeHtml(result.method || 'unknown')}</div>
      <div>${escapeHtml(modelLine)}</div>
    </div>
  `;
}

function renderImageOrText(url, text) {
  if (url) {
    return `<img src="${escapeAttr(url)}" alt="">`;
  }
  return escapeHtml(text || 'WB');
}

function initials(value) {
  return String(value || 'WB').split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join('') || 'WB';
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
