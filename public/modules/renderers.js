import {
  $,
  escapeAttr,
  escapeHtml,
  initials,
  positionOptions,
  renderImageOrText,
} from './ui.js';

export function renderPresetFeedback(analyses) {
  if (analyses.length === 0) {
    $('#presetFeedback').textContent = '尚未导入预设。';
    return;
  }

  $('#presetFeedback').innerHTML = analyses.map((item) => `
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

export function renderPlanOutline(plan) {
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  if (entries.length === 0) {
    $('#planOutline').innerHTML = '<div class="feedback muted">暂无大纲条目。AI 生成 Plan 后可在这里删改。</div>';
    return;
  }

  $('#planOutline').innerHTML = entries.map((entry, index) => `
    <div class="outline-item plan-outline-editor" data-plan-entry-index="${index}">
      <div class="plan-outline-head">
        <strong>条目 ${index + 1}</strong>
        <button type="button" class="danger-button" data-plan-delete-index="${index}">删除</button>
      </div>
      <div class="plan-outline-grid">
        <label>标题<input data-plan-field="title" type="text" value="${escapeAttr(entry.title || '')}"></label>
        <label>分组<input data-plan-field="group" type="text" value="${escapeAttr(entry.group || 'Core')}"></label>
        <label class="full">关键词<input data-plan-field="keys" type="text" value="${escapeAttr(planKeysText(entry))}"></label>
        <label class="full">用途<textarea data-plan-field="purpose" rows="3">${escapeHtml(entry.purpose || '')}</textarea></label>
      </div>
    </div>
  `).join('');
}

export function renderEntryList(entries, selectedEntryId) {
  if (entries.length === 0) {
    $('#entryList').innerHTML = '<div class="feedback muted">暂无条目。AI 生成后会出现在这里。</div>';
    return;
  }

  $('#entryList').innerHTML = entries.map((entry) => `
    <button type="button" data-entry-id="${entry.id}" class="${entry.id === selectedEntryId ? 'active' : ''}">
      ${escapeHtml(entry.title || '未命名条目')}
      <small>${escapeHtml(entry.group || 'Core')} · ${entry.keys?.length || 0} 关键词</small>
    </button>
  `).join('');
}

export function renderEntryEditor(entry, onDelete) {
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
  $('#deleteEntryBtn').addEventListener('click', onDelete);
}

export function renderPreview(preview) {
  if (!preview) {
    $('#renderPreview').innerHTML = '<div class="feedback muted">生成、导入或编辑后，会显示导入 SillyTavern 后的扩展渲染反馈。</div>';
    return;
  }

  const header = preview.header || {};
  const accent = header.accentColor || '#24b47e';
  const entries = Array.isArray(preview.entries) ? preview.entries : [];
  const groups = Array.isArray(preview.groups) ? preview.groups : [];
  const triggerState = computePreviewTriggerState(entries, preview.regexPreview?.output || '');
  const groupNames = ['全部', ...groups.map((group) => group.name)];
  $('#renderPreview').innerHTML = `
    <article class="st-preview-shell" style="--accent:${escapeAttr(accent)}">
      <header class="st-preview-header">
        <div>
          <h3>世界书卡视图</h3>
          <p>导入 SillyTavern 后，由第三方扩展读取 <code>data.character_book</code> 和 <code>extensions.st_card_writer</code> 渲染。</p>
        </div>
        <span class="state-pill ok">扩展可识别</span>
      </header>

      <section class="st-preview-hero">
        <div class="st-preview-cover">${renderImageOrText(header.coverImageUrl, initials(header.name || 'WB'))}</div>
        <div>
          <h4>${escapeHtml(header.name || '未命名世界书')}</h4>
          <p>${escapeHtml(header.subtitle || '')}</p>
          <div class="st-preview-stats">
            <span>${preview.metrics?.entries || 0} 条目</span>
            <span>${preview.metrics?.groups || 0} 分组</span>
            <span>${triggerState.triggered.length} 已触发</span>
            <span>${triggerState.recent.length} 最近触发</span>
            <span>${preview.metrics?.estimatedTokens || 0} tokens</span>
          </div>
          <div class="tag-row">${(preview.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
        </div>
      </section>

      <section class="st-preview-toolbar">
        <input type="search" value="" placeholder="SillyTavern 内可搜索标题、关键词、正文" disabled>
        <div class="st-preview-groups">
          ${groupNames.map((group, index) => `<button type="button" class="${index === 0 ? 'active' : ''}" disabled>${escapeHtml(group)}</button>`).join('')}
        </div>
      </section>

      <section class="st-preview-recent">
        <h4>最近触发</h4>
        ${renderRecentTriggers(triggerState.recent)}
      </section>

      <section class="st-preview-table-wrap">
        <table class="st-preview-table">
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
            ${entries.map((entry) => renderStPreviewRow(entry, triggerState)).join('')}
          </tbody>
        </table>
      </section>

      <section class="st-preview-card-grid">
        ${entries.length ? entries.map((entry) => renderStPreviewCard(entry, triggerState)).join('') : '<div class="feedback muted">暂无世界书条目。</div>'}
      </section>

      <section class="st-preview-import-fields">
        ${renderPreviewSections(preview.sections || [])}
      </section>
    </article>
  `;
}

export function renderRegexPreview(preview) {
  const output = preview?.regexPreview?.output || '';
  $('#regexPreviewOutput').textContent = output || '暂无正则预览。';
}

function renderRecentTriggers(recent) {
  if (!recent.length) {
    return '<p class="muted">在“检查、正则与导出”界面输入测试聊天文本后，这里会根据关键词显示最近触发。</p>';
  }

  return recent.map((item) => `
    <div class="st-preview-recent-item">
      <strong>${escapeHtml(item.entry.title)}</strong>
      <span>${escapeHtml(item.keywords.join(', '))}</span>
    </div>
  `).join('');
}

function renderStPreviewRow(entry, triggerState) {
  const stat = triggerState.byId.get(entry.id) || { count: 0, recent: false };
  return `
    <tr class="${stat.recent ? 'recent' : ''}">
      <td>${escapeHtml(entry.title)}</td>
      <td>${(entry.keys || []).map((key) => `<span class="keyword">${escapeHtml(key)}</span>`).join('')}</td>
      <td>${escapeHtml(entry.group || 'Core')}</td>
      <td>${entry.enabled ? '启用' : '禁用'}${stat.recent ? ' · 最近触发' : ''}</td>
      <td>${stat.count}</td>
    </tr>
  `;
}

function renderStPreviewCard(entry, triggerState) {
  const stat = triggerState.byId.get(entry.id) || { count: 0, recent: false };
  return `
    <article class="st-preview-entry ${entry.enabled ? '' : 'disabled-entry'} ${stat.recent ? 'recent' : ''}" style="--entry-color:${escapeAttr(entry.color || '#24b47e')}">
      <div class="entry-thumb">${renderImageOrText(entry.imageUrl, entry.placeholder || initials(entry.title))}</div>
      <div class="entry-meta">
        <h4>${escapeHtml(entry.title)}</h4>
        <p>${escapeHtml(entry.content || '无正文')}</p>
        <div class="keyword-row">${(entry.keys || []).map((key) => `<span class="keyword">${escapeHtml(key)}</span>`).join('')}</div>
        <small>${escapeHtml(entry.group || 'Core')} · ${entry.enabled ? '启用' : '禁用'} · 出现 ${stat.count}</small>
      </div>
    </article>
  `;
}

function computePreviewTriggerState(entries, sourceText) {
  const text = String(sourceText || '').toLowerCase();
  const recentText = text.split(/\n+/).slice(-8).join('\n');
  const byId = new Map();
  const triggered = [];
  const recent = [];

  for (const entry of entries) {
    const keywords = [...(entry.keys || []), ...(entry.secondaryKeys || [])].filter(Boolean);
    const matched = keywords.filter((key) => text.includes(String(key).toLowerCase()));
    const recentMatched = keywords.filter((key) => recentText.includes(String(key).toLowerCase()));
    const count = keywords.reduce((sum, key) => sum + countOccurrences(text, String(key).toLowerCase()), 0);
    const stat = { count, recent: recentMatched.length > 0, keywords: matched };
    byId.set(entry.id, stat);
    if (matched.length) triggered.push({ entry, keywords: matched, count });
    if (recentMatched.length) recent.push({ entry, keywords: recentMatched, count });
  }

  return { byId, triggered, recent };
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

export function renderValidation(result) {
  const lines = [];
  lines.push(`<div class="${result.valid ? 'ok' : 'error'}">${result.valid ? '可以导入。' : '暂不能导入。'}</div>`);
  for (const error of result.errors || []) lines.push(`<div class="error">${escapeHtml(error)}</div>`);
  for (const warning of result.warnings || []) lines.push(`<div class="warning">${escapeHtml(warning)}</div>`);
  $('#validationOutput').innerHTML = `<div class="message-list">${lines.join('')}</div>`;
}

export function renderConnectionFeedback(result) {
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

function planKeysText(entry) {
  if (Array.isArray(entry?.keys)) return entry.keys.join(', ');
  return entry?.keys ? String(entry.keys) : '';
}
