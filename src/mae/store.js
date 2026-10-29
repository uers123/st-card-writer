import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  type TEXT NOT NULL DEFAULT 'npc',
  introduction TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  behaviors TEXT NOT NULL DEFAULT '[]',
  inventory TEXT NOT NULL DEFAULT '[]',
  current_state TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '[]',
  relationships TEXT NOT NULL DEFAULT '{}',
  location TEXT NOT NULL DEFAULT '',
  first_seen INTEGER,
  last_seen INTEGER,
  salience REAL NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  card_ref TEXT NOT NULL DEFAULT '',
  appearance_count INTEGER NOT NULL DEFAULT 0,
  gender TEXT NOT NULL DEFAULT 'unknown',
  role TEXT NOT NULL DEFAULT 'npc',
  deceased_at INTEGER,
  death_cause TEXT NOT NULL DEFAULT '',
  birth_epoch INTEGER,
  legacy_of TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  entity_ids TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'plot',
  content TEXT NOT NULL,
  source_msg_id TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  importance REAL NOT NULL DEFAULT 0.5,
  valid_from INTEGER,
  valid_to INTEGER,
  superseded_by TEXT NOT NULL DEFAULT '',
  last_confirmed_at INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timeline (
  id TEXT PRIMARY KEY,
  turn_seq INTEGER NOT NULL DEFAULT 0,
  world_time INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'chat',
  scene TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  causes TEXT NOT NULL DEFAULT '[]',
  effects TEXT NOT NULL DEFAULT '[]',
  pending_reveal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL,
  violations TEXT NOT NULL DEFAULT '[]',
  retry_chain TEXT NOT NULL DEFAULT '[]',
  ticket_status TEXT NOT NULL DEFAULT 'closed',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_status_salience ON entities(status, salience DESC);
CREATE INDEX IF NOT EXISTS idx_facts_importance ON facts(importance DESC, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_turn ON timeline(turn_seq DESC);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(ticket_status, created_at DESC);
`;

const TABLES = Object.freeze(['entities', 'facts', 'timeline', 'audits']);

export function createStore({ chatId = 'default', dataDir, memory = false } = {}) {
  if (DatabaseSync) {
    return new SqliteStore({ chatId, dataDir, memory });
  }
  return new JsonStore({ chatId, dataDir, memory });
}

export class StoreManager {
  constructor({ dataDir = path.join(process.cwd(), 'data', 'mae'), maxStores = 8 } = {}) {
    this.dataDir = dataDir;
    this.maxStores = maxStores;
    this.stores = new Map();
  }

  forChat(chatId = 'default') {
    const key = safeChatId(chatId);
    if (this.stores.has(key)) {
      const store = this.stores.get(key);
      this.stores.delete(key);
      this.stores.set(key, store);
      return store;
    }

    const store = createStore({ chatId: key, dataDir: this.dataDir });
    this.stores.set(key, store);
    while (this.stores.size > this.maxStores) {
      const oldest = this.stores.keys().next().value;
      this.stores.get(oldest)?.close();
      this.stores.delete(oldest);
    }
    return store;
  }

  closeAll() {
    for (const store of this.stores.values()) store.close();
    this.stores.clear();
  }
}

class SqliteStore {
  constructor({ chatId, dataDir, memory }) {
    this.chatId = safeChatId(chatId);
    const location = memory ? ':memory:' : path.join(dataDir || path.join(process.cwd(), 'data', 'mae'), `${this.chatId}.sqlite`);
    if (location !== ':memory:') fs.mkdirSync(path.dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
    this.db.exec(SCHEMA);
    migrateEntityColumns(this.db);
  }

  getMeta(key) {
    const value = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
    return value === undefined ? null : json(value, value);
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  listEntities() {
    return this.db.prepare('SELECT * FROM entities ORDER BY salience DESC, name ASC').all().map(readEntity);
  }

  getEntity(id) {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
    return row ? readEntity(row) : null;
  }

  upsertEntity(entity) {
    const row = writeEntity(entity);
    this.db.prepare(`INSERT INTO entities
      (id,name,aliases,type,introduction,personality,behaviors,inventory,current_state,goals,relationships,location,first_seen,last_seen,salience,importance,status,card_ref,appearance_count,gender,role,deceased_at,death_cause,birth_epoch,legacy_of)
      VALUES (@id,@name,@aliases,@type,@introduction,@personality,@behaviors,@inventory,@current_state,@goals,@relationships,@location,@first_seen,@last_seen,@salience,@importance,@status,@card_ref,@appearance_count,@gender,@role,@deceased_at,@death_cause,@birth_epoch,@legacy_of)
      ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,aliases=excluded.aliases,type=excluded.type,introduction=excluded.introduction,
      personality=excluded.personality,behaviors=excluded.behaviors,inventory=excluded.inventory,
      current_state=excluded.current_state,goals=excluded.goals,relationships=excluded.relationships,
      location=excluded.location,first_seen=excluded.first_seen,last_seen=excluded.last_seen,
      salience=excluded.salience,importance=excluded.importance,status=excluded.status,card_ref=excluded.card_ref,
      appearance_count=excluded.appearance_count,gender=excluded.gender,role=excluded.role,
      deceased_at=excluded.deceased_at,death_cause=excluded.death_cause,birth_epoch=excluded.birth_epoch,
      legacy_of=excluded.legacy_of`).run(row);
    return this.getEntity(row.id);
  }

  listFacts({ limit = 100, importantOnly = false } = {}) {
    const sql = importantOnly
      ? 'SELECT * FROM facts WHERE superseded_by = \'\' AND importance >= 0.8 ORDER BY importance DESC, confidence DESC LIMIT ?'
      : 'SELECT * FROM facts WHERE superseded_by = \'\' ORDER BY importance DESC, created_at DESC LIMIT ?';
    return this.db.prepare(sql).all(Math.max(1, Number(limit) || 100)).map(readFact);
  }

  getFact(id) {
    const row = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id);
    return row ? readFact(row) : null;
  }

  insertFact(fact) {
    const row = writeFact(fact);
    this.db.prepare(`INSERT INTO facts
      (id,entity_ids,category,content,source_msg_id,confidence,importance,valid_from,valid_to,superseded_by,last_confirmed_at,created_at)
      VALUES (@id,@entity_ids,@category,@content,@source_msg_id,@confidence,@importance,@valid_from,@valid_to,@superseded_by,@last_confirmed_at,@created_at)`).run(row);
    return this.getFact(row.id);
  }

  updateFact(id, patch) {
    const current = this.getFact(id);
    if (!current) return null;
    const row = writeFact({ ...current, ...patch, id });
    const { created_at: _createdAt, ...updateParams } = row;
    this.db.prepare(`UPDATE facts SET entity_ids=@entity_ids,category=@category,content=@content,source_msg_id=@source_msg_id,
      confidence=@confidence,importance=@importance,valid_from=@valid_from,valid_to=@valid_to,superseded_by=@superseded_by,
      last_confirmed_at=@last_confirmed_at WHERE id=@id`).run(updateParams);
    return this.getFact(id);
  }

  listTimeline({ limit = 50 } = {}) {
    return this.db.prepare('SELECT * FROM timeline ORDER BY turn_seq DESC, created_at DESC LIMIT ?')
      .all(Math.max(1, Number(limit) || 50)).map(readTimeline);
  }

  appendTimeline(event) {
    const row = writeTimeline(event);
    this.db.prepare(`INSERT INTO timeline
      (id,turn_seq,world_time,source,scene,participants,description,causes,effects,pending_reveal,created_at)
      VALUES (@id,@turn_seq,@world_time,@source,@scene,@participants,@description,@causes,@effects,@pending_reveal,@created_at)`).run(row);
    return readTimeline(this.db.prepare('SELECT * FROM timeline WHERE id = ?').get(row.id));
  }

  listAudits({ limit = 50 } = {}) {
    return this.db.prepare('SELECT * FROM audits ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Number(limit) || 50)).map(readAudit);
  }

  insertAudit(audit) {
    const row = writeAudit(audit);
    this.db.prepare(`INSERT INTO audits
      (id,target_type,target_id,verdict,violations,retry_chain,ticket_status,created_at)
      VALUES (@id,@target_type,@target_id,@verdict,@violations,@retry_chain,@ticket_status,@created_at)`).run(row);
    return readAudit(this.db.prepare('SELECT * FROM audits WHERE id = ?').get(row.id));
  }

  exportSnapshot() {
    return {
      chatId: this.chatId,
      meta: readMeta(this),
      entities: this.listEntities(),
      facts: this.listFacts({ limit: 10000 }),
      timeline: this.listTimeline({ limit: 10000 }),
      audits: this.listAudits({ limit: 10000 }),
    };
  }

  close() {
    this.db.close();
  }
}

class JsonStore {
  constructor({ chatId, dataDir, memory }) {
    this.chatId = safeChatId(chatId);
    this.memory = memory;
    this.filePath = memory ? null : path.join(dataDir || path.join(process.cwd(), 'data', 'mae'), `${this.chatId}.json`);
    if (this.filePath) fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.state = this.filePath && fs.existsSync(this.filePath)
      ? readJson(this.filePath)
      : { meta: {}, entities: [], facts: [], timeline: [], audits: [] };
  }

  getMeta(key) { return this.state.meta[key] ?? null; }
  setMeta(key, value) { this.state.meta[key] = value; this.flush(); }
  listEntities() { return [...this.state.entities].sort((a, b) => b.salience - a.salience || a.name.localeCompare(b.name)); }
  getEntity(id) { return this.state.entities.find((item) => item.id === id) ?? null; }
  upsertEntity(entity) { replaceById(this.state.entities, entity); this.flush(); return this.getEntity(entity.id); }
  listFacts({ limit = 100, importantOnly = false } = {}) {
    return this.state.facts.filter((item) => !item.superseded_by && (!importantOnly || item.importance >= 0.8))
      .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence).slice(0, limit);
  }
  getFact(id) { return this.state.facts.find((item) => item.id === id) ?? null; }
  insertFact(fact) { this.state.facts.push(writeFact(fact)); this.flush(); return this.getFact(fact.id); }
  updateFact(id, patch) { const current = this.getFact(id); if (!current) return null; replaceById(this.state.facts, writeFact({ ...current, ...patch, id })); this.flush(); return this.getFact(id); }
  listTimeline({ limit = 50 } = {}) { return [...this.state.timeline].sort((a, b) => b.turn_seq - a.turn_seq).slice(0, limit); }
  appendTimeline(event) { const value = writeTimeline(event); this.state.timeline.push(value); this.flush(); return value; }
  listAudits({ limit = 50 } = {}) { return [...this.state.audits].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); }
  insertAudit(audit) { const value = writeAudit(audit); this.state.audits.push(value); this.flush(); return value; }
  exportSnapshot() { return { chatId: this.chatId, ...structuredClone(this.state), meta: readMeta(this) }; }
  close() {}

  flush() {
    if (!this.filePath) return;
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}

function readEntity(row) {
  return { ...row, aliases: json(row.aliases, []), behaviors: json(row.behaviors, []), goals: json(row.goals, []), inventory: json(row.inventory, []), relationships: json(row.relationships, {}) };
}

function writeEntity(value = {}) {
  return {
    id: String(value.id), name: string(value.name), aliases: JSON.stringify(array(value.aliases)), type: string(value.type, 'npc'),
    introduction: string(value.introduction), personality: string(value.personality),
    behaviors: JSON.stringify(array(value.behaviors ?? value.behavior)), inventory: JSON.stringify(array(value.inventory ?? value.items)),
    current_state: string(value.current_state ?? value.currentState), goals: JSON.stringify(array(value.goals)),
    relationships: JSON.stringify(object(value.relationships)), location: string(value.location),
    first_seen: integer(value.first_seen ?? value.firstSeen), last_seen: integer(value.last_seen ?? value.lastSeen),
    salience: finite(value.salience, 0), importance: finite(value.importance, 0.5), status: string(value.status, 'active'),
    card_ref: string(value.card_ref ?? value.cardRef), appearance_count: integer(value.appearance_count ?? value.appearanceCount, 0),
    gender: string(value.gender, 'unknown'), role: string(value.role, 'npc'),
    deceased_at: integer(value.deceased_at ?? value.deceasedAt), death_cause: string(value.death_cause ?? value.deathCause),
    birth_epoch: integer(value.birth_epoch ?? value.birthEpoch), legacy_of: string(value.legacy_of ?? value.legacyOf),
  };
}

function readFact(row) { return { ...row, entity_ids: json(row.entity_ids, []) }; }
function writeFact(value = {}) {
  return {
    id: String(value.id), entity_ids: JSON.stringify(array(value.entity_ids ?? value.entityIds)), category: string(value.category, 'plot'),
    content: string(value.content), source_msg_id: string(value.source_msg_id ?? value.sourceMsgId), confidence: finite(value.confidence, 0.5),
    importance: finite(value.importance, 0.5), valid_from: integer(value.valid_from ?? value.validFrom), valid_to: integer(value.valid_to ?? value.validTo),
    superseded_by: string(value.superseded_by ?? value.supersededBy), last_confirmed_at: integer(value.last_confirmed_at ?? value.lastConfirmedAt),
    created_at: string(value.created_at ?? value.createdAt, new Date().toISOString()),
  };
}

function readTimeline(row) { return { ...row, participants: json(row.participants, []), causes: json(row.causes, []), effects: json(row.effects, []), pending_reveal: Boolean(row.pending_reveal) }; }
function writeTimeline(value = {}) {
  return {
    id: String(value.id), turn_seq: integer(value.turn_seq ?? value.turnSeq, 0), world_time: integer(value.world_time ?? value.worldTime, 0),
    source: string(value.source, 'chat'), scene: string(value.scene), participants: JSON.stringify(array(value.participants)), description: string(value.description),
    causes: JSON.stringify(array(value.causes)), effects: JSON.stringify(array(value.effects)), pending_reveal: value.pending_reveal || value.pendingReveal ? 1 : 0,
    created_at: string(value.created_at ?? value.createdAt, new Date().toISOString()),
  };
}

function readAudit(row) { return { ...row, violations: json(row.violations, []), retry_chain: json(row.retry_chain, []) }; }
function writeAudit(value = {}) {
  return {
    id: String(value.id), target_type: string(value.target_type ?? value.targetType, 'generation'), target_id: string(value.target_id ?? value.targetId),
    verdict: string(value.verdict, 'pass'), violations: JSON.stringify(array(value.violations)), retry_chain: JSON.stringify(array(value.retry_chain ?? value.retryChain)),
    ticket_status: string(value.ticket_status ?? value.ticketStatus, value.verdict === 'fail' ? 'open' : 'closed'),
    created_at: string(value.created_at ?? value.createdAt, new Date().toISOString()),
  };
}

function readMeta(store) {
  const meta = {};
  for (const key of ['mae.settings', 'mae.worldbook_snapshot', 'mae.world_time', 'mae.last_turn', 'mae.last_tick', 'mae.physiology', 'mae.physiology_rules', 'mae.gaiden', 'mae.model_routes', 'mae.player', 'mae.handoff', 'mae.era_profile', 'mae.reaction_priorities']) meta[key] = store.getMeta(key);
  return meta;
}

function migrateEntityColumns(db) {
  const columns = [
    ['personality', "TEXT NOT NULL DEFAULT ''"],
    ['behaviors', "TEXT NOT NULL DEFAULT '[]'"],
    ['inventory', "TEXT NOT NULL DEFAULT '[]'"],
    ['role', "TEXT NOT NULL DEFAULT 'npc'"],
    ['deceased_at', 'INTEGER'],
    ['death_cause', "TEXT NOT NULL DEFAULT ''"],
    ['birth_epoch', 'INTEGER'],
    ['legacy_of', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of columns) {
    try { db.exec(`ALTER TABLE entities ADD COLUMN ${name} ${definition}`); } catch { /* existing database */ }
  }
}

function replaceById(items, value) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) items.push(value);
  else items[index] = value;
}
function safeChatId(value) { return String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default'; }
function readJson(filePath) { try { return { meta: {}, entities: [], facts: [], timeline: [], audits: [], ...JSON.parse(fs.readFileSync(filePath, 'utf8')) }; } catch { return { meta: {}, entities: [], facts: [], timeline: [], audits: [] }; } }
function json(value, fallback) { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function string(value, fallback = '') { return value === undefined || value === null ? fallback : String(value); }
function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function integer(value, fallback = null) { const number = Number(value); return Number.isFinite(number) ? Math.trunc(number) : fallback; }
