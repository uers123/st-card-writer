import { createHash } from 'node:crypto';

export function createVectorIndex(entries = [], { provider = null, dimensions = 96 } = {}) {
  const index = { dimensions, provider, items: [] };
  for (const [position, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const text = `${entry.title || entry.comment || ''}\n${(entry.keys || []).join(' ')}\n${entry.content || ''}`;
    index.items.push({ id: String(entry.id ?? position), entry, vector: embedText(text, dimensions) });
  }
  return index;
}

export function recallVectors(index, query, { threshold = 0.22, limit = 8, precomputedScores = {} } = {}) {
  if (!index || !Array.isArray(index.items)) return [];
  const text = String(query || '');
  return index.items.map((item) => {
    const provided = precomputedScores[item.id];
    const providerScore = typeof index.provider?.score === 'function' ? index.provider.score(text, item.entry) : null;
    const score = Number.isFinite(Number(provided)) ? Number(provided) : Number.isFinite(Number(providerScore)) ? Number(providerScore) : cosine(item.vector, embedText(text, index.dimensions || 96));
    return { entry: item.entry, score, source: 'vector' };
  }).filter((item) => item.score >= threshold).sort((left, right) => right.score - left.score).slice(0, limit);
}

export function embedText(value, dimensions = 96) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenize(value);
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    for (let index = 0; index < 4; index += 1) vector[digest[index] % dimensions] += digest[index + 4] / 255 - 0.5;
  }
  const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return length ? vector.map((item) => item / length) : vector;
}

export function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 0;
  return left.reduce((sum, item, index) => sum + item * right[index], 0);
}

function tokenize(value) {
  return String(value || '').toLowerCase().match(/[\p{L}\p{N}]{1,24}/gu) || [...String(value || '').toLowerCase()].filter((char) => !/\s/u.test(char));
}
