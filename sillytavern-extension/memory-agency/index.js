import {
  eventSource,
  event_types,
  extension_prompt_roles,
  extension_prompt_types,
  saveSettingsDebounced,
  setExtensionPrompt,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

const SETTINGS_KEY = 'memoryAgencyEngine';
const INTERCEPTOR_NAME = 'maeGenerationInterceptor';
const PANEL_ID = 'mae-panel';
const MENU_ID = 'mae-menu-button';
const DEFAULTS = Object.freeze({ endpoint: 'http://127.0.0.1:8787/api/mae', enabled: true, tier: 'medium', autoTick: true });
const state = { open: false, busy: false, lastMessageKey: '', snapshot: null, gaiden: [], error: '', editingEntityId: '' };

globalThis[INTERCEPTOR_NAME] = generationInterceptor;
init();

function init() {
  ensureSettings();
  createPanel();
  addMenuButtonWhenReady();
  const events = [event_types.CHAT_CHANGED, event_types.MESSAGE_RECEIVED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_EDITED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED, event_types.CHARACTER_MESSAGE_RENDERED].filter(Boolean);
  events.forEach((name) => eventSource.on(name, () => handleChatEvent(name)));
  eventSource.on(event_types.GENERATION_ENDED, () => processLatestAssistantMessage());
  refresh().catch((error) => setError(error));
}

function ensureSettings() {
  if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') extension_settings[SETTINGS_KEY] = { ...DEFAULTS };
  const settings = extension_settings[SETTINGS_KEY];
  Object.entries(DEFAULTS).forEach(([key, value]) => { if (settings[key] === undefined) settings[key] = value; });
  if (!/^https?:\/\//u.test(String(settings.endpoint))) settings.endpoint = DEFAULTS.endpoint;
  settings.enabled = settings.enabled !== false;
  settings.autoTick = settings.autoTick === true;
  settings.tier = ['light', 'medium', 'heavy'].includes(settings.tier) ? settings.tier : DEFAULTS.tier;
  return settings;
}

function createPanel() {
  if (document.getElementById(PANEL_ID)) return;
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'mae-st-panel mae-st-hidden';
  panel.innerHTML = `<div class="mae-st-shell"><header><div><span class="mae-st-kicker">MEMORY &amp; AUTONOMY ENGINE</span><h2>世界状态面板</h2><p>结构化记忆、主动注入和后台 NPC 动态。</p></div><button type="button" data-mae-action="close" aria-label="关闭">×</button></header><main id="mae-st-body"></main></div>`;
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('change', onPanelChange);
  panel.addEventListener('input', onPanelInput);
  document.body.appendChild(panel);
}

function addMenuButtonWhenReady() {
  const timer = setInterval(() => {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    clearInterval(timer);
    if (document.getElementById(MENU_ID)) return;
    const button = document.createElement('div');
    button.id = MENU_ID;
    button.className = 'list-group-item flex-container flexGap5';
    button.innerHTML = '<div class="fa-solid fa-brain extensionsMenuExtensionButton"></div><span>世界状态面板</span>';
    button.addEventListener('click', openPanel);
    menu.appendChild(button);
  }, 500);
}

async function generationInterceptor() {
  const settings = ensureSettings();
  if (!settings.enabled) return clearInjection();
  try {
    await syncRuntimeSettings();
    await syncCurrentWorldbook();
    const context = getContext();
    const response = await maeRequest('/injection', { method: 'POST', body: JSON.stringify({ chatId: chatId(), turnSeq: context.chat?.length || 0, contextText: recentText(), settings: { tier: settings.tier } }) });
    const assembled = response.injection?.assembled || {};
    clearInjection();
    if (assembled.top) setExtensionPrompt('mae-top', assembled.top, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
    if (assembled.mid) setExtensionPrompt('mae-mid', assembled.mid, extension_prompt_types.IN_CHAT, 5, false, extension_prompt_roles.SYSTEM);
    if (assembled.bottom) setExtensionPrompt('mae-bottom', assembled.bottom, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
    if (state.open) renderPanel(response.injection);
  } catch (error) {
    setError(error);
    clearInjection();
  }
}

async function processLatestAssistantMessage() {
  const settings = ensureSettings();
  if (!settings.enabled) return;
  const context = getContext();
  const messages = Array.isArray(context.chat) ? context.chat : [];
  const message = [...messages].reverse().find((item) => item && (item.is_user === false || item.role === 'assistant' || item.name === context.name2));
  if (!message) return;
  const key = `${chatId()}:${message.send_date || message.mes || message.text || messages.length}`;
  if (state.lastMessageKey === key) return;
  state.lastMessageKey = key;
  try {
    await syncRuntimeSettings();
    const result = await maeRequest('/turn', { method: 'POST', body: JSON.stringify({ chatId: chatId(), turnSeq: messages.length, text: messageText(message), role: 'assistant', messageId: key, entities: collectEntities(messages) }) });
    await refresh();
    if (settings.autoTick && result.tickDue) await maeRequest('/tick', { method: 'POST', body: JSON.stringify({ chatId: chatId() }) });
    if (result.deathResults?.some((item) => item.deceased && !item.already)) await refresh();
  } catch (error) { setError(error); }
}

async function handleChatEvent(name) {
  state.lastMessageKey = '';
  if (name === event_types.CHAT_CHANGED) {
    await syncRuntimeSettings();
    await syncCurrentWorldbook();
  }
  await refresh();
  if (state.open) renderPanel();
}

async function syncCurrentWorldbook() {
  const context = getContext();
  const character = context.characters?.[context.characterId];
  const data = character?.data || character;
  const book = data?.character_book;
  if (!book || !Array.isArray(book.entries)) return null;
  return maeRequest('/worldbook/sync', { method: 'POST', body: JSON.stringify({ chatId: chatId(), name: book.name || '', entries: book.entries }) });
}

async function syncRuntimeSettings() {
  const settings = ensureSettings();
  const tickEvery = settings.tier === 'heavy' ? 3 : settings.tier === 'medium' ? 8 : 0;
  return maeRequest('/settings', { method: 'POST', body: JSON.stringify({ chatId: chatId(), settings: { tier: settings.tier, enabled: settings.enabled, tickEvery } }) });
}

async function refresh() {
  const result = await maeRequest(`/session?chatId=${encodeURIComponent(chatId())}`);
  state.snapshot = result;
  if (state.open) renderPanel();
  return result;
}

function openPanel() { state.open = true; document.getElementById(PANEL_ID)?.classList.remove('mae-st-hidden'); renderPanel(); }
function closePanel() { state.open = false; document.getElementById(PANEL_ID)?.classList.add('mae-st-hidden'); }

async function onPanelClick(event) {
  const action = event.target.closest('[data-mae-action]')?.dataset.maeAction;
  if (action === 'close') return closePanel();
  if (action === 'refresh') return refresh().catch((error) => setError(error));
  if (action === 'tick') { state.busy = true; renderPanel(); try { await maeRequest('/tick', { method: 'POST', body: JSON.stringify({ chatId: chatId() }) }); await refresh(); } catch (error) { setError(error); } finally { state.busy = false; renderPanel(); } return; }
  if (action === 'gaiden') { state.busy = true; renderPanel(); try { const result = await maeRequest(`/gaiden?chatId=${encodeURIComponent(chatId())}`); state.gaiden = result.chapters || []; renderPanel(); } catch (error) { setError(error); } finally { state.busy = false; renderPanel(); } return; }
  if (action === 'successor') { return createSuccessorFromPrompt(); }
  if (action === 'edit-entity') { const card = event.target.closest('[data-mae-entity-id]'); state.editingEntityId = card?.dataset.maeEntityId || ''; renderPanel(); return; }
  if (action === 'save-entity') { const card = event.target.closest('[data-mae-entity-id]'); if (card) await saveEntity(card); return; }
  if (action === 'dashboard') { window.open(ensureSettings().endpoint.replace(/\/api\/mae$/u, ''), '_blank', 'noopener'); }
}

function onPanelChange(event) {
  const key = event.target.dataset.maeSetting;
  if (!key) return;
  const settings = ensureSettings();
  settings[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  saveSettingsDebounced();
  if (key === 'endpoint') refresh().catch((error) => setError(error));
  if (key === 'tier' || key === 'enabled') syncRuntimeSettings().catch((error) => setError(error));
  renderPanel();
}

function onPanelInput(event) { const field = event.target.dataset.maeEntityField; const card = event.target.closest('[data-mae-entity-id]'); if (!field || !card || card.dataset.maeEntityId !== state.editingEntityId) return; }

function renderPanel(injection) {
  const body = document.getElementById('mae-st-body');
  if (!body) return;
  const settings = ensureSettings();
  const snapshot = state.snapshot || {};
  const entities = snapshot.entities || [];
  const facts = snapshot.facts || [];
  const timeline = snapshot.timeline || [];
  const audits = snapshot.audits || [];
  const playerId = snapshot.meta?.['mae.player'];
  const player = entities.find((entity) => entity.id === playerId);
  const physiology = snapshot.meta?.['mae.physiology'] || {};
  const chapters = state.gaiden.length ? state.gaiden : snapshot.meta?.['mae.gaiden'] || [];
  const successorButton = player?.status === 'deceased' ? '<button data-mae-action="successor">创建继任者</button>' : '';
  body.innerHTML = `<section class="mae-st-settings"><div class="mae-st-row"><label>服务地址<input data-mae-setting="endpoint" value="${escapeAttr(settings.endpoint)}"></label><label>档位<select data-mae-setting="tier"><option value="light" ${settings.tier === 'light' ? 'selected' : ''}>轻</option><option value="medium" ${settings.tier === 'medium' ? 'selected' : ''}>中</option><option value="heavy" ${settings.tier === 'heavy' ? 'selected' : ''}>重</option></select></label></div><label class="mae-st-check"><input type="checkbox" data-mae-setting="enabled" ${settings.enabled ? 'checked' : ''}>启用生成前主动注入</label><label class="mae-st-check"><input type="checkbox" data-mae-setting="autoTick" ${settings.autoTick ? 'checked' : ''}>生成结束后运行后台 tick</label></section><section class="mae-st-actions"><button data-mae-action="refresh">刷新</button><button data-mae-action="tick" ${state.busy ? 'disabled' : ''}>运行 tick</button><button data-mae-action="gaiden" ${state.busy ? 'disabled' : ''}>查看番外队列</button>${successorButton}<button data-mae-action="dashboard">打开本地控制台</button></section><section class="mae-st-stats"><div><strong>${entities.length}</strong><span>实体</span></div><div><strong>${facts.length}</strong><span>事实</span></div><div><strong>${timeline.length}</strong><span>事件</span></div><div><strong>${audits.filter((item) => item.verdict === 'fail').length}</strong><span>待处理审计</span></div></section><section><h3>当前玩家</h3><article class="mae-st-card">${player ? `<strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.role || 'player')} · ${escapeHtml(player.status)}</span><p>${escapeHtml(player.current_state || '状态未知')}</p>` : '<p class="mae-st-muted">尚未登记玩家实体。</p>'}</article></section><section><h3>实体明细</h3>${entities.map((entity) => renderEntityPanel(entity, physiology[entity.id])).join('') || '<p class="mae-st-muted">暂无实体。</p>'}</section><section><h3>最近后台动态</h3>${timeline.slice(0, 5).map((event) => `<article class="mae-st-event"><strong>${escapeHtml(event.source)} · 第 ${event.turn_seq} 轮</strong><p>${escapeHtml(event.description)}</p></article>`).join('') || '<p class="mae-st-muted">暂无动态。</p>'}</section><section><h3>番外队列</h3>${chapters.slice(0, 5).map((chapter) => `<article class="mae-st-event"><strong>${escapeHtml(chapter.type)} · ${escapeHtml(chapter.status)}</strong><p>${escapeHtml(chapter.title)}${chapter.content ? `：${escapeHtml(chapter.content)}` : ''}</p></article>`).join('') || '<p class="mae-st-muted">暂无番外。</p>'}</section>${injection ? `<section><h3>本次注入</h3><pre class="mae-st-pre">${escapeHtml([injection.assembled?.top, injection.assembled?.mid, injection.assembled?.bottom].filter(Boolean).join('\n\n'))}</pre></section>` : ''}${state.error ? `<p class="mae-st-error">${escapeHtml(state.error)}</p>` : ''}`;
}

async function createSuccessorFromPrompt() {
  const snapshot = state.snapshot || {};
  const deceasedId = snapshot.meta?.['mae.player'];
  const deceased = (snapshot.entities || []).find((entity) => entity.id === deceasedId && entity.status === 'deceased');
  if (!deceased) return setError('当前没有等待继任的已死亡玩家。');
  const name = window.prompt('继任者姓名');
  if (!name?.trim()) return;
  const relation = window.prompt('与死者的关系', '故人之后') || '故人之后';
  const identity = window.prompt('继任者身份', '继承遗产的新居民') || '继承遗产的新居民';
  try { await maeRequest('/successor', { method: 'POST', body: JSON.stringify({ chatId: chatId(), deceasedId, name, relation, identity, turnSeq: getContext().chat?.length || 0 }) }); await refresh(); } catch (error) { setError(error); }
}

function renderEntityPanel(entity, physiology) {
  const list = (value) => Array.isArray(value) ? value.join('、') : String(value || '');
  const editing = state.editingEntityId === entity.id;
  return `<article class="mae-st-card" data-mae-entity-id="${escapeAttr(entity.id)}"><div class="mae-st-card-head"><div><strong>${escapeHtml(entity.name || '未命名实体')}</strong><span>${escapeHtml(entity.type || 'npc')} · ${escapeHtml(entity.id)}</span></div><button type="button" data-mae-action="edit-entity">${editing ? '收起编辑' : '编辑详情'}</button></div><p>${escapeHtml(entity.current_state || entity.introduction || '状态未知')}${physiology ? ` · ${escapeHtml(renderPhysiologyText(physiology))}` : ''}</p>${editing ? `<div class="mae-st-entity-fields"><label>名称<input data-mae-entity-field="name" value="${escapeAttr(entity.name)}"></label><label>类型<input data-mae-entity-field="type" value="${escapeAttr(entity.type)}"></label><label>状态<input data-mae-entity-field="status" value="${escapeAttr(entity.status)}"></label><label>地点<input data-mae-entity-field="location" value="${escapeAttr(entity.location)}"></label><label class="mae-st-full">简介<textarea data-mae-entity-field="introduction" rows="2">${escapeHtml(entity.introduction || '')}</textarea></label><label class="mae-st-full">个性<textarea data-mae-entity-field="personality" rows="2">${escapeHtml(entity.personality || '')}</textarea></label><label class="mae-st-full">行为<textarea data-mae-entity-field="behaviors" rows="2">${escapeHtml(list(entity.behaviors))}</textarea></label><label class="mae-st-full">物品<textarea data-mae-entity-field="inventory" rows="2">${escapeHtml(list(entity.inventory))}</textarea></label><label class="mae-st-full">目标<textarea data-mae-entity-field="goals" rows="2">${escapeHtml(list(entity.goals))}</textarea></label><button type="button" data-mae-action="save-entity">保存实体</button></div>` : ''}</article>`;
}

async function saveEntity(card) {
  const patch = {};
  for (const input of card.querySelectorAll('[data-mae-entity-field]')) {
    const field = input.dataset.maeEntityField;
    if (!field) continue;
    patch[field] = ['behaviors', 'inventory', 'goals'].includes(field) ? String(input.value).split(/[,，、\n]/u).map((item) => item.trim()).filter(Boolean) : input.value;
  }
  try { await maeRequest('/entity', { method: 'POST', body: JSON.stringify({ chatId: chatId(), entityId: card.dataset.maeEntityId, patch }) }); state.editingEntityId = ''; await refresh(); } catch (error) { setError(error); }
}
function renderPhysiologyText(value) {
  const parts = [];
  if (value.pregnancy) parts.push('孕期');
  if (value.injury?.length) parts.push(`伤势${value.injury.length}`);
  if (value.addiction) parts.push('成瘾');
  if (value.disease?.length) parts.push('疾病');
  return parts.join('、') || '无特殊生理状态';
}

function clearInjection() {
  setExtensionPrompt('mae-top', '', extension_prompt_types.IN_PROMPT, 0);
  setExtensionPrompt('mae-mid', '', extension_prompt_types.IN_CHAT, 5);
  setExtensionPrompt('mae-bottom', '', extension_prompt_types.IN_PROMPT, 0);
}

async function maeRequest(path, options = {}) {
  const endpoint = ensureSettings().endpoint.replace(/\/$/u, '');
  const response = await fetch(`${endpoint}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `MAE 请求失败：${response.status}`);
  return body;
}

function chatId() { const context = getContext(); return String(context.chatId || context.chatMetadata?.chat_id || context.groupId || `character-${context.characterId ?? 'default'}`); }
function recentText() { const chat = getContext().chat || []; return chat.slice(-12).map((message) => `${message?.name || message?.role || 'message'}: ${messageText(message)}`).join('\n'); }
function messageText(message) { return String(message?.mes || message?.text || message?.content || '').replace(/<[^>]+>/gu, ' ').trim(); }
function collectEntities(messages) { const names = new Map(); messages.slice(-20).forEach((message) => { const name = String(message?.name || '').trim(); if (name && !['user', 'system'].includes(name.toLowerCase())) names.set(name, { name, type: message.is_user ? 'main' : 'npc', current_state: messageText(message).slice(0, 160) }); }); return [...names.values()]; }
function setError(error) { state.error = error?.message || String(error); if (state.open) renderPanel(); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
