const $ = (selector) => document.querySelector(selector);
const state = { snapshot: null, injection: null, endpoint: localStorage.getItem('mae-endpoint') || 'http://127.0.0.1:8787/api/mae' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  $('#endpoint').value = state.endpoint;
  bindEvents();
  loadSettings();
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) showView(hash);
  await refresh();
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((element) => element.addEventListener('click', () => showView(element.dataset.view)));
  $('#directoryToggle').addEventListener('click', toggleDirectory);
  $('#refreshBtn').addEventListener('click', refresh);
  $('#processTurnBtn').addEventListener('click', processTurn);
  $('#runTickBtn').addEventListener('click', runTick);
  $('#buildInjectionBtn').addEventListener('click', buildInjection);
  $('#auditBtn').addEventListener('click', auditText);
  $('#worldbookFile').addEventListener('change', importWorldbook);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#testEndpointBtn').addEventListener('click', testEndpoint);
  $('#loadModelRoutesBtn').addEventListener('click', loadModelRoutes);
  $('#saveModelRoutesBtn').addEventListener('click', saveModelRoutes);
  $('#savePhysiologyRulesBtn').addEventListener('click', savePhysiologyRules);
  $('#markDeathBtn').addEventListener('click', markDeath);
  $('#createSuccessorBtn').addEventListener('click', createSuccessor);
  $('#refreshGaidenBtn').addEventListener('click', refreshGaiden);
  $('#processGaidenBtn').addEventListener('click', processGaiden);
  $('#entityEditorList').addEventListener('change', saveEntityField);
}

function toggleDirectory() {
  const directory = $('#maeDirectory');
  const button = $('#directoryToggle');
  const open = directory.hidden;
  directory.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  button.title = open ? '收起功能目录' : '打开功能目录';
}

function showView(view) {
  const valid = document.querySelector(`[data-view-panel="${view}"]`) ? view : 'dashboard';
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    const active = panel.dataset.viewPanel === valid;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('.directory-card').forEach((card) => card.classList.toggle('active', card.dataset.view === valid));
  history.replaceState(null, '', `#${valid}`);
}

async function refresh() {
  try {
    const response = await maeFetch(`/session?chatId=${encodeURIComponent(chatId())}`);
    state.snapshot = response;
    renderSnapshot();
    setPill($('#healthPill'), '本地服务正常', 'ok');
    setPill($('#sessionState'), `会话 ${chatId()}`, 'ok');
  } catch (error) {
    setPill($('#healthPill'), '服务不可用', 'fail');
    setPill($('#sessionState'), '无法加载', 'fail');
    showToast(error.message);
  }
}

async function processTurn() {
  const text = $('#turnText').value.trim();
  if (!text) return showToast('请先输入一回合文本。');
  setBusy('#processTurnBtn', true, '记录中...');
  try {
    const result = await maeFetch('/turn', { method: 'POST', body: JSON.stringify({ chatId: chatId(), turnSeq: number('#turnSeq', 0), text, role: 'assistant', entities: readJsonArea('#entitiesJson'), facts: readJsonArea('#factsJson') }) });
    state.snapshot = result.snapshot;
    $('#turnFeedback').textContent = result.tickDue ? '已记录。达到 tick 间隔，可以运行一次后台推进。' : '已记录到实体、事实和时间线。';
    renderSnapshot();
  } catch (error) { $('#turnFeedback').textContent = error.message; }
  finally { setBusy('#processTurnBtn', false, '记录当前回合'); }
}

async function buildInjection() {
  setBusy('#buildInjectionBtn', true, '组装中...');
  try {
    const result = await maeFetch('/injection', { method: 'POST', body: JSON.stringify({ chatId: chatId(), turnSeq: number('#turnSeq', 0), contextText: $('#contextText').value, settings: { tier: $('#tier').value } }) });
    state.injection = result.injection;
    renderInjection();
    setPill($('#injectionState'), `${result.injection.stats.estimatedTokens} token`, 'ok');
  } catch (error) { $('#injectionOutput').textContent = error.message; setPill($('#injectionState'), '失败', 'fail'); }
  finally { setBusy('#buildInjectionBtn', false, '生成注入预览'); }
}

async function auditText() {
  const text = $('#auditText').value.trim();
  if (!text) return showToast('请先输入待审计文本。');
  try {
    const result = await maeFetch('/audit', { method: 'POST', body: JSON.stringify({ chatId: chatId(), turnSeq: number('#turnSeq', 0), text }) });
    $('#auditOutput').innerHTML = result.audit.verdict === 'pass' ? '<span class="good">通过：没有命中当前硬事实冲突。</span>' : `<span class="bad">拦截：${escapeHtml(result.audit.violations.map((item) => item.reason).join('；'))}</span>`;
    await refresh();
  } catch (error) { $('#auditOutput').textContent = error.message; }
}

async function runTick() {
  setBusy('#runTickBtn', true, '推进中...');
  try {
    const result = await maeFetch('/tick', { method: 'POST', body: JSON.stringify({ chatId: chatId() }) });
    $('#tickFeedback').textContent = result.skipped ? `未执行：${result.reason}` : `已推进 ${result.events.length} 个后台事件。`;
    state.snapshot = result.snapshot || state.snapshot;
    renderSnapshot();
  } catch (error) { $('#tickFeedback').textContent = error.message; }
  finally { setBusy('#runTickBtn', false, '运行一次后台 tick'); }
}

async function importWorldbook(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  $('#worldbookFeedback').textContent = '正在解析世界书...';
  try {
    const imported = await fetch('/api/import-worldbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, content: await file.text() }) }).then(readResponse);
    const synced = await maeFetch('/worldbook/sync', { method: 'POST', body: JSON.stringify({ chatId: chatId(), name: imported.worldbook.name, entries: imported.worldbook.entries }) });
    $('#worldbookFeedback').textContent = `已同步 ${synced.worldbook.count} 条。关键词命中和语义回退会在下一次注入预览生效。`;
    renderWorldbook(synced.snapshot.meta?.['mae.worldbook_snapshot']);
    setPill($('#worldbookState'), `${synced.worldbook.count} 条`, 'ok');
  } catch (error) { $('#worldbookFeedback').textContent = error.message; setPill($('#worldbookState'), '导入失败', 'fail'); }
}

async function saveSettings() {
  state.endpoint = $('#endpoint').value.trim().replace(/\/$/u, '');
  localStorage.setItem('mae-endpoint', state.endpoint);
  try {
    const result = await maeFetch('/settings', { method: 'POST', body: JSON.stringify({ chatId: chatId(), settings: { tier: $('#tier').value, tickEvery: number('#tickEvery', 8), maxTickNpcs: number('#maxTickNpcs', 5) } }) });
    $('#settingsFeedback').textContent = `已保存：${result.settings.tier} 档，每 ${result.settings.tickEvery} 轮检查 tick。`;
  } catch (error) { $('#settingsFeedback').textContent = error.message; }
}

async function testEndpoint() {
  state.endpoint = $('#endpoint').value.trim().replace(/\/$/u, '');
  localStorage.setItem('mae-endpoint', state.endpoint);
  try { const result = await maeFetch('/health'); $('#settingsFeedback').textContent = `连接成功：${result.name}`; setPill($('#healthPill'), '本地服务正常', 'ok'); }
  catch (error) { $('#settingsFeedback').textContent = error.message; setPill($('#healthPill'), '服务不可用', 'fail'); }
}

async function loadModelRoutes() {
  try { const result = await maeFetch(`/model-routes?chatId=${encodeURIComponent(chatId())}`); $('#modelRoutesJson').value = JSON.stringify(result.routes, null, 2); $('#modelRoutesFeedback').textContent = '已读取。apiKey 只显示为是否配置，不会回显密钥。'; }
  catch (error) { $('#modelRoutesFeedback').textContent = error.message; }
}

async function saveModelRoutes() {
  try { const routes = JSON.parse($('#modelRoutesJson').value || '{}'); const result = await maeFetch('/model-routes', { method: 'POST', body: JSON.stringify({ chatId: chatId(), defaultApi: routes.defaultApi, slots: routes.slots }) }); $('#modelRoutesJson').value = JSON.stringify(result.routes, null, 2); $('#modelRoutesFeedback').textContent = '分槽配置已保存。'; }
  catch (error) { $('#modelRoutesFeedback').textContent = `保存失败：${error.message}`; }
}

async function savePhysiologyRules() {
  try { const rules = JSON.parse($('#physiologyRulesJson').value || '{}'); const result = await maeFetch('/physiology/rules', { method: 'POST', body: JSON.stringify({ chatId: chatId(), rules }) }); $('#physiologyRulesJson').value = JSON.stringify(result.rules, null, 2); $('#physiologyFeedback').textContent = '六类规则覆盖已保存。'; }
  catch (error) { $('#physiologyFeedback').textContent = `保存失败：${error.message}`; }
}

async function markDeath() {
  const entityId = $('#deathEntityId').value.trim();
  if (!entityId) return showToast('请先填写实体 ID。');
  try { const result = await maeFetch('/death', { method: 'POST', body: JSON.stringify({ chatId: chatId(), entityId, cause: $('#deathCause').value.trim(), turnSeq: number('#turnSeq', 0) }) }); $('#successionFeedback').textContent = result.result.protected ? '继任新手保护阻止了这次死亡。' : '死亡已结算，终章已进入番外队列。'; await refresh(); }
  catch (error) { $('#successionFeedback').textContent = error.message; }
}

async function createSuccessor() {
  const deceasedId = $('#deathEntityId').value.trim();
  const name = $('#successorName').value.trim();
  if (!deceasedId || !name) return showToast('请填写死亡实体 ID 和继任者姓名。');
  try { await maeFetch('/successor', { method: 'POST', body: JSON.stringify({ chatId: chatId(), deceasedId, name, relation: $('#successorRelation').value.trim(), identity: $('#successorIdentity').value.trim(), turnSeq: number('#turnSeq', 0) }) }); $('#successionFeedback').textContent = '继任者已登记，下一次注入会只显示一次交接摘要。'; await refresh(); }
  catch (error) { $('#successionFeedback').textContent = error.message; }
}

async function refreshGaiden() {
  try { const result = await maeFetch(`/gaiden?chatId=${encodeURIComponent(chatId())}`); renderGaiden(result.chapters || []); $('#gaidenFeedback').textContent = `队列 ${result.chapters?.filter((item) => item.status === 'queued').length || 0} 章。`; }
  catch (error) { $('#gaidenFeedback').textContent = error.message; }
}

async function processGaiden() {
  try { const result = await maeFetch('/gaiden/process', { method: 'POST', body: JSON.stringify({ chatId: chatId(), maxChapters: 1 }) }); $('#gaidenFeedback').textContent = result.result?.skipped ? `未处理：${result.result.reason}` : '已处理一章番外。'; await refreshGaiden(); }
  catch (error) { $('#gaidenFeedback').textContent = error.message; }
}

function renderSnapshot() {
  const snapshot = state.snapshot || {};
  $('#entityCount').textContent = snapshot.counts?.entities ?? 0;
  $('#factCount').textContent = snapshot.counts?.facts ?? 0;
  $('#timelineCount').textContent = snapshot.counts?.timeline ?? 0;
  $('#auditCount').textContent = snapshot.counts?.audits ?? 0;
  if (snapshot.settings) { $('#tier').value = snapshot.settings.tier; $('#tickEvery').value = snapshot.settings.tickEvery; $('#maxTickNpcs').value = snapshot.settings.maxTickNpcs; }
  renderEntities(snapshot.entities || []); renderFacts(snapshot.facts || []); renderTimeline(snapshot.timeline || []); renderAudits(snapshot.audits || []); renderWorldbook(snapshot.meta?.['mae.worldbook_snapshot']); renderAdvanced(snapshot);
}

function renderEntities(items) {
  $('#entitiesTable').innerHTML = items.length ? `<table><thead><tr><th>名称</th><th>类型</th><th>状态</th><th>显著度</th><th>当前位置</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>${Number(item.salience).toFixed(2)}</td><td>${escapeHtml(item.location || item.current_state || '未知')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">还没有实体。可以在记录回合时提供实体 JSON，或由 SillyTavern 扩展接入模型抽取。</p>';
  $('#entityEditorList').innerHTML = items.length ? items.map(renderEntityEditor).join('') : '<p class="muted">记录回合或导入世界状态后，这里会显示可编辑的 NPC、物品和其他实体。</p>';
}

function renderEntityEditor(item) {
  const list = (value) => Array.isArray(value) ? value.join('、') : String(value || '');
  return `<article class="mae-entity-editor-card" data-entity-id="${escapeHtml(item.id)}">
    <div class="mae-entity-editor-head"><div><strong>${escapeHtml(item.name || '未命名实体')}</strong><small>${escapeHtml(item.type || 'npc')} · ${escapeHtml(item.id)}</small></div><span class="state-pill ${item.status === 'deceased' ? 'fail' : 'ok'}">${escapeHtml(item.status || 'active')}</span></div>
    <div class="mae-entity-fields">
      <label>名称<input data-entity-field="name" value="${escapeAttr(item.name)}"></label>
      <label>类型<input data-entity-field="type" value="${escapeAttr(item.type)}" placeholder="npc / item / place"></label>
      <label>状态<input data-entity-field="status" value="${escapeAttr(item.status)}"></label>
      <label>地点<input data-entity-field="location" value="${escapeAttr(item.location)}"></label>
      <label class="full">简介<textarea data-entity-field="introduction" rows="2">${escapeHtml(item.introduction || '')}</textarea></label>
      <label class="full">个性<textarea data-entity-field="personality" rows="2" placeholder="冷静、谨慎、重视契约">${escapeHtml(item.personality || '')}</textarea></label>
      <label class="full">行为<textarea data-entity-field="behaviors" rows="2" placeholder="巡查城门、回避陌生人">${escapeHtml(list(item.behaviors))}</textarea></label>
      <label class="full">物品 / 持有物<textarea data-entity-field="inventory" rows="2" placeholder="旧钥匙、药瓶">${escapeHtml(list(item.inventory))}</textarea></label>
      <label class="full">目标<textarea data-entity-field="goals" rows="2">${escapeHtml(list(item.goals))}</textarea></label>
    </div>
  </article>`;
}

async function saveEntityField(event) {
  const field = event.target.dataset.entityField;
  const card = event.target.closest('[data-entity-id]');
  if (!field || !card) return;
  const value = ['behaviors', 'inventory', 'goals'].includes(field)
    ? event.target.value.split(/[,，、\n]/u).map((item) => item.trim()).filter(Boolean)
    : event.target.value;
  setPill($('#entityEditState'), '保存中', 'warn');
  $('#entityEditFeedback').textContent = `正在保存 ${field}...`;
  try {
    await maeFetch('/entity', { method: 'POST', body: JSON.stringify({ chatId: chatId(), entityId: card.dataset.entityId, patch: { [field]: value } }) });
    setPill($('#entityEditState'), '已保存', 'ok');
    $('#entityEditFeedback').textContent = '实体细节已保存到当前会话。';
    await refresh();
  } catch (error) {
    setPill($('#entityEditState'), '保存失败', 'fail');
    $('#entityEditFeedback').textContent = error.message;
  }
}
function renderFacts(items) { $('#factsTable').innerHTML = items.length ? `<table><thead><tr><th>类别</th><th>事实</th><th>重要性</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.content)}</td><td>${Number(item.importance).toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">还没有事实。结构化事实会优先于自由文本总结。</p>'; }
function renderTimeline(items) { const html = items.length ? items.slice(0, 20).map((item) => `<article class="timeline-item"><strong>${escapeHtml(item.source)} · 第 ${item.turn_seq} 轮</strong><p>${escapeHtml(item.description)}</p><small>${escapeHtml(item.scene || '未标记场景')}</small></article>`).join('') : '<p class="muted">还没有时间线事件。</p>'; $('#timelinePreview').innerHTML = html; $('#timelineTable').innerHTML = html; }
function renderAudits(items) { $('#auditsTable').innerHTML = items.length ? `<table><thead><tr><th>结果</th><th>目标</th><th>违规</th><th>状态</th></tr></thead><tbody>${items.map((item) => `<tr><td class="${item.verdict === 'pass' ? 'good' : 'bad'}">${escapeHtml(item.verdict)}</td><td>${escapeHtml(item.target_type)}</td><td>${escapeHtml((item.violations || []).map((v) => v.reason).join('；') || '无')}</td><td>${escapeHtml(item.ticket_status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">还没有审计记录。</p>'; }
function renderWorldbook(value) { const entries = value?.entries || []; $('#worldbookPreview').innerHTML = entries.length ? entries.slice(0, 12).map((entry) => `<article class="worldbook-item"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml((entry.keys || []).join('、'))}</small><p>${escapeHtml(entry.content)}</p></article>`).join('') : '<p class="muted">还没有同步世界书。</p>'; }
function renderInjection() { const model = state.injection; if (!model) return; $('#injectionOutput').innerHTML = `<div class="injection-stats">档位 ${model.tier} · 预算 ${model.stats.budget} · 估算 ${model.stats.estimatedTokens} token</div>${model.blocks.map((block) => `<details open><summary>${escapeHtml(block.key)} · 优先级 ${block.priority}</summary><pre>${escapeHtml(block.text)}</pre></details>`).join('')}`; }
function renderAdvanced(snapshot) { const player = (snapshot.entities || []).find((item) => item.id === snapshot.meta?.['mae.player']); $('#advancedPlayer').textContent = player ? `当前玩家：${player.name} · ${player.status} · ${player.role || 'player'}` : '当前玩家：未登记'; if (!$('#physiologyRulesJson').value) $('#physiologyRulesJson').value = JSON.stringify(snapshot.meta?.['mae.physiology_rules'] || {}, null, 2); renderGaiden(snapshot.meta?.['mae.gaiden'] || []); }
function renderGaiden(items) { $('#advancedGaiden').innerHTML = items.length ? items.slice().sort((a, b) => Number(b.priority) - Number(a.priority) || Number(a.sequence) - Number(b.sequence)).map((item) => `<article class="worldbook-item"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.type)} · ${escapeHtml(item.status)} · 优先级 ${item.priority}</small><p>${escapeHtml(item.content || '等待模型处理。')}</p></article>`).join('') : '<p class="muted">还没有番外。</p>'; }

async function maeFetch(path, options = {}) { const response = await fetch(`${state.endpoint}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); return readResponse(response); }
async function readResponse(response) { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`); return data; }
function loadSettings() { const saved = JSON.parse(localStorage.getItem('mae-ui-settings') || '{}'); $('#chatId').value = saved.chatId || 'default'; if (saved.tier) $('#tier').value = saved.tier; }
function chatId() { const value = $('#chatId').value.trim() || 'default'; localStorage.setItem('mae-ui-settings', JSON.stringify({ chatId: value, tier: $('#tier').value })); return value; }
function readJsonArea(selector) { const element = $(selector); if (!element) return []; const value = element.value.trim(); if (!value) return []; try { return JSON.parse(value); } catch { return []; } }
function number(selector, fallback) { const value = Number($(selector).value); return Number.isFinite(value) ? value : fallback; }
function setPill(element, text, state) { element.textContent = text; element.className = `state-pill ${state || ''}`; }
function setBusy(selector, busy, text) { const button = $(selector); if (!button) return; if (!button.dataset.label) button.dataset.label = button.textContent; button.disabled = busy; button.textContent = busy ? text : button.dataset.label; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
