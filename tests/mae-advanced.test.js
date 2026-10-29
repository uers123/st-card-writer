import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createMaeRouter } from '../src/mae/routes.js';
import { MaeRuntime } from '../src/mae/runtime.js';
import { createStore } from '../src/mae/store.js';
import { advancePhysiology, renderPhysiology, settleSexualContact } from '../src/mae/physiology.js';
import { createVectorIndex, recallVectors } from '../src/mae/vector.js';
import { ModelRouter } from '../src/mae/model-router.js';

function makeRuntime(options = {}) {
  const store = createStore({ chatId: 'advanced-test', memory: true });
  const storeManager = { forChat: () => store, closeAll: () => store.close() };
  return new MaeRuntime({ storeManager, ...options });
}

test('six physiology groups advance deterministically and render without mutating source', () => {
  const state = {
    pregnancy: { since: 0 },
    injury: [{ name: '致命伤', severity: 4, since: 0 }],
    addiction: { substance: '药物', level: 3, lastDose: 0 },
    aging: { birthEpoch: -71 * 365.25 * 86400 },
    contraception: [{ method: '短效措施', until: 10 }],
    disease: [{ name: '感染', since: 0, latencyDays: 2 }],
    healthLow: true,
  };
  const before = JSON.stringify(state);
  const result = advancePhysiology({ state, worldTime: 4 * 86400, fromTime: 0 });
  assert.equal(JSON.stringify(state), before);
  assert.ok(result.deaths.some((item) => item.cause.includes('致命伤')));
  assert.ok(result.deaths.some((item) => item.cause.includes('高龄')));
  assert.equal(result.state.addiction.withdrawal, true);
  assert.equal(result.state.disease[0].stage, 'symptomatic');
  assert.match(renderPhysiology(result.state, 4 * 86400), /伤势|戒断|疾病/);
});

test('sexual contact settles pregnancy and disease using supplied RNG and contraception', () => {
  const result = settleSexualContact({
    actorIds: ['a', 'b'], worldTime: 100, states: { a: {}, b: { disease: [{ name: '病', contagion: 1, since: 0 }] } },
    rules: { contraception: { methods: [] }, std: { diseases: [{ name: '病', contagion: 1 }] } }, rng: () => 0.5,
  });
  assert.equal(result.pregnancy.length, 1);
  assert.equal(result.disease.length, 1);
  const protectedResult = settleSexualContact({ actorIds: ['a', 'b'], states: { a: { contraception: [{ method: 'x', effectiveness: 1 }] }, b: {} }, rng: () => 0.5 });
  assert.equal(protectedResult.pregnancy.length, 0);
});

test('vector retrieval returns semantic channel and honors precomputed provider scores', () => {
  const entries = [{ id: 'law', title: '古城法令', keys: [], content: '城门在日落后关闭' }, { id: 'food', title: '厨房', keys: [], content: '厨房储存粮食' }];
  const index = createVectorIndex(entries);
  const result = recallVectors(index, '城门关闭', { threshold: 0, limit: 1, precomputedScores: { law: 0.99, food: 0.01 } });
  assert.equal(result[0].entry.id, 'law');
  assert.equal(result[0].source, 'vector');
});

test('model router isolates slots and retries transient errors without exposing keys', async () => {
  const calls = [];
  const router = new ModelRouter({ defaultApi: { baseUrl: 'http://model.test/v1', apiKey: 'local-secret', model: 'main-model' }, routes: { audit_A: { followMain: false, baseUrl: 'http://audit.test/v1', apiKey: 'audit-secret', model: 'cheap-model' } }, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (calls.length === 1) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const response = await router.json('audit_A', [{ role: 'user', content: 'test' }], { retries: 1 });
  assert.deepEqual(response, { ok: true });
  assert.equal(calls[0].body.model, 'cheap-model');
  assert.equal(router.getRoutes().slots.audit_A.apiKeyConfigured, true);
  assert.equal(JSON.stringify(router.getRoutes()).includes('audit-secret'), false);
  router.setRoutes({ slots: { audit_A: { followMain: false, model: 'updated-model' } } });
  assert.equal(router.resolve('audit_A').apiKey, 'audit-secret');
});

test('session snapshots never expose private model route credentials', () => {
  const runtime = makeRuntime();
  const store = runtime.storeFor('secret-test');
  store.setMeta('mae.model_routes_private', { default: { apiKey: 'local-secret-key' }, slots: {} });
  store.setMeta('mae.model_routes', { default: { apiKeyConfigured: true }, slots: {} });
  const snapshot = runtime.snapshot('secret-test');
  assert.equal(JSON.stringify(snapshot).includes('local-secret-key'), false);
  assert.equal(snapshot.meta['mae.model_routes_private'], undefined);
  runtime.close();
});

test('entity profiles persist editable personality, behavior, and inventory fields', () => {
  const runtime = makeRuntime();
  runtime.processTurn({ chatId: 'profile', turnSeq: 1, text: 'NPC 登场。', entities: [{ id: 'npc-1', name: '守门人', type: 'npc', personality: '谨慎', behaviors: ['巡查城门'], inventory: ['旧钥匙'] }] });
  const updated = runtime.updateEntity({ chatId: 'profile', entityId: 'npc-1', patch: { personality: '多疑但守约', behaviors: ['巡查城门', '记录访客'], inventory: ['旧钥匙', '哨笛'] } });
  assert.equal(updated.personality, '多疑但守约');
  assert.deepEqual(updated.behaviors, ['巡查城门', '记录访客']);
  assert.deepEqual(updated.inventory, ['旧钥匙', '哨笛']);
  assert.equal(runtime.snapshot('profile').entities[0].inventory[1], '哨笛');
  runtime.close();
});

test('death, final gaiden and successor handoff form a persistent chain', async () => {
  const runtime = makeRuntime({ llm: { async json({ purpose }) { return purpose === 'gaiden' ? { title: '终章', content: '死者的一生在账本中保持一致。', stateSettlement: { closed: true } } : { actions: '后台事件', state_change: '继续生活' }; } } });
  const first = runtime.processTurn({ chatId: 'story', turnSeq: 1, text: '主角出现', entities: [{ id: 'p', name: '旧主角', type: 'main', role: 'player', current_state: '健康' }, { id: 'n', name: 'NPC', type: 'npc', salience: 0.8 }] });
  assert.equal(first.participants.length, 2);
  assert.equal(runtime.snapshot('story').meta['mae.player'], 'p');
  const old = runtime.storeFor('story').listEntities().find((item) => item.name === '旧主角');
  const deathResult = runtime.markDeath({ chatId: 'story', entityId: old.id, cause: '剧情终止', turnSeq: 2, worldTime: 10 });
  assert.equal(deathResult.deceased, true);
  assert.equal(runtime.listGaiden('story')[0].type, 'final');
  const successor = runtime.createSuccessor({ chatId: 'story', deceasedId: old.id, name: '新主角', relation: '门人', identity: '携带遗物的继承者', turnSeq: 2 });
  assert.equal(successor.successor.role, 'player');
  const firstInjection = runtime.buildInjection({ chatId: 'story', turnSeq: 3, contextText: '新主角' });
  const secondInjection = runtime.buildInjection({ chatId: 'story', turnSeq: 4, contextText: '新主角' });
  assert.match(firstInjection.assembled.top, /继任交接/);
  assert.doesNotMatch(secondInjection.assembled.top, /继任交接/);
  const gaiden = await runtime.processGaiden({ chatId: 'story' });
  assert.equal(gaiden.completed[0].status, 'done');
  runtime.close();
});

test('five tick events automatically enqueue one regular gaiden and daily limit gates generation', async () => {
  const runtime = makeRuntime({ settings: { gaidenDailyLimit: 1 }, llm: { async json({ purpose }) { return purpose === 'gaiden' ? { title: 'NPC侧记', content: '后台生活记录。' } : { actions: 'NPC独立行动', state_change: '状态推进' }; } } });
  runtime.processTurn({ chatId: 'story', turnSeq: 1, text: 'NPC离场', entities: [{ id: 'n', name: '休眠NPC', type: 'npc', status: 'dormant', salience: 0.8 }] });
  for (let index = 0; index < 5; index += 1) await runtime.runTick({ chatId: 'story', deltaSeconds: 1 });
  const chapters = runtime.listGaiden('story');
  assert.equal(chapters.filter((item) => item.type === 'regular').length, 1);
  assert.equal(chapters.find((item) => item.type === 'regular').status, 'done');
  runtime.enqueueGaiden({ chatId: 'story', type: 'regular', entityIds: ['n'], title: '第二章' });
  const gated = await runtime.processGaiden({ chatId: 'story' });
  assert.equal(gated.skipped, true);
  assert.match(gated.reason, /daily limit/);
  runtime.close();
});

test('advanced HTTP routes transfer model, physiology, death, successor and gaiden data', async (t) => {
  const runtime = makeRuntime();
  const app = express();
  app.use(express.json());
  app.use('/api/mae', createMaeRouter({ runtime }));
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => { server.close(); runtime.close(); });
  const port = server.address().port;
  runtime.processTurn({ chatId: 'http', turnSeq: 1, text: '实体登场。', entities: [{ id: 'http-npc', name: 'HTTP NPC', type: 'npc' }] });
  const entity = await fetch(`http://127.0.0.1:${port}/api/mae/entity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: 'http', entityId: 'http-npc', patch: { personality: '冷静', behaviors: ['观察'], inventory: ['徽章'] } }) });
  assert.equal(entity.ok, true);
  assert.deepEqual((await entity.json()).entity.inventory, ['徽章']);
  const rules = await fetch(`http://127.0.0.1:${port}/api/mae/physiology/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: 'http', rules: { aging: { naturalDeathAge: 80 } } }) });
  assert.equal(rules.ok, true);
  assert.equal((await rules.json()).rules.aging.naturalDeathAge, 80);
  assert.equal(runtime.snapshot('http').meta['mae.physiology_rules'].aging.naturalDeathAge, 80);
  const routes = await fetch(`http://127.0.0.1:${port}/api/mae/model-routes?chatId=http`);
  assert.equal(routes.ok, true);
  const queued = await fetch(`http://127.0.0.1:${port}/api/mae/gaiden/enqueue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: 'http', title: '测试番外', entityIds: [] }) });
  assert.equal((await queued.json()).entry.status, 'queued');
});
