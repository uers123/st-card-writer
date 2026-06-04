export function updatePlanEntry(plan, index, field, value) {
  if (!ensurePlanEntries(plan)) return false;
  const entry = plan.entries[index];
  if (!entry || !field) return false;

  if (field === 'keys') {
    entry.keys = normalizePlanKeys(value);
  } else {
    entry[field] = String(value ?? '');
  }

  return true;
}

export function deletePlanEntry(plan, index) {
  if (!ensurePlanEntries(plan)) return false;
  if (!Number.isInteger(index) || !plan.entries[index]) return false;
  plan.entries.splice(index, 1);
  return true;
}

export function ensurePlanEntries(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (!Array.isArray(plan.entries)) plan.entries = [];
  return true;
}

export function normalizePlanKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}
