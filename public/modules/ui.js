export const $ = (selector) => document.querySelector(selector);

export function downloadText(fileName, text) {
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

export function setBusy(selector, busy, text) {
  const button = $(selector);
  button.disabled = busy;
  button.textContent = text;
}

export function setStatePill(element, text, status = '') {
  element.textContent = text;
  element.classList.remove('ok', 'warn', 'fail');
  if (status) element.classList.add(status);
}

export function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

export function renderImageOrText(url, text) {
  if (url) {
    return `<img src="${escapeAttr(url)}" alt="">`;
  }
  return escapeHtml(text || 'WB');
}

export function initials(value) {
  return String(value || 'WB').split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join('') || 'WB';
}

export function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function positionOptions(selected) {
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

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
