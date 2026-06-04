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

export function renderRegexPreview(preview) {
  const output = preview?.regexPreview?.output || '';
  $('#regexPreviewOutput').textContent = output || '暂无正则预览。';
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
