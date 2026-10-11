import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Engine } from '../src/engine.mjs';
import { execute, number, integer, cancellable, sleep } from '../src/actions.mjs';
import { mapCells, forModel } from '../src/observation.mjs';
import { Vec3 } from 'vec3';

test('map comes from blocks, preserves unloaded regions and marks hazards', () => {
  const bot = { entity: { position: new Vec3(0, 65, 0) }, blockAt: p => p.x === 1 ? null : p.y === 64 ? { name: p.x === -1 ? 'lava' : 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' } };
  const map = mapCells(bot, 1);
  assert.equal(map.cells.length, 9);
  assert.equal(map.cells[0].hazardous, true); assert.equal(map.cells[0].walkable, false);
  assert.equal(map.cells[4].name, 'grass_block'); assert.equal(map.cells[4].y, 64);
  assert.equal(map.cells[5].name, 'unloaded');
  const model = forModel({ player: { health: 20 }, localMap: map });
  assert.equal(model.localMap.rows.length, 3); assert.equal(model.localMap.rows[1].length, 3); assert.ok(model.localMap.legend.includes('unloaded'));
});
test('invalid numbers, arbitrary commands and unknown actions cannot execute', async () => {
  assert.throws(() => number('3', 0, 10)); assert.throws(() => integer(1.5, 0, 10));
  const signal = new AbortController().signal;
  await assert.rejects(execute({}, { action: 'execute_shell' }, signal, () => {}), /不支持/);
  await assert.rejects(execute({}, { action: 'chat', args: { message: '/op bot' } }, signal, () => {}), /命令/);
});
test('abort races do not allow the next action step to run', async () => {
  const controller = new AbortController(); let late = false;
  const sequence = async () => { await cancellable(sleep(100), controller.signal); late = true; };
  const work = sequence(); controller.abort(new Error('stopped'));
  await assert.rejects(work, /stopped/); await sleep(120); assert.equal(late, false);
  await assert.rejects(cancellable(Promise.reject(new Error('underlying')), controller.signal), /stopped/);
});
const observation = () => ({ player: { health: 20, food: 20 }, inventory: [], localMap: { center: { x: 0, y: 65, z: 0 }, radius: 0, cells: [{ name: 'grass_block', y: 64, walkable: true }] } });
async function setupEngine(t, handler) {
  const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); handler(req, res, JSON.parse(Buffer.concat(chunks))); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [], engine = new Engine((event, data) => events.push({ event, data }), process.cwd());
  engine.ready = true; engine.observation = observation;
  t.after(() => { engine.close(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const profile = { protocol: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'test', apiKey: '', headersJson: '{}', maxTokens: 1024, temperature: 0.4, requestIntervalSeconds: 0 };
  return { engine, events, profile };
}
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(10); } throw new Error('timed out'); }
test('agent supplies structured world data, feeds back errors, then finishes', async t => {
  let calls = 0;
  const { engine, events, profile } = await setupEngine(t, (req, res, body) => {
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.goal, '采集木头'); assert.ok(context.observation.localMap.rows);
    if (calls++ > 0) assert.equal(context.history[0].error, 'no path');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { action: 'move_to', args: { x: 1, y: 65, z: 0 } } : { action: 'done', args: { summary: 'finished' } }) } }] }));
  });
  engine.action = async d => { if (d.action === 'move_to') throw new Error('no path'); return { summary: 'finished' }; };
  engine.startAgent({ goal: '采集木头', profile, preferences: { intervalSeconds: 0.5 } });
  assert.throws(() => engine.startAgent({ goal: 'other', profile }), /已有/);
  await until(() => engine.agent === null);
  assert.equal(calls, 2); assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'completed'));
});
test('stopping during model inference executes no late decision and permits a new session', async t => {
  let called = false, actions = 0;
  const { engine, events, profile } = await setupEngine(t, () => { called = true; });
  engine.action = async () => { actions++; };
  engine.startAgent({ goal: 'wait', profile }); await until(() => called);
  engine.stopAgent(); await until(() => engine.agent === null);
  assert.equal(actions, 0); assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'stopped'));
  engine.startAgent({ goal: 'restart', profile }); engine.stopAgent(); await until(() => engine.agent === null);
});

test('action failures do not count as consecutive model failures, and valid decisions reset the model counter', async t => {
  let calls = 0, actions = 0;
  const { engine, events, profile } = await setupEngine(t, (_, res) => {
    calls++;
    const text = calls === 2 || calls === 3 || calls === 5 ? 'invalid' : JSON.stringify({ action: calls === 6 ? 'done' : 'move_to', args: { summary: 'finished' } });
    res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
  engine.action = async d => { actions++; if (d.action === 'move_to') throw new Error('unreachable'); return { summary: 'finished' }; };
  engine.startAgent({ goal: '继续尝试', profile, preferences: { maxSteps: 6, intervalSeconds: 0.5 } });
  const session = engine.agent; await session.finished;
  assert.equal(calls, 6); assert.equal(actions, 3);
  assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'completed'));
  assert.ok(!events.some(e => e.event === 'log' && /连续三次/.test(e.data.message)));
});
test('bridge stdout stays JSON-lines and handles request failures without exiting', async t => {
  const process = spawn(globalThis.process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { process.kill(); });
  let output = ''; process.stdout.on('data', c => { output += c; });
  process.stdin.write('{"id":"a","type":"hello"}\n{"id":"b","type":"observe"}\n');
  await until(() => output.includes('"id":"b"'));
  const messages = output.trim().split('\n').map(JSON.parse);
  assert.equal(messages.find(m => m.id === 'a').result.protocolVersion, 1);
  assert.equal(messages.find(m => m.id === 'b').ok, false);
  process.stdin.end();
});

test('four routine actions use one plan, run consecutively, then confirm completion from fresh observation', async t => {
  let calls = 0; const actions = [], times = [];
  const { engine, events, profile } = await setupEngine(t, (_, res, body) => {
    const context = JSON.parse(body.messages[1].content);
    if (++calls === 1) {
      assert.equal(context.maxActions, 4);
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actions: Array.from({ length: 4 }, (_, n) => ({ action: 'craft', args: { item: `item_${n}` } })) }) } }] }));
    } else {
      assert.equal(actions.length, 4); assert.equal(context.history.length, 4);
      res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"done","args":{"summary":"完成"}}' } }] }));
    }
  });
  engine.action = async d => { actions.push(d.action); times.push(Date.now()); return { summary: '完成' }; };
  engine.startAgent({ goal: '制作四件物品', profile, preferences: { intervalSeconds: 0.5, maxSteps: 5 } });
  await engine.agent.finished;
  assert.equal(calls, 2); assert.deepEqual(actions, ['craft', 'craft', 'craft', 'craft', 'done']);
  assert.ok(times[3] - times[0] < 400, 'no artificial per-action sleep inside a batch');
  assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'completed'));
});

test('a failed batch discards all remaining actions and feeds the error into a new plan', async t => {
  let calls = 0; const actions = [];
  const { engine, profile } = await setupEngine(t, (_, res, body) => {
    if (++calls === 2) assert.equal(JSON.parse(body.messages[1].content).history[0].error, 'missing material');
    const decision = calls === 1 ? { actions: [{ action: 'craft', args: { item: 'stick' } }, { action: 'equip', args: { item: 'wooden_pickaxe' } }] } : { action: 'done' };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }] }));
  });
  engine.action = async d => { actions.push(d.action); if (d.action === 'craft') throw new Error('missing material'); return {}; };
  engine.startAgent({ goal: '恢复', profile, preferences: { intervalSeconds: 0.5 } }); await engine.agent.finished;
  assert.deepEqual(actions, ['craft', 'done']); assert.equal(calls, 2);
});

test('query results and partial collection invalidate dependent actions', async t => {
  let calls = 0; const actions = [];
  const { engine, profile } = await setupEngine(t, (_, res) => {
    const plan = ++calls === 1 ? { actions: [{ action: 'recipes', args: { item: 'stick' } }, { action: 'craft', args: { item: 'stick' } }] }
      : calls === 2 ? { actions: [{ action: 'collect', args: { name: 'oak_log', count: 4 } }, { action: 'craft', args: { item: 'oak_planks' } }] } : { action: 'done' };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  engine.action = async d => { actions.push(d.action); return d.action === 'collect' ? { mined: ['oak_log'], stoppedReason: 'unreachable' } : {}; };
  engine.startAgent({ goal: '继续采集', profile, preferences: { intervalSeconds: 0.5 } }); await engine.agent.finished;
  assert.deepEqual(actions, ['recipes', 'collect', 'done']); assert.equal(calls, 3);
});

test('done after changing the world requires a new model decision rather than trusting predicted success', async t => {
  let calls = 0; const actions = [];
  const { engine, profile } = await setupEngine(t, (_, res) => {
    const plan = ++calls === 1 ? { actions: [{ action: 'craft', args: { item: 'stick' } }, { action: 'done', args: { summary: 'prediction' } }] } : { action: 'done', args: { summary: 'verified' } };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  engine.action = async d => { actions.push(d); return { summary: d.args.summary }; };
  engine.startAgent({ goal: '制作木棍', profile, preferences: { intervalSeconds: 0.5 } }); await engine.agent.finished;
  assert.equal(calls, 2); assert.equal(actions[1].args.summary, 'verified');
});

test('temporary API failures resume the same task without consuming its action budget', async t => {
  const { engine, events, profile } = await setupEngine(t, () => {});
  let calls = 0;
  engine.requestModel = async () => {
    if (++calls <= 3) throw Object.assign(new Error('API temporarily unavailable'), { retryable: true });
    return { text: '{"action":"done","args":{"summary":"恢复成功"}}' };
  };
  engine.action = async () => ({ summary: '恢复成功' });
  engine.startAgent({ goal: '持续执行', profile, preferences: { maxSteps: 1, intervalSeconds: 0.5 } }); await engine.agent.finished;
  assert.equal(calls, 4);
  assert.equal(events.filter(e => e.event === 'agent' && e.data.state === 'recovering').length, 3);
  assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'completed' && e.data.step === 1));
});

test('authentication failures stop immediately rather than sending repeated requests', async t => {
  let calls = 0;
  const { engine, events, profile } = await setupEngine(t, (_, res) => { calls++; res.writeHead(401); res.end('private'); });
  engine.startAgent({ goal: '任务', profile }); await engine.agent.finished;
  assert.equal(calls, 1); assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'error'));
});

test('stopping after the first action cancels the buffered plan', async t => {
  const actions = [];
  const { engine, profile } = await setupEngine(t, (_, res) => res.end(JSON.stringify({ choices: [{ message: { content: '{"actions":[{"action":"craft","args":{"item":"stick"}},{"action":"equip","args":{"item":"wooden_pickaxe"}}]}' } }] })));
  engine.action = async d => { actions.push(d.action); engine.stopAgent(); return {}; };
  engine.startAgent({ goal: '停止', profile }); await engine.agent.finished;
  assert.deepEqual(actions, ['craft']);
});

test('damage discards a buffered plan before executing its next action', async t => {
  let calls = 0, health = 20; const actions = [];
  const { engine, profile } = await setupEngine(t, (_, res) => {
    const plan = ++calls === 1 ? { actions: [{ action: 'craft', args: { item: 'stick' } }, { action: 'equip', args: { item: 'wooden_pickaxe' } }] } : { action: 'done' };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  engine.observation = () => ({ ...observation(), player: { health, food: 20 } });
  engine.action = async d => { actions.push(d.action); health = 15; return {}; };
  engine.startAgent({ goal: '响应伤害', profile, preferences: { intervalSeconds: 0.5 } }); await engine.agent.finished;
  assert.deepEqual(actions, ['craft', 'done']); assert.equal(calls, 2);
});
