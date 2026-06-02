const state = {
  card: null,
  presets: {},
  regexScripts: [],
  lastRegexPreview: '',
  embedRegex: true,
};

const fields = [
  'name',
  'creator',
  'character_version',
  'tags',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'system_prompt',
  'post_history_instructions',
  'creator_notes',
  'alternate_greetings',
];

const placementLabels = [
  [1, '用户输入'],
  [2, 'AI 输出'],
  [3, 'Slash'],
  [5, '世界书'],
  [6, '推理'],
];

await init();

async function init() {
  const empty = await api('/api/empty-card');
  state.card = empty.card;
  state.regexScripts = state.card.data.extensions.regex_scripts || [];
  bindEvents();
  fillEditors();
  renderPresetStatus();
  await refreshPreview();
}

function bindEvents() {
  document.getElementById('themeSelect').addEventListener('change', (event) => {
    document.body.dataset.theme = event.target.value;
    refreshPreview();
  });

  for (const field of fields) {
    document.querySelector(`[data-field="${field}"]`).addEventListener('input', syncFieldFromInput);
  }

  document.querySelectorAll('[data-preset]').forEach((input) => {
    input.addEventListener('change', importPreset);
  });

  document.getElementById('generateButton').addEventListener('click', generateCard);
  document.getElementById('sampleButton').addEventListener('click', fillSample);
  document.getElementById('validateButton').addEventListener('click', validateAll);
  document.getElementById('addRegexButton').addEventListener('click', addRegex);
  document.getElementById('regexTestText').addEventListener('input', refreshPreview);
  document.getElementById('exportCardButton').addEventListener('click', () => exportFiles('card'));
  document.getElementById('exportRegexButton').addEventListener('click', () => exportFiles('regex'));
  document.getElementById('copyCardButton').addEventListener('click', copyCardJson);
  document.getElementById('copyRegexPreviewButton').addEventListener('click', copyRegexPreview);
}

function fillEditors() {
  const data = state.card.data;
  for (const field of fields) {
    const element = document.querySelector(`[data-field="${field}"]`);
    if (field === 'tags') {
      element.value = data.tags.join(', ');
    } else if (field === 'alternate_greetings') {
      element.value = data.alternate_greetings.join('\n');
    } else {
      element.value = data[field] || '';
    }
  }
  renderRegexEditor();
}

function syncFieldFromInput(event) {
  const field = event.target.dataset.field;
  const value = event.target.value;
  if (field === 'tags') {
    state.card.data.tags = splitComma(value);
  } else if (field === 'alternate_greetings') {
    state.card.data.alternate_greetings = value.split('\n').map((item) => item.trim()).filter(Boolean);
  } else {
    state.card.data[field] = value;
  }
  mirrorLegacyFields();
  refreshPreview();
}

function mirrorLegacyFields() {
  const data = state.card.data;
  Object.assign(state.card, {
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    creatorcomment: data.creator_notes,
    tags: data.tags,
    talkativeness: data.extensions.talkativeness ?? 0.5,
  });
}

async function importPreset(event) {
  const file = event.target.files?.[0];
  const type = event.target.dataset.preset;
  if (!file) return;
  try {
    state.presets[type] = JSON.parse(await file.text());
    toast(`${type} 预设已载入`);
  } catch (error) {
    toast(`预设 JSON 无效：${error.message}`);
  } finally {
    event.target.value = '';
    renderPresetStatus();
  }
}

async function generateCard() {
  const body = {
    api: {
      baseUrl: document.getElementById('baseUrl').value,
      apiKey: document.getElementById('apiKey').value,
      model: document.getElementById('model').value,
    },
    generation: {
      temperature: Number(document.getElementById('temperature').value),
      maxTokens: Number(document.getElementById('maxTokens').value),
    },
    presets: state.presets,
    brief: document.getElementById('brief').value,
  };

  try {
    setBusy(true);
    const result = await api('/api/generate-card', body);
    state.card = result.card;
    state.regexScripts = result.regexScripts || [];
    state.card.data.extensions.regex_scripts = state.regexScripts;
    fillEditors();
    setValidation(result.validation);
    await refreshPreview();
    toast('角色卡已生成');
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function fillSample() {
  state.regexScripts = [{
    id: crypto.randomUUID(),
    scriptName: '去除角色名前缀',
    findRegex: '/^\\s*[^:：]{1,20}[:：]\\s*/g',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  }];
  state.card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    name: '林澈',
    description: '一位在旧城区经营夜间修表铺的年轻人，擅长把破损机械修到能再次发出细微而稳定的声音。',
    personality: '克制、敏锐、耐心，习惯先观察再开口。对承诺极其认真，但不轻易展示脆弱。',
    scenario: '故事发生在常年细雨的港口旧城。用户因为一块停走的怀表来到他的店里，却发现怀表背后藏着一段未寄出的旧信。',
    first_mes: '雨声贴着窗玻璃往下滑。林澈抬起头，指尖还停在一枚细小齿轮旁。\n\n“这块表不是今天才停的。”他看向你掌心里的怀表，“你想修的是时间，还是里面那封信？”',
    mes_example: '<START>\n{{user}}: 你怎么知道里面有信？\n{{char}}: “因为它太轻了。”林澈合上放大镜，语气平稳，“真正被珍惜的东西，通常会被藏得更小。”',
    creatorcomment: '适合悬疑、治愈、慢节奏角色扮演。',
    avatar: 'none',
    chat: '林澈 - New Chat',
    talkativeness: 0.5,
    fav: false,
    tags: ['悬疑', '治愈', '旧城', '慢热'],
    create_date: new Date().toISOString(),
    data: {
      name: '林澈',
      description: '一位在旧城区经营夜间修表铺的年轻人，擅长把破损机械修到能再次发出细微而稳定的声音。',
      personality: '克制、敏锐、耐心，习惯先观察再开口。对承诺极其认真，但不轻易展示脆弱。',
      scenario: '故事发生在常年细雨的港口旧城。用户因为一块停走的怀表来到他的店里，却发现怀表背后藏着一段未寄出的旧信。',
      first_mes: '雨声贴着窗玻璃往下滑。林澈抬起头，指尖还停在一枚细小齿轮旁。\n\n“这块表不是今天才停的。”他看向你掌心里的怀表，“你想修的是时间，还是里面那封信？”',
      mes_example: '<START>\n{{user}}: 你怎么知道里面有信？\n{{char}}: “因为它太轻了。”林澈合上放大镜，语气平稳，“真正被珍惜的东西，通常会被藏得更小。”',
      creator_notes: '适合悬疑、治愈、慢节奏角色扮演。',
      system_prompt: '保持细腻、克制、沉浸式叙事。不要替 {{user}} 行动或发言。',
      post_history_instructions: '延续当前场景，不重复上一条回复的句子。',
      alternate_greetings: ['林澈没有立刻接过怀表，只是把桌灯调亮了一格。'],
      tags: ['悬疑', '治愈', '旧城', '慢热'],
      creator: 'st-card-writer',
      character_version: '1.0.0',
      extensions: {
        talkativeness: 0.5,
        fav: false,
        world: '',
        depth_prompt: { prompt: '', depth: 4, role: 'system' },
        regex_scripts: state.regexScripts,
      },
    },
  };
  fillEditors();
  refreshPreview();
  toast('示例卡已填入');
}

async function validateAll() {
  const cardValidation = await api('/api/validate-card', { card: state.card });
  const regexValidation = await api('/api/validate-regex', { regexScripts: state.regexScripts });
  setValidation({
    valid: cardValidation.valid && regexValidation.valid,
    errors: [...cardValidation.errors, ...regexValidation.errors],
    warnings: cardValidation.warnings,
  });
}

function setValidation(validation) {
  const badge = document.getElementById('validationBadge');
  if (!validation) {
    badge.className = 'badge muted';
    badge.textContent = '未校验';
    return;
  }
  if (validation.valid) {
    badge.className = validation.warnings?.length ? 'badge warn' : 'badge ok';
    badge.textContent = validation.warnings?.length ? `通过，有 ${validation.warnings.length} 个提示` : '校验通过';
  } else {
    badge.className = 'badge bad';
    badge.textContent = `${validation.errors.length} 个错误`;
    toast(validation.errors[0]);
  }
}

function renderPresetStatus() {
  const target = document.getElementById('presetStatus');
  const keys = ['openai', 'instruct', 'context', 'sysprompt'];
  target.innerHTML = keys.map((key) => `<span>${key}: ${state.presets[key] ? '已载入' : '未载入'}</span>`).join('');
}

async function refreshPreview() {
  state.card.data.extensions.regex_scripts = state.regexScripts;
  const result = await api('/api/render-preview', {
    card: state.card,
    theme: document.body.dataset.theme,
    regexTestText: document.getElementById('regexTestText')?.value || '',
  });
  renderCard(result.preview);
  renderRegexPreview(result.preview.regexPreview);
}

function renderCard(preview) {
  const target = document.getElementById('renderCard');
  const tags = preview.tags.length
    ? preview.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
    : '<span class="tag">未设置标签</span>';
  const sections = preview.sections.map((section, index) => `
    <details class="card-section" ${index < 4 ? 'open' : ''}>
      <summary>
        <span>${escapeHtml(section.title)}</span>
        <span class="badge ${section.empty ? 'muted' : 'ok'}">${section.empty ? '空' : `${section.chars} 字符`}</span>
      </summary>
      <div class="section-content ${section.empty ? 'section-empty' : ''}">${escapeHtml(section.content || '未填写')}</div>
    </details>
  `).join('');

  target.innerHTML = `
    <article class="card-shell">
      <div class="card-head">
        <h3>${escapeHtml(preview.header.name)}</h3>
        <div class="card-subtitle">${escapeHtml(preview.header.subtitle)} · v${escapeHtml(preview.header.version)}</div>
        <div class="tag-row">${tags}</div>
        <div class="progress" title="整体完整度"><span style="--value:${preview.completion.overall}%"></span></div>
      </div>
      <div class="metrics">
        <div class="metric"><strong>${preview.completion.overall}%</strong><span>整体完整度</span></div>
        <div class="metric"><strong>${preview.metrics.estimatedTokens}</strong><span>估算 Token</span></div>
        <div class="metric"><strong>${preview.metrics.regexCount}</strong><span>正则脚本</span></div>
        <div class="metric"><strong>${preview.metrics.greetingCount}</strong><span>开场白</span></div>
      </div>
      ${sections}
    </article>
  `;
  document.getElementById('firstMessagePreview').textContent = preview.firstMessage || '首语为空。';
}

function renderRegexEditor() {
  const target = document.getElementById('regexList');
  target.innerHTML = state.regexScripts.map((script, index) => `
    <div class="regex-item" data-index="${index}">
      <div class="row">
        <label>脚本名<input data-regex-field="scriptName" value="${escapeAttr(script.scriptName)}"></label>
        <label>查找正则<input data-regex-field="findRegex" value="${escapeAttr(script.findRegex)}"></label>
      </div>
      <label>替换为<textarea data-regex-field="replaceString" rows="2">${escapeHtml(script.replaceString)}</textarea></label>
      <label>Trim Out（每行一条）<textarea data-regex-field="trimStrings" rows="2">${escapeHtml(script.trimStrings.join('\n'))}</textarea></label>
      <div class="regex-placements">
        ${placementLabels.map(([value, label]) => `
          <label><input type="checkbox" data-placement="${value}" ${script.placement.includes(value) ? 'checked' : ''}>${label}</label>
        `).join('')}
      </div>
      <div class="row">
        <label>Min Depth<input type="number" data-regex-field="minDepth" value="${script.minDepth ?? ''}"></label>
        <label>Max Depth<input type="number" data-regex-field="maxDepth" value="${script.maxDepth ?? ''}"></label>
      </div>
      <div class="regex-placements">
        <label><input type="checkbox" data-regex-bool="disabled" ${script.disabled ? 'checked' : ''}>禁用</label>
        <label><input type="checkbox" data-regex-bool="markdownOnly" ${script.markdownOnly ? 'checked' : ''}>仅显示</label>
        <label><input type="checkbox" data-regex-bool="promptOnly" ${script.promptOnly ? 'checked' : ''}>仅提示词</label>
        <label><input type="checkbox" data-regex-bool="runOnEdit" ${script.runOnEdit ? 'checked' : ''}>编辑时运行</label>
      </div>
      <button data-remove-regex="${index}">删除</button>
    </div>
  `).join('');

  target.querySelectorAll('[data-regex-field]').forEach((element) => element.addEventListener('input', updateRegexFromEditor));
  target.querySelectorAll('[data-placement]').forEach((element) => element.addEventListener('change', updateRegexFromEditor));
  target.querySelectorAll('[data-regex-bool]').forEach((element) => element.addEventListener('change', updateRegexFromEditor));
  target.querySelectorAll('[data-remove-regex]').forEach((button) => {
    button.addEventListener('click', () => {
      state.regexScripts.splice(Number(button.dataset.removeRegex), 1);
      renderRegexEditor();
      refreshPreview();
    });
  });
}

function updateRegexFromEditor(event) {
  const item = event.target.closest('.regex-item');
  const index = Number(item.dataset.index);
  const script = state.regexScripts[index];
  const field = event.target.dataset.regexField;
  const boolField = event.target.dataset.regexBool;

  if (field) {
    if (field === 'trimStrings') {
      script.trimStrings = event.target.value.split('\n').map((item) => item.trim()).filter(Boolean);
    } else if (field === 'minDepth' || field === 'maxDepth') {
      script[field] = event.target.value === '' ? null : Number(event.target.value);
    } else {
      script[field] = event.target.value;
    }
  }

  if (boolField) {
    script[boolField] = event.target.checked;
  }

  script.placement = [...item.querySelectorAll('[data-placement]:checked')].map((element) => Number(element.dataset.placement));
  refreshPreview();
}

function addRegex() {
  state.regexScripts.push({
    id: crypto.randomUUID(),
    scriptName: '新正则脚本',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  });
  renderRegexEditor();
  refreshPreview();
}

function renderRegexPreview(preview) {
  state.lastRegexPreview = preview.output || '';
  document.getElementById('regexPreviewOutput').textContent = [
    `输入:\n${preview.input || ''}`,
    `输出:\n${preview.output || ''}`,
    `步骤:\n${preview.steps.map((step) => `${step.scriptName}: ${step.error ? `错误 ${step.error}` : step.skipped ? '跳过' : step.changed ? '已替换' : '无变化'}`).join('\n')}`,
  ].join('\n\n');
}

async function exportFiles(kind) {
  const result = await api('/api/export', { card: state.card, regexScripts: state.regexScripts, embedRegex: state.embedRegex });
  if (kind === 'card') {
    downloadJson(result.cardFileName, result.cardJson);
  } else {
    downloadJson(result.regexFileName, result.regexJson);
  }
}

async function copyCardJson() {
  const result = await api('/api/export', { card: state.card, regexScripts: state.regexScripts, embedRegex: state.embedRegex });
  await navigator.clipboard.writeText(result.cardJson);
  toast('完整角色卡 JSON 已复制');
}

async function copyRegexPreview() {
  await navigator.clipboard.writeText(state.lastRegexPreview || '');
  toast('正则测试输出已复制');
}

function downloadJson(filename, content) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function api(url, body) {
  const options = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function splitComma(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}

function setBusy(isBusy) {
  document.getElementById('generateButton').disabled = isBusy;
  document.getElementById('generateButton').textContent = isBusy ? '生成中...' : '调用 API 生成';
}

function toast(message) {
  const target = document.getElementById('toast');
  target.textContent = message;
  target.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => target.classList.remove('show'), 2600);
}
