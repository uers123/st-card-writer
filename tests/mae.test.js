import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createMaeRouter } from '../src/mae/routes.js';
import { MaeRuntime } from '../src/mae/runtime.js';
import { createStore } from '../src/mae/store.js';
import { buildInjectionModel } from '../src/mae/injection.js';

function makeRuntime(options = {}) {
  const store = createStore({ chatId: 'test', memory: true });
  const storeManager = { forChat: () => store, closeAll: () => store.close() };
  return new MaeRuntime({ storeManager, ...options });
}

test('MAE runtime records entities, facts, timeline, and structured injection', (t) => {
  const runtime = makeRuntime();
  t.after(() => runtime.close());

  const result = runtime.processTurn({
    chatId: 'story',
    turnSeq: 1,
    text: '林逸尘在城南客栈遇到柳如烟。',
    entities: [
      { name: '林逸尘', type: 'main', current_state: '在城南客栈', importance: 0.9 },
      { name: '柳如烟', type: 'npc', goals: ['隐瞒卧底身份'] },
    ],
    facts: [{ entity_ids: ['hero'], category: 'world_rule', content: '法术需要消耗寿命。', importance: 0.95 }],
  });

  assert.equal(result.skipped, false);
  const injection = runtime.buildInjection({ chatId: 'story', turnSeq: 12, contextText: '城南客栈 林逸尘' });
  assert.equal(injection.tier, 'medium');
  assert.match(injection.assembled.top, /世界运行原则/);
  assert.match(injection.assembled.mid, /林逸尘/);
  assert.match(injection.assembled.bottom, /法术需要消耗寿命/);
  assert.ok(injection.stats.estimatedTokens <= 1500);
});

test('fact ledger supersedes conflicting facts while keeping the new fact traceable', (t) => {
  const runtime = makeRuntime();
  t.after(() => runtime.close());
  runtime.processTurn({ chatId: 'story', turnSeq: 1, text: '事实一', facts: [{ entity_ids: ['e1'], category: 'ability', content: '林逸尘不会武功', importance: 0.9 }] });
  runtime.processTurn({ chatId: 'story', turnSeq: 2, text: '事实二', facts: [{ entity_ids: ['e1'], category: 'ability', content: '林逸尘学会了基础剑术', importance: 0.8 }] });
  const facts = runtime.snapshot('story').facts;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].content, '林逸尘学会了基础剑术');
});

test('audit creates an open ticket for explicit constraint violations', (t) => {
  const runtime = makeRuntime();
  t.after(() => runtime.close());
  const audit = runtime.auditText({ chatId: 'story', turnSeq: 3, text: '林逸尘使用禁术。', constraints: [{ prohibited: '禁术', expected: '不得使用禁术' }] });
  assert.equal(audit.verdict, 'fail');
  assert.equal(audit.ticket_status, 'open');
  assert.equal(runtime.snapshot('story').audits.length, 1);
});

test('background tick uses an adapter and persists offscreen events', async (t) => {
  const runtime = makeRuntime({ llm: { async json() { return { actions: '阿福把信送到了驿站。', state_change: '已经送达', new_location: '城西驿站', notable_event: '信件送达' }; } } });
  t.after(() => runtime.close());
  runtime.processTurn({ chatId: 'story', turnSeq: 1, text: '阿福离开了。', entities: [{ name: '阿福', type: 'npc', status: 'dormant', importance: 0.4 }] });
  const result = await runtime.runTick({ chatId: 'story', deltaSeconds: 86400 });
  assert.equal(result.skipped, false);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source, 'tick');
  assert.equal(runtime.snapshot('story').timeline[0].source, 'tick');
});

test('turns advance by the default half-day and duplicate message IDs are idempotent', (t) => {
  const runtime = makeRuntime();
  t.after(() => runtime.close());
  const first = runtime.processTurn({ chatId: 'story', turnSeq: 1, messageId: 'm-1', text: '第一轮。' });
  const duplicate = runtime.processTurn({ chatId: 'story', turnSeq: 1, messageId: 'm-1', text: '第一轮。' });
  assert.equal(first.worldTime, 12 * 60 * 60);
  assert.equal(duplicate.skipped, true);
  assert.equal(runtime.snapshot('story').timeline.length, 1);
});

test('tick event sequences are monotonic when multiple NPCs act', async (t) => {
  const runtime = makeRuntime({ llm: { async json() { return { actions: '发生了后台事件。' }; } } });
  t.after(() => runtime.close());
  runtime.processTurn({ chatId: 'story', turnSeq: 8, text: '两位 NPC 离开。', entities: [{ name: '甲', type: 'npc', status: 'dormant' }, { name: '乙', type: 'npc', status: 'dormant' }] });
  const result = await runtime.runTick({ chatId: 'story', deltaSeconds: 86400 });
  assert.deepEqual(result.events.map((event) => event.turn_seq), [9, 10]);
  const second = await runtime.runTick({ chatId: 'story', deltaSeconds: 86400 });
  assert.deepEqual(second.events.map((event) => event.turn_seq), [11, 12]);
});

test('async turn seam lets the configured model extract entities and facts', async (t) => {
  const runtime = makeRuntime({ llm: { async json({ purpose }) { assert.equal(purpose, 'extract'); return { entities: [{ name: '阿福', type: 'npc', current_state: '在驿站' }], facts: [{ category: 'identity', content: '阿福负责送信', importance: 0.8 }] }; } } });
  t.after(() => runtime.close());
  const result = await runtime.processTurnAsync({ chatId: 'story', turnSeq: 1, text: '阿福负责把信送到驿站。' });
  assert.equal(result.extractionError, null);
  assert.equal(runtime.snapshot('story').entities[0].name, '阿福');
  assert.equal(runtime.snapshot('story').facts[0].content, '阿福负责送信');
});

test('injection is a pure view model and worldbook keyword recall wins', () => {
  const input = {
    entities: [{ name: '阿福', type: 'npc', status: 'active', salience: 0.8, importance: 0.7, current_state: '在驿站' }],
    facts: [],
    timeline: [],
    worldbook: [{ title: '驿站', keys: ['驿站'], content: '驿站由旧盟约保护。' }],
    contextText: '阿福在驿站',
    settings: { tier: 'light' },
  };
  const before = JSON.stringify(input);
  const result = buildInjectionModel(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.recalledWorldbook[0].source, 'keyword');
  assert.match(result.assembled.mid, /驿站由旧盟约保护/);
});

test('MAE HTTP seam exposes session, turn, and injection', async (t) => {
  const runtime = makeRuntime();
  const app = express();
  app.use(express.json());
  app.use('/api/mae', createMaeRouter({ runtime }));
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => { server.close(); runtime.close(); });
  const port = server.address().port;
  const turn = await fetch(`http://127.0.0.1:${port}/api/mae/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: 'http', turnSeq: 1, text: '世界发生了变化。' }) });
  assert.equal(turn.ok, true);
  const injection = await fetch(`http://127.0.0.1:${port}/api/mae/injection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: 'http', contextText: '世界' }) });
  assert.equal(injection.ok, true);
  assert.equal((await injection.json()).ok, true);
});
