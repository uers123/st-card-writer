import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';

const MODULE_ID = 'st-card-writer-viewer';
const PANEL_ID = 'stcwv-panel';
const MENU_BUTTON_ID = 'stcwv-menu-button';
const DROPDOWN_OPTION_ID = 'stcwv-char-menu-option';

const state = {
  open: false,
  activeGroup: 'all',
  search: '',
};

init();

function init() {
  addMenuButtonWhenReady();
  addCharacterMenuOptionWhenReady();
  createPanel();
  bindEvents();
  refreshButtonState();
}

function bindEvents() {
  [
    event_types.CHAT_CHANGED,
    event_types.MESSAGE_RECEIVED,
    event_types.MESSAGE_UPDATED,
    event_types.MESSAGE_EDITED,
    event_types.MESSAGE_DELETED,
    event_types.CHARACTER_MESSAGE_RENDERED,
    event_types.CHARACTER_EDITED,
  ].filter(Boolean).forEach((eventName) => {
    eventSource.on(eventName, () => {
      refreshButtonState();
      if (state.open) renderPanel();
    });
  });
}

function addMenuButtonWhenReady() {
  const timer = setInterval(() => {
    const container = document.getElementById('extensionsMenu');
    if (!container || document.getElementById(MENU_BUTTON_ID)) return;
    clearInterval(timer);

    const button = document.createElement('div');
    button.id = MENU_BUTTON_ID;
    button.classList.add('list-group-item', 'flex-container', 'flexGap5');
    button.title = '打开世界书卡互动视图';
    button.innerHTML = '<div class="fa-solid fa-table-list extensionsMenuExtensionButton"></div><span>世界书卡视图</span>';
    button.addEventListener('click', openPanel);
    container.appendChild(button);
    refreshButtonState();
  }, 500);
}

function addCharacterMenuOptionWhenReady() {
  const timer = setInterval(() => {
    const select = document.getElementById('char-management-dropdown');
    if (!select || document.getElementById(DROPDOWN_OPTION_ID)) return;
    clearInterval(timer);

    const option = document.createElement('option');
    option.id = DROPDOWN_OPTION_ID;
    option.value = 'st_card_writer_viewer';
    option.textContent = '世界书卡视图';
    select.appendChild(option);
    select.addEventListener('change', () => {
      if (select.value === option.value) {
        openPanel();
        select.value = '';
      }
    });
  }, 500);
}

function createPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'stcwv-panel stcwv-hidden';
  panel.innerHTML = `
    <div class="stcwv-shell">
      <header class="stcwv-header">
        <div>
          <h2>世界书卡视图</h2>
          <p>读取当前角色卡内嵌世界书，并根据聊天内容刷新触发状态。</p>
        </div>
        <button type="button" class="stcwv-close" aria-label="关闭">×</button>
      </header>
      <div class="stcwv-body"></div>
    </div>
  `;
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('input', onPanelInput);
  document.body.appendChild(panel);
}

function openPanel() {
  state.open = true;
  document.getElementById(PANEL_ID)?.classList.remove('stcwv-hidden');
  renderPanel();
}

function closePanel() {
  state.open = false;
  document.getElementById(PANEL_ID)?.classList.add('stcwv-hidden');
}

function onPanelClick(event) {
  if (event.target.closest('.stcwv-close')) {
    closePanel();
    return;
  }

  const groupButton = event.target.closest('[data-stcwv-group]');
  if (groupButton) {
    state.activeGroup = groupButton.dataset.stcwvGroup || 'all';
    renderPanel();
  }
}

function onPanelInput(event) {
  if (event.target.id === 'stcwv-search') {
    state.search = event.target.value;
    renderPanel();
  }
}

function renderPanel() {
  const body = document.querySelector(`#${PANEL_ID} .stcwv-body`);
  if (!body) return;

  const data = getWorldbookData();
  if (!data) {
    body.innerHTML = `
      <div class="stcwv-empty">
        <h3>当前角色不是 st-card-writer 世界书卡</h3>
        <p>需要角色卡内存在 <code>data.character_book</code>，并带有 <code>data.extensions.st_card_writer.kind = "worldbook-card"</code>。</p>
      </div>
    `;
    return;
  }

  const triggerState = computeTriggerState(data.entries);
  const groups = ['all', ...Array.from(new Set(data.entries.map((entry) => entry.group || 'Core')))];
  const visibleEntries = filterEntries(data.entries, triggerState);

  body.innerHTML = `
    <section class="stcwv-hero">
      <div class="stcwv-cover">${renderImageOrText(data.meta.render?.coverImageUrl, initials(data.name))}</div>
      <div>
        <h3>${escapeHtml(data.name)}</h3>
        <p>${escapeHtml(data.description || '无简介')}</p>
        <div class="stcwv-stats">
          <span>${data.entries.length} 条目</span>
          <span>${groups.length - 1} 分组</span>
          <span>${triggerState.triggered.length} 已触发</span>
          <span>${triggerState.recent.length} 最近触发</span>
        </div>
      </div>
    </section>

    <section class="stcwv-toolbar">
      <input id="stcwv-search" type="search" value="${escapeAttr(state.search)}" placeholder="搜索标题、关键词、正文">
      <div class="stcwv-groups">
        ${groups.map((group) => `
          <button type="button" data-stcwv-group="${escapeAttr(group)}" class="${state.activeGroup === group ? 'active' : ''}">
            ${escapeHtml(group === 'all' ? '全部' : group)}
          </button>
        `).join('')}
      </div>
    </section>

    <section class="stcwv-recent">
      <h4>最近触发</h4>
      ${triggerState.recent.length ? triggerState.recent.map((item) => `
        <div class="stcwv-recent-item">
          <strong>${escapeHtml(item.entry.title)}</strong>
          <span>${escapeHtml(item.keywords.join(', '))}</span>
        </div>
      `).join('') : '<p>当前聊天尚未触发这些关键词。</p>'}
    </section>

    <section class="stcwv-table-wrap">
      <table class="stcwv-table">
        <thead>
          <tr>
            <th>条目</th>
            <th>关键词</th>
            <th>分组</th>
            <th>状态</th>
            <th>出现</th>
          </tr>
        </thead>
        <tbody>
          ${visibleEntries.map((entry) => renderEntryRow(entry, triggerState)).join('')}
        </tbody>
      </table>
    </section>

    <section class="stcwv-card-grid">
      ${visibleEntries.map((entry) => renderEntryCard(entry, triggerState)).join('')}
    </section>
  `;
}

function renderEntryRow(entry, triggerState) {
  const stat = triggerState.byId.get(entry.id) || { count: 0, recent: false, keywords: [] };
  return `
    <tr class="${stat.recent ? 'recent' : ''}">
      <td>${escapeHtml(entry.title)}</td>
      <td>${entry.keys.map((key) => `<span class="stcwv-key">${escapeHtml(key)}</span>`).join('')}</td>
      <td>${escapeHtml(entry.group)}</td>
      <td>${entry.enabled ? '启用' : '禁用'}${stat.recent ? ' · 最近触发' : ''}</td>
      <td>${stat.count}</td>
    </tr>
  `;
}

function renderEntryCard(entry, triggerState) {
  const stat = triggerState.byId.get(entry.id) || { count: 0, recent: false, keywords: [] };
  return `
    <article class="stcwv-card ${entry.enabled ? '' : 'disabled'} ${stat.recent ? 'recent' : ''}" style="--entry-color:${escapeAttr(entry.color || '#24b47e')}">
      <div class="stcwv-thumb">${renderImageOrText(entry.imageUrl, entry.placeholder || initials(entry.title))}</div>
      <div class="stcwv-card-body">
        <h4>${escapeHtml(entry.title)}</h4>
        <p>${escapeHtml(entry.content || '无正文')}</p>
        <div class="stcwv-key-row">${entry.keys.map((key) => `<span class="stcwv-key">${escapeHtml(key)}</span>`).join('')}</div>
        <small>${escapeHtml(entry.group)} · ${entry.enabled ? '启用' : '禁用'} · 出现 ${stat.count}</small>
      </div>
    </article>
  `;
}

function refreshButtonState() {
  const button = document.getElementById(MENU_BUTTON_ID);
  if (!button) return;
  const active = Boolean(getWorldbookData());
  button.classList.toggle('stcwv-button-active', active);
  button.title = active ? '打开世界书卡互动视图' : '当前角色没有 st-card-writer 世界书卡元数据';
}

function getWorldbookData() {
  const context = getContext();
  const character = context.characters?.[context.characterId];
  const data = character?.data || character;
  const book = data?.character_book;
  const meta = data?.extensions?.st_card_writer;
  const hasWriterMeta = meta?.kind === 'worldbook-card' || book?.extensions?.st_card_writer?.kind === 'worldbook-card';
  if (!book || !Array.isArray(book.entries) || !hasWriterMeta) return null;

  return {
    name: book.name || data.name || character.name || 'Worldbook',
    description: book.description || data.description || '',
    meta: meta || book.extensions?.st_card_writer || {},
    entries: book.entries.map(normalizeEntry),
  };
}

function normalizeEntry(entry, index) {
  const meta = entry.extensions?.st_card_writer || {};
  const visual = meta.visual || {};
  return {
    id: entry.id ?? index,
    title: entry.comment || meta.title || `Entry ${index + 1}`,
    keys: Array.isArray(entry.keys) ? entry.keys.map(String).filter(Boolean) : [],
    secondaryKeys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys.map(String).filter(Boolean) : [],
    content: String(entry.content || ''),
    group: entry.extensions?.group || meta.group || 'Core',
    enabled: entry.enabled !== false,
    position: entry.extensions?.position ?? entry.position,
    imageUrl: meta.imageUrl || visual.imageUrl || '',
    placeholder: meta.placeholder || visual.placeholder || '',
    color: meta.color || visual.color || '#24b47e',
  };
}

function computeTriggerState(entries) {
  const context = getContext();
  const messages = Array.isArray(context.chat) ? context.chat : [];
  const allText = messages.map(messageText).join('\n').toLowerCase();
  const recentText = messages.slice(-6).map(messageText).join('\n').toLowerCase();
  const byId = new Map();
  const triggered = [];
  const recent = [];

  for (const entry of entries) {
    const keywords = [...entry.keys, ...entry.secondaryKeys].filter(Boolean);
    const matched = keywords.filter((key) => allText.includes(key.toLowerCase()));
    const recentMatched = keywords.filter((key) => recentText.includes(key.toLowerCase()));
    const count = keywords.reduce((sum, key) => sum + countOccurrences(allText, key.toLowerCase()), 0);
    const stat = { count, recent: recentMatched.length > 0, keywords: matched };
    byId.set(entry.id, stat);
    if (matched.length) triggered.push({ entry, keywords: matched, count });
    if (recentMatched.length) recent.push({ entry, keywords: recentMatched, count });
  }

  return { byId, triggered, recent };
}

function filterEntries(entries, triggerState) {
  const query = state.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (state.activeGroup !== 'all' && entry.group !== state.activeGroup) return false;
    if (!query) return true;
    const stat = triggerState.byId.get(entry.id);
    const haystack = [
      entry.title,
      entry.group,
      entry.content,
      ...entry.keys,
      ...entry.secondaryKeys,
      ...(stat?.keywords || []),
    ].join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

function messageText(message) {
  const raw = message?.mes || message?.text || message?.content || '';
  return String(raw).replace(/<[^>]+>/g, ' ');
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += Math.max(needle.length, 1);
  }
  return count;
}

function renderImageOrText(url, text) {
  if (url) return `<img src="${escapeAttr(url)}" alt="">`;
  return escapeHtml(text || 'WB');
}

function initials(value) {
  return String(value || 'WB').split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join('') || 'WB';
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
