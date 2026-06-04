export const state = {
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

export function emptyWorldbook() {
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
