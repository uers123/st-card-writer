import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalApiDefaults } from '../local-config.js';
import { buildInjectionModel } from './injection.js';
import { normalizePhysiologyRules, normalizePhysiologyState, advancePhysiology, renderPhysiology, settleSexualContact } from './physiology.js';
import { createDefaultModelRouter } from './model-router.js';
import { StoreManager } from './store.js';
import { createVectorIndex } from './vector.js';

const DEFAULT_SETTINGS = Object.freeze({ tier: 'medium', tickEvery: 8, maxTickNpcs: 5, enabled: true, successorProtection: true, successorProtectionTurns: 10, gaidenEnabled: true, gaidenDailyLimit: 3 });
const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'mae');
const DEFAULT_TURN_STEP_SECONDS = 12 * 60 * 60;

export class MaeRuntime {
  constructor({ dataDir, storeManager, llm = null, modelRouter = null, settings = {} } = {}) {
    this.stores = storeManager || new StoreManager({ dataDir: dataDir || DEFAULT_DATA_DIR });
    this.llm = llm;
    this.modelRouter = modelRouter;
    this.vectorIndexes = new Map();
    this.defaults = { ...DEFAULT_SETTINGS, ...settings };
  }

  storeFor(chatId) { return this.stores.forChat(chatId || 'default'); }

  settingsFor(store) {
    const stored = store.getMeta('mae.settings');
    return { ...DEFAULT_SETTINGS, ...this.defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  setSettings({ chatId, settings }) {
    const store = this.storeFor(chatId);
    const next = normalizeSettings({ ...this.settingsFor(store), ...(settings || {}) });
    store.setMeta('mae.settings', next);
    return next;
  }

  updateEntity({ chatId, entityId, patch = {} } = {}) {
    const store = this.storeFor(chatId);
    const current = store.getEntity(entityId);
    if (!current) throw new Error('要编辑的实体不存在。');
    const next = normalizeEditableEntity({ ...current, ...patch, id: current.id });
    const saved = store.upsertEntity(next);
    if (saved.role === 'player') store.setMeta('mae.player', saved.id);
    return saved;
  }

  snapshot(chatId) {
    const store = this.storeFor(chatId);
    return { ...store.exportSnapshot(), settings: this.settingsFor(store), counts: {
      entities: store.listEntities().length,
      facts: store.listFacts({ limit: 10000 }).length,
      timeline: store.listTimeline({ limit: 10000 }).length,
      audits: store.listAudits({ limit: 10000 }).length,
      gaiden: (store.getMeta('mae.gaiden') || []).length,
    } };
  }

  syncWorldbook({ chatId, entries = [], name = '' }) {
    const store = this.storeFor(chatId);
    const normalized = Array.isArray(entries) ? entries.map((entry, index) => ({
      id: entry.id ?? index,
      title: String(entry.title ?? entry.comment ?? `Entry ${index + 1}`),
      keys: normalizeArray(entry.keys ?? entry.key),
      content: String(entry.content || ''),
      group: String(entry.group || 'Core'),
      enabled: entry.enabled !== false && entry.disable !== true,
      importance: Number.isFinite(Number(entry.importance)) ? Number(entry.importance) : 0.5,
    })) : [];
    store.setMeta('mae.worldbook_snapshot', { name: String(name || ''), entries: normalized, syncedAt: new Date().toISOString() });
    this.vectorIndexes.set(safeChatId(chatId), createVectorIndex(normalized));
    return { name, entries: normalized, count: normalized.length };
  }

  buildInjection({ chatId, turnSeq = 0, contextText = '', settings = {}, vectorScores = {} } = {}) {
    const store = this.storeFor(chatId);
    const storedWorldbook = store.getMeta('mae.worldbook_snapshot');
    const worldbook = storedWorldbook?.entries || [];
    const worldTime = Number(store.getMeta('mae.world_time') || 0);
    const result = buildInjectionModel({
      entities: store.listEntities(),
      facts: store.listFacts({ limit: 200 }),
      timeline: store.listTimeline({ limit: 20 }),
      worldbook,
      contextText,
      turnSeq,
      worldTime,
      settings: { ...this.settingsFor(store), ...settings },
      vectorIndex: this.vectorIndexes.get(safeChatId(chatId)) || createVectorIndex(worldbook),
      vectorScores,
      physiology: store.getMeta('mae.physiology') || {},
      handoff: store.getMeta('mae.handoff') || '',
    });
    if (store.getMeta('mae.handoff')) store.setMeta('mae.handoff', null);
    return result;
  }

  processTurn({
    chatId, turnSeq = 0, text = '', role = 'assistant', source = 'chat', scene = '', worldTime, entities = [], facts = [],
    messageId = '', auditText = '', constraints = [], deltaSeconds = DEFAULT_TURN_STEP_SECONDS, physiology = {}, sexualContact = null, death = null,
  } = {}) {
    const store = this.storeFor(chatId);
    const normalizedText = String(text || '').trim();
    if (!normalizedText && !entities.length && !facts.length && !Object.keys(physiology || {}).length && !sexualContact && !death) return { skipped: true, reason: 'empty turn' };
    const eventId = messageId ? `message:${messageId}` : `turn:${turnSeq}:${hash(normalizedText)}`;
    const duplicate = store.listTimeline({ limit: 10000 }).some((event) => event.id === eventId);
    if (duplicate) return { skipped: true, reason: 'duplicate message', turnSeq, tickDue: false, snapshot: this.snapshot(chatId) };
    const previousTime = Number(store.getMeta('mae.world_time') || 0);
    const effectiveTime = Number.isFinite(Number(worldTime))
      ? Number(worldTime)
      : previousTime + Math.max(0, Number(deltaSeconds) || 0);
    store.setMeta('mae.world_time', effectiveTime);
    const physiologyEvents = this.advanceStoredPhysiology({ store, fromTime: previousTime, worldTime: effectiveTime });
    this.applyPhysiologyUpdates(store, physiology);
    const contactResult = sexualContact ? this.settleContact({ chatId, ...sexualContact, worldTime: effectiveTime }) : null;

    const participants = [];
    for (const input of normalizeEntities(entities, normalizedText, turnSeq)) {
      const existing = findEntity(store.listEntities(), input.name, input.aliases);
      const entity = {
        ...(existing || {}), ...input,
        id: existing?.id || input.id || entityId(input.name),
        first_seen: existing?.first_seen ?? turnSeq,
        last_seen: turnSeq,
        appearance_count: Number(existing?.appearance_count || 0) + 1,
        salience: salience({ ...existing, ...input, turnSeq, participants: [input.name] }),
        status: input.status || existing?.status || 'active',
      };
      store.upsertEntity(entity);
      if (entity.role === 'player') store.setMeta('mae.player', entity.id);
      participants.push(entity.id);
    }

    for (const input of normalizeFacts(facts)) {
      if (!input.content) continue;
      const id = input.id || factId(input.content, turnSeq);
      const existing = store.listFacts({ limit: 10000 }).find((fact) => fact.content === input.content);
      if (existing) continue;
      const prior = store.listFacts({ limit: 10000 }).find((fact) => fact.category === input.category && related(fact.entity_ids, input.entity_ids) && fact.content !== input.content);
      if (prior) store.updateFact(prior.id, { superseded_by: id });
      store.insertFact({ ...input, id, source_msg_id: messageId, valid_from: input.valid_from ?? effectiveTime, last_confirmed_at: turnSeq });
    }

    if (normalizedText) {
      store.appendTimeline({ id: eventId, turn_seq: turnSeq, world_time: effectiveTime, source, scene, participants, description: summarizeTurn(normalizedText), effects: role === 'assistant' ? ['assistant_generation'] : [] });
    }
    store.setMeta('mae.last_turn', { turnSeq, messageId, role, processedAt: new Date().toISOString() });

    const audit = auditText ? this.auditText({ chatId, text: auditText, turnSeq, constraints }) : null;
    const deaths = [...physiologyEvents.deaths.map((item) => ({ entityId: item.entityId, cause: item.cause })), ...(death ? [{ entityId: death.entityId, cause: death.cause }] : [])];
    const deathResults = deaths.filter((item) => item.entityId && store.getEntity(item.entityId)).map((item) => this.markDeath({ chatId, entityId: item.entityId, cause: item.cause, worldTime: effectiveTime, turnSeq }));
    this.maybeQueueGaiden(store, participants);
    const settings = this.settingsFor(store);
    return { skipped: false, turnSeq, worldTime: effectiveTime, participants, audit, physiologyEvents: physiologyEvents.events, contactResult, deathResults, tickDue: settings.enabled && settings.tickEvery > 0 && turnSeq > 0 && turnSeq % settings.tickEvery === 0, snapshot: this.snapshot(chatId) };
  }

  async processTurnAsync(input = {}) {
    let enriched = { ...input };
    let extractionError = '';
    if (this.hasModel('extract') && String(input.text || '').trim() && input.skipExtraction !== true) {
      try {
        const messages = [{ role: 'system', content: '你是结构化剧情记录员。只记录文本明确出现的人物、地点、物品、关系和事实，不要猜测。只输出 JSON。' }, { role: 'user', content: JSON.stringify({ text: input.text, schema: { entities: [], facts: [] } }) }];
        const extracted = await this.callJsonModel('extract', messages, { maxTokens: 700 });
        enriched = {
          ...input,
          entities: mergeEntities(input.entities, extracted?.entities),
          facts: mergeFacts(input.facts, extracted?.facts),
        };
      } catch (error) {
        extractionError = error?.message || String(error);
      }
    }
    return { ...this.processTurn(enriched), extractionError: extractionError || null };
  }

  auditText({ chatId, text, turnSeq = 0, constraints = [], targetId = '', targetType = 'generation' } = {}) {
    const store = this.storeFor(chatId);
    const { violations, verdict } = localAuditResult({ text, constraints, facts: store.listFacts({ limit: 200 }) });
    const audit = store.insertAudit({ id: randomUUID(), target_type: targetType, target_id: targetId, verdict, violations, retry_chain: [String(text || '')], ticket_status: verdict === 'fail' ? 'open' : 'closed' });
    return audit;
  }

  async runTick({ chatId, deltaSeconds = 86400, maxNpcs } = {}) {
    const store = this.storeFor(chatId);
    const settings = this.settingsFor(store);
    const limit = Math.min(settings.maxTickNpcs, Math.max(1, Number(maxNpcs) || settings.maxTickNpcs));
    const candidates = store.listEntities().filter((entity) => entity.type === 'npc' && !['archived', 'deceased'].includes(entity.status) && Number(entity.salience) >= 0.1).slice(0, limit);
    if (!candidates.length) return { skipped: true, reason: 'no eligible NPCs', candidates: [] };
    if (!this.hasModel('tick')) return { skipped: true, reason: 'no model adapter configured', candidates: candidates.map((entity) => entity.name) };

    const results = [];
    const baseWorldTime = Number(store.getMeta('mae.world_time') || 0);
    const nextTurnSeq = Math.max(Number(store.getMeta('mae.last_turn')?.turnSeq || 0), Number(store.getMeta('mae.last_tick')?.turnSeq || 0)) + 1;
    for (const [index, entity] of candidates.entries()) {
      const response = await this.callJsonModel('tick', [{ role: 'system', content: '你是后台世界模拟器。只推进 NPC 的非玩家生活，不改变未给出的事实。只输出 JSON。不要把玩家或玩家目标作为行动条件。' }, { role: 'user', content: JSON.stringify({ npc: entity, deltaSeconds, output: ['actions', 'state_change', 'new_location', 'notable_event'] }) }], { maxTokens: 400, temperature: 0.3 });
      const event = response?.actions || response?.description || response?.notable_event;
      if (!event) continue;
      const audit = await this.auditGenerated({ chatId, text: String(event), targetId: entity.id, targetType: 'tick' });
      if (audit.verdict === 'fail') continue;
      const next = { ...entity, current_state: String(response.state_change || entity.current_state), location: String(response.new_location || entity.location), last_seen: entity.last_seen, salience: Math.max(0.1, Number(entity.salience) * 0.95) };
      store.upsertEntity(next);
      results.push(store.appendTimeline({ id: randomUUID(), turn_seq: nextTurnSeq + index, world_time: baseWorldTime + Number(deltaSeconds), source: 'tick', scene: next.location, participants: [entity.id], description: String(event), pending_reveal: Boolean(response.notable_event) }));
    }
    store.setMeta('mae.world_time', baseWorldTime + Number(deltaSeconds));
    store.setMeta('mae.last_tick', { turnSeq: nextTurnSeq + Math.max(0, candidates.length - 1), worldTime: baseWorldTime + Number(deltaSeconds), processedAt: new Date().toISOString() });
    this.maybeQueueGaiden(store, results.flatMap((event) => event.participants || []));
    const gaiden = this.settingsFor(store).gaidenEnabled ? await this.processGaiden({ chatId, maxChapters: 1 }) : { skipped: true, reason: 'gaiden disabled' };
    return { skipped: false, candidates: candidates.map((entity) => entity.name), events: results, gaiden, snapshot: this.snapshot(chatId) };
  }

  getModelRoutes(chatId) {
    const store = this.storeFor(chatId);
    if (!this.modelRouter) return store.getMeta('mae.model_routes') || { default: {}, slots: {} };
    const stored = store.getMeta('mae.model_routes_private') || store.getMeta('mae.model_routes');
    if (stored) this.modelRouter.setRoutes({ defaultApi: stored.default, slots: stored.slots });
    return this.modelRouter.getRoutes();
  }

  setModelRoutes({ chatId, defaultApi, slots } = {}) {
    const store = this.storeFor(chatId);
    if (!this.modelRouter) return store.getMeta('mae.model_routes') || { default: {}, slots: {} };
    const next = this.modelRouter.setRoutes({ defaultApi, slots });
    store.setMeta('mae.model_routes', next);
    store.setMeta('mae.model_routes_private', this.modelRouter.getRawRoutes());
    return next;
  }

  getPhysiologyRules(store) {
    const settings = this.settingsFor(store);
    return normalizePhysiologyRules({ ...(store.getMeta('mae.physiology_rules') || {}), ...(settings.physiologyRules || {}) });
  }

  setPhysiologyRules({ chatId, rules } = {}) {
    const store = this.storeFor(chatId);
    const normalized = normalizePhysiologyRules(rules);
    store.setMeta('mae.physiology_rules', normalized);
    return normalized;
  }

  setPhysiology({ chatId, entityId, state } = {}) {
    const store = this.storeFor(chatId);
    const all = store.getMeta('mae.physiology') || {};
    all[entityId] = normalizePhysiologyState(state);
    store.setMeta('mae.physiology', all);
    return all[entityId];
  }

  settleContact({ chatId, actorIds, worldTime, rng } = {}) {
    const store = this.storeFor(chatId);
    const all = store.getMeta('mae.physiology') || {};
    const contactTime = worldTime === undefined || worldTime === null ? Number(store.getMeta('mae.world_time') || 0) : Number(worldTime);
    const result = settleSexualContact({ states: all, actorIds, worldTime: contactTime, rules: this.getPhysiologyRules(store), rng: rng || Math.random });
    const carrier = result.pregnancy[0];
    if (carrier) all[carrier.carrierId] = { ...normalizePhysiologyState(all[carrier.carrierId]), pregnancy: { since: carrier.since, due: carrier.due, fatherId: carrier.partnerId } };
    for (const infection of result.disease) for (const targetId of infection.targetIds) {
      const target = normalizePhysiologyState(all[targetId]);
      target.disease.push(infection);
      all[targetId] = target;
    }
    store.setMeta('mae.physiology', all);
    return result;
  }

  markDeath({ chatId, entityId, entityName = '', cause = '未记录死因', worldTime, turnSeq = 0, force = false } = {}) {
    const store = this.storeFor(chatId);
    const entity = entityId ? store.getEntity(entityId) : store.listEntities().find((item) => item.name === entityName);
    if (!entity) throw new Error('要结算死亡的实体不存在。');
    if (entity.status === 'deceased') return { deceased: true, already: true, entity };
    const settings = this.settingsFor(store);
    const protection = store.getMeta('mae.successor_protection');
    const currentTurn = Number(turnSeq || store.getMeta('mae.last_turn')?.turnSeq || 0);
    if (!force && settings.successorProtection && protection?.entityId === entity.id && currentTurn <= Number(protection.untilTurn || 0)) return { deceased: false, protected: true, entity };
    const at = Number.isFinite(Number(worldTime)) ? Number(worldTime) : Number(store.getMeta('mae.world_time') || 0);
    const next = store.upsertEntity({ ...entity, status: 'deceased', deceased_at: at, death_cause: String(cause), salience: 0, current_state: `已死亡：${cause}` });
    const relatedFacts = store.listFacts({ limit: 10000 }).filter((fact) => fact.entity_ids?.includes(entity.id) && !fact.valid_to);
    for (const fact of relatedFacts) store.updateFact(fact.id, { valid_to: at, category: 'legacy', content: `${fact.content}（${entity.name}的遗产事实）` });
    store.appendTimeline({ id: `death:${entity.id}:${at}`, turn_seq: currentTurn, world_time: at, source: 'death', scene: entity.location, participants: [entity.id], description: `${entity.name}死亡：${cause}`, effects: ['legacy_created'], pending_reveal: true });
    const reactions = store.getMeta('mae.reaction_priorities') || {};
    for (const other of store.listEntities()) if (other.id !== entity.id && other.relationships?.[entity.id]) {
      reactions[other.id] = { priority: 1, reason: other.relationships[entity.id].type || '关系牵连', targetId: entity.id };
      store.upsertEntity({ ...other, salience: Math.max(0.75, Number(other.salience) || 0.75) });
    }
    store.setMeta('mae.reaction_priorities', reactions);
    const final = this.enqueueGaiden({ chatId, type: 'final', entityIds: [entity.id], title: `${entity.name}：终章`, priority: 1000, cause: 'death' });
    return { deceased: true, entity: next, legacyFacts: relatedFacts.length, final, reactions: Object.keys(reactions).length };
  }

  createSuccessor({ chatId, deceasedId, name, relation = '故人之后', identity = '', turnSeq = 0 } = {}) {
    const store = this.storeFor(chatId);
    const deceased = store.getEntity(deceasedId);
    if (!deceased || deceased.status !== 'deceased') throw new Error('只有已死亡实体才能创建继任者。');
    const successorName = String(name || '').trim();
    if (!successorName) throw new Error('继任者姓名不能为空。');
    for (const entity of store.listEntities().filter((item) => item.role === 'player' && item.status !== 'deceased')) store.upsertEntity({ ...entity, role: 'npc' });
    const successor = store.upsertEntity({ id: `successor-${hash(`${deceased.id}:${successorName}:${Date.now()}`)}`, name: successorName, aliases: [], type: 'main', role: 'player', introduction: `${identity}。与${deceased.name}的关系：${relation}。`, current_state: identity || `正在接过${deceased.name}留下的命运。`, goals: [], relationships: {}, location: deceased.location, first_seen: turnSeq, last_seen: turnSeq, salience: 1, importance: 0.8, status: 'active', legacy_of: deceased.id });
    const facts = store.listFacts({ limit: 10000 }).filter((fact) => fact.entity_ids?.includes(deceased.id));
    let inherited = 0;
    for (const fact of facts) {
      const id = `inherit-${hash(`${successor.id}:${fact.id}`)}`;
      if (store.getFact(id)) continue;
      store.insertFact({ ...fact, id, entity_ids: [...new Set([...(fact.entity_ids || []).filter((id) => id !== deceased.id), successor.id])], category: 'legacy', content: `继承自${deceased.name}：${fact.content}` });
      inherited += 1;
    }
    const currentTurn = Number(turnSeq || store.getMeta('mae.last_turn')?.turnSeq || 0);
    store.setMeta('mae.player', successor.id);
    store.setMeta('mae.successor_protection', { entityId: successor.id, untilTurn: currentTurn + Number(this.settingsFor(store).successorProtectionTurns || 10) });
    store.setMeta('mae.handoff', `你不再是${deceased.name}，你现在是${successor.name}。身份：${identity || '新继任者'}。你与死者的关系：${relation}。你继承了${inherited}条遗产事实。${deceased.name}已死，死因：${deceased.death_cause || '未记录'}。`);
    return { successor, inherited, handoff: store.getMeta('mae.handoff') };
  }

  enqueueGaiden({ chatId, type = 'regular', entityIds = [], title = '', priority, cause = '' } = {}) {
    const store = this.storeFor(chatId);
    const queue = store.getMeta('mae.gaiden') || [];
    const key = `${type}:${[...entityIds].sort().join(',')}`;
    const existing = queue.find((item) => item.key === key && item.status !== 'failed');
    if (existing) return existing;
    const entry = { id: randomUUID(), key, type, entityIds: [...entityIds], title: title || '未命名番外', priority: Number(priority ?? (type === 'final' ? 1000 : type === 'death' ? 800 : 500)), cause, sequence: queue.length, queueTime: Number(store.getMeta('mae.world_time') || 0), status: 'queued', content: '', stateSettlement: null, createdAt: new Date().toISOString() };
    queue.push(entry);
    store.setMeta('mae.gaiden', queue);
    return entry;
  }

  listGaiden(chatId) { return this.storeFor(chatId).getMeta('mae.gaiden') || []; }

  async processGaiden({ chatId, maxChapters = 1 } = {}) {
    const store = this.storeFor(chatId);
    const queue = store.getMeta('mae.gaiden') || [];
    const now = Number(store.getMeta('mae.world_time') || 0);
    const usage = (store.getMeta('mae.gaiden_usage') || []).filter((time) => now - Number(time) < 86400);
    const limit = this.settingsFor(store).gaidenDailyLimit;
    if (usage.length >= limit) return { skipped: true, reason: 'gaiden daily limit reached', remaining: queue.filter((item) => item.status === 'queued').length };
    const pending = queue.filter((item) => item.status === 'queued').sort((left, right) => right.priority - left.priority || left.sequence - right.sequence).slice(0, Math.min(maxChapters, limit - usage.length));
    if (!pending.length) return { skipped: true, reason: 'no queued gaiden' };
    if (!this.hasModel('gaiden')) return { skipped: true, reason: 'no model adapter configured', queued: pending.length };
    const completed = [];
    for (const item of pending) {
      item.status = 'generating';
      try {
        const response = await this.callJsonModel('gaiden', [{ role: 'system', content: '你是番外说书人。只输出 JSON。基于账本和后台事件写可读章节，不改变事实、时间和人物契约。' }, { role: 'user', content: JSON.stringify({ title: item.title, type: item.type, entities: item.entityIds.map((id) => store.getEntity(id)).filter(Boolean), events: store.listTimeline({ limit: 12 }).filter((event) => event.participants.some((id) => item.entityIds.includes(id))), output: ['title', 'timeAnchor', 'content', 'stateSettlement'] }) }], { maxTokens: item.type === 'final' ? 5000 : 4000, temperature: 0.7 });
        item.title = String(response?.title || item.title);
        item.timeAnchor = String(response?.timeAnchor || `世界时间 ${now}`);
        item.content = String(response?.content || response?.text || '');
        item.stateSettlement = response?.stateSettlement || response?.state_settlement || null;
        if (!item.content) throw new Error('番外模型返回空正文。');
        const audit = await this.auditGenerated({ chatId, text: item.content, targetId: item.id, targetType: 'gaiden' });
        item.auditId = audit.id;
        item.status = audit.verdict === 'fail' ? 'failed' : 'done';
        if (item.status === 'done') { usage.push(now); completed.push(item); }
      } catch (error) { item.status = 'failed'; item.error = error.message; }
    }
    store.setMeta('mae.gaiden', queue);
    store.setMeta('mae.gaiden_usage', usage);
    return { skipped: false, completed, queue };
  }

  applyPhysiologyUpdates(store, updates = {}) { const all = store.getMeta('mae.physiology') || {}; for (const [entityId, state] of Object.entries(updates || {})) all[entityId] = normalizePhysiologyState(state); store.setMeta('mae.physiology', all); }

  advanceStoredPhysiology({ store, fromTime, worldTime }) {
    const all = store.getMeta('mae.physiology') || {};
    const rules = this.getPhysiologyRules(store);
    const events = [];
    const deaths = [];
    for (const [entityId, state] of Object.entries(all)) {
      const result = advancePhysiology({ state, fromTime, worldTime, rules });
      all[entityId] = result.state;
      for (const event of result.events) {
        const enriched = { ...event, entityId };
        if (event.type === 'birth' && event.newEntity) {
          const parent = store.getEntity(entityId);
          const childId = `birth-${hash(`${entityId}:${worldTime}`)}`;
          if (!store.getEntity(childId)) store.upsertEntity({ id: childId, name: `${parent?.name || '未知实体'}的孩子`, type: 'npc', role: 'npc', introduction: `出生于${parent?.name || '未知实体'}的家庭。`, current_state: '新生儿', location: parent?.location || '', first_seen: 0, last_seen: 0, salience: 0.4, importance: 0.5, status: 'active' });
          enriched.childId = childId;
          store.appendTimeline({ id: `birth:${childId}:${worldTime}`, turn_seq: Number(store.getMeta('mae.last_turn')?.turnSeq || 0), world_time: worldTime, source: 'state_transition', scene: parent?.location || '', participants: [entityId, childId], description: `${parent?.name || '未知实体'}完成分娩，新实体${childId}登记。`, effects: ['birth'], pending_reveal: true });
        }
        events.push(enriched);
      }
      deaths.push(...result.deaths.map((death) => ({ ...death, entityId })));
    }
    store.setMeta('mae.physiology', all);
    return { events, deaths };
  }

  maybeQueueGaiden(store, entityIds = []) {
    if (!this.settingsFor(store).gaidenEnabled) return;
    for (const entityId of [...new Set(entityIds)]) {
      const count = store.listTimeline({ limit: 10000 }).filter((event) => event.source === 'tick' && event.participants.includes(entityId)).length;
      if (count >= 5) this.enqueueGaiden({ chatId: store.chatId, type: 'regular', entityIds: [entityId], title: `${store.getEntity(entityId)?.name || '角色'}的番外`, priority: 500, cause: 'event-chain' });
    }
  }

  async callJsonModel(slot, messages, options = {}) {
    if (this.modelRouter?.json) return this.modelRouter.json(slot, messages, options);
    if (this.llm?.json) return this.llm.json({ purpose: slot, messages, ...options });
    return null;
  }

  hasModel(slot) { return this.modelRouter ? this.modelRouter.isConfigured(slot) : Boolean(this.llm?.json); }

  async auditGenerated({ chatId, text, targetId = '', targetType = 'generation' } = {}) {
    const store = this.storeFor(chatId);
    const local = localAuditResult({ text, facts: store.listFacts({ limit: 200 }) });
    if (!this.modelRouter?.isConfigured('audit_A')) return store.insertAudit({ id: randomUUID(), target_type: targetType, target_id: targetId, verdict: local.verdict, violations: local.violations, retry_chain: [String(text)], ticket_status: local.verdict === 'fail' ? 'open' : 'closed' });
    try {
      const result = await this.callJsonModel('audit_A', [{ role: 'system', content: '你是中立世界审查者。只核对文本是否违反事实账本、人物状态和世界规则。只输出 JSON：{"verdict":"pass|warn|fail","violations":[]}。' }, { role: 'user', content: JSON.stringify({ text, facts: store.listFacts({ limit: 100 }), entities: store.listEntities() }) }], { maxTokens: 600, temperature: 0 });
      const verdict = ['pass', 'warn', 'fail'].includes(result?.verdict) ? result.verdict : local.verdict;
      const violations = Array.isArray(result?.violations) ? result.violations : local.violations;
      return store.insertAudit({ id: randomUUID(), target_type: targetType, target_id: targetId, verdict, violations, retry_chain: [String(text)], ticket_status: verdict === 'fail' ? 'open' : 'closed' });
    } catch { return store.insertAudit({ id: randomUUID(), target_type: targetType, target_id: targetId, verdict: local.verdict, violations: local.violations, retry_chain: [String(text)], ticket_status: local.verdict === 'fail' ? 'open' : 'closed' }); }
  }

  close() { this.stores.closeAll(); }
}

function normalizeEntities(items, text, turnSeq) {
  const explicit = Array.isArray(items) ? items : [];
  return explicit.map((item) => ({
    id: item.id, name: String(item.name || '').trim(), aliases: normalizeArray(item.aliases), type: String(item.type || 'npc'),
    introduction: String(item.introduction || ''), personality: String(item.personality || ''), behaviors: normalizeArray(item.behaviors ?? item.behavior), inventory: normalizeArray(item.inventory ?? item.items), current_state: String(item.current_state ?? item.currentState ?? ''), goals: normalizeArray(item.goals),
    relationships: item.relationships && typeof item.relationships === 'object' ? item.relationships : {}, location: String(item.location || ''),
    importance: clamp(Number(item.importance), 0, 1, 0.5), status: String(item.status || 'active'), gender: String(item.gender || 'unknown'), role: String(item.role || 'npc'),
    deceased_at: item.deceased_at ?? item.deceasedAt, death_cause: String(item.death_cause ?? item.deathCause ?? ''),
    birth_epoch: item.birth_epoch ?? item.birthEpoch, legacy_of: String(item.legacy_of ?? item.legacyOf ?? ''), last_seen: turnSeq,
  })).filter((item) => item.name);
}

function normalizeEditableEntity(value = {}) {
  return {
    ...value,
    name: String(value.name || '').trim(),
    aliases: normalizeArray(value.aliases),
    type: String(value.type || 'npc'),
    introduction: String(value.introduction || ''),
    personality: String(value.personality || ''),
    behaviors: normalizeArray(value.behaviors ?? value.behavior),
    inventory: normalizeArray(value.inventory ?? value.items),
    current_state: String(value.current_state ?? value.currentState ?? ''),
    goals: normalizeArray(value.goals),
    relationships: value.relationships && typeof value.relationships === 'object' && !Array.isArray(value.relationships) ? value.relationships : {},
    location: String(value.location || ''),
    status: String(value.status || 'active'),
    gender: String(value.gender || 'unknown'),
    role: String(value.role || 'npc'),
    importance: clamp(Number(value.importance), 0, 1, 0.5),
  };
}

function mergeEntities(existing, extracted) {
  const values = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(extracted) ? extracted : [])];
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item?.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeFacts(existing, extracted) {
  const values = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(extracted) ? extracted : [])];
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item?.content || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFacts(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id, entity_ids: normalizeArray(item.entity_ids ?? item.entityIds), category: String(item.category || 'plot'), content: String(item.content || '').trim(),
    confidence: clamp(Number(item.confidence), 0, 1, 0.5), importance: clamp(Number(item.importance), 0, 1, 0.5), valid_from: item.valid_from ?? item.validFrom,
  }));
}

function findEntity(entities, name, aliases) { return entities.find((entity) => entity.name === name || entity.aliases?.some((alias) => aliases.includes(alias) || alias === name)); }
function related(left, right) { return left?.length && right?.length && left.some((item) => right.includes(item)); }
function salience({ importance = 0.5, appearance_count = 1, last_seen = 0, turnSeq = 0 }) { const recency = Math.exp(-Math.max(0, turnSeq - Number(last_seen || 0)) / 8); const frequency = Math.min(1, Math.log1p(Number(appearance_count || 1)) / 4); return Number((0.35 * recency + 0.3 * importance + 0.15 * frequency + 0.2 * importance).toFixed(4)); }
function localViolations(text, constraints, facts) {
  const violations = (Array.isArray(constraints) ? constraints : []).flatMap((constraint) => {
    const prohibited = String(constraint.prohibited || constraint.quote || '').trim();
    return prohibited && text.toLowerCase().includes(prohibited.toLowerCase()) ? [{ reason: 'prohibited content', expected: constraint.expected || '', quote: prohibited }] : [];
  });
  for (const fact of facts) {
    const match = fact.content.match(/(.+?)(?:不会|不能|不得|禁止)(.+)/u);
    if (match && text.includes(match[1]) && /(使用|施展|挥|发动|做到|拥有)/u.test(text)) violations.push({ reason: 'possible fact drift', expected: fact.content, quote: text.slice(0, 160) });
  }
  return violations;
}
function localAuditResult({ text = '', constraints = [], facts = [] } = {}) { const violations = localViolations(String(text || ''), constraints, facts); return { violations, verdict: violations.length ? 'fail' : 'pass' }; }
function summarizeTurn(text) { return text.replace(/\s+/g, ' ').trim().slice(0, 600); }
function entityId(name) { return `entity-${hash(name)}`; }
function factId(content, turnSeq) { return `fact-${turnSeq}-${hash(content)}`; }
function hash(value) { return createHash('sha1').update(String(value)).digest('hex').slice(0, 16); }
function normalizeArray(value) { if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean); if (typeof value === 'string') return value.split(/[,，、\n]/u).map((item) => item.trim()).filter(Boolean); return []; }
function clamp(value, min, max, fallback) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function normalizeSettings(value) {
  return {
    ...value,
    tier: ['light', 'medium', 'heavy'].includes(value.tier) ? value.tier : 'medium',
    tickEvery: Math.max(0, Math.trunc(Number(value.tickEvery) || 0)),
    maxTickNpcs: Math.min(20, Math.max(1, Math.trunc(Number(value.maxTickNpcs) || 5))),
    enabled: value.enabled !== false,
    successorProtection: value.successorProtection !== false,
    successorProtectionTurns: Number.isFinite(Number(value.successorProtectionTurns)) ? Math.min(100, Math.max(0, Math.trunc(Number(value.successorProtectionTurns)))) : 10,
    gaidenEnabled: value.gaidenEnabled !== false,
    gaidenDailyLimit: Number.isFinite(Number(value.gaidenDailyLimit)) ? Math.min(20, Math.max(0, Math.trunc(Number(value.gaidenDailyLimit)))) : 3,
    physiologyRules: value.physiologyRules && typeof value.physiologyRules === 'object' ? value.physiologyRules : {},
  };
}

export function createDefaultMaeRuntime(options = {}) {
  const modelRouter = options.modelRouter || createDefaultModelRouter({ defaultApi: getLocalApiDefaults(), routes: options.modelRoutes || {} });
  return new MaeRuntime({ ...options, modelRouter, llm: options.llm || createLocalLlmAdapter(modelRouter) });
}

function createLocalLlmAdapter(router) {
  if (!router) return null;
  return { async json({ messages, purpose = 'main', maxTokens, temperature }) { return router.json(purpose, messages, { maxTokens, temperature }); } };
}
function parseJson(text) { try { return JSON.parse(text); } catch { const match = String(text).match(/\{[\s\S]*\}/u); return match ? JSON.parse(match[0]) : {}; } }
function safeChatId(value) { return String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default'; }
