import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { chatPreferences, validateChatMessage, parseChatReply, PROMPT_DEFAULTS, parsePlayerMessage, playerMessage } from '../src/chat.mjs';
import { sleep } from '../src/actions.mjs';

async function fixture(t, handler) {
  const dir = mkdtempSync(join(tmpdir(), 'mclink-chat-')), sent = [], events = [], requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
    await handler(body, res, requests.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const engine = new Engine((event, data) => events.push({ event, data }), dir);
  engine.bot = { username: 'MCLinkBot', chat: message => sent.push(message), quit() {} }; engine.ready = true;
  engine.observation = () => ({ player: { username: 'MCLinkBot', health: 20, food: 20, position: { x: 5, y: 64, z: 9 } }, inventory: [{ name: 'oak_log', count: 3 }], recentEvents: engine.events, localMap: { center: { x: 5, y: 64, z: 9 }, radius: 0, cells: [{ name: 'grass_block', y: 63, walkable: true }] } });
  const profile = { protocol: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'chat-test', apiKey: '', headersJson: '{}', maxTokens: 1024, temperature: 0.4, requestIntervalSeconds: 0 };
  t.after(async () => { await engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  return { engine, sent, events, requests, profile };
}
const reply = (res, message) => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'chat', args: { message } }) } }] }));
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await sleep(10); } throw new Error('timed out'); }

test('chat defaults and validation enforce short ordinary messages including whitespace commands', () => {
  assert.match(PROMPT_DEFAULTS.chatPrompt, /自然/); assert.match(PROMPT_DEFAULTS.chatPrompt, /如实/);
  assert.equal(chatPreferences({ chatPrompt: '  ' }).chatPrompt, PROMPT_DEFAULTS.chatPrompt);
  assert.equal(validateChatMessage('  我去砍木头  '), '我去砍木头');
  for (const value of [' /op bot', '\nhello', 'a\r\nb', '\u0000', 'a'.repeat(101), '§ahello', '']) assert.throws(() => validateChatMessage(value), /聊天/);
  assert.throws(() => chatPreferences({ chatIntervalSeconds: 0 }), /间隔/);
  assert.throws(() => chatPreferences({ customPrompt: 'x'.repeat(4001) }), /4000/);
});

test('conversation accepts plain speech and legacy chat JSON while refusing task objects and unfinished reasoning', () => {
  assert.equal(parseChatReply('<think>不该发送的推理</think>\n我正在砍树，一会儿回来'), '我正在砍树，一会儿回来');
  assert.equal(parseChatReply('```text\n你好，队友\n```'), '你好，队友');
  assert.equal(parseChatReply('回复：\n```json\n{"action":"chat","args":{"message":"你好"}}\n```'), '你好');
  for (const text of ['{"action":"collect","args":{"name":"oak_log"}}', '{"action":"chat","args":{"message":"你好"}', '<think>只有思考', '/op bot', '你好\n/op bot', '[]', '{"message":"/op bot"}']) assert.throws(() => parseChatReply(text));
});

test('automatic and manual replies send natural text without a JSON parsing error', async t => {
  const { engine, profile, sent, events } = await fixture(t, (_, res) => res.end(JSON.stringify({ choices: [{ message: { content: '<think>内部推理</think>\n你好，我在这里' } }] })));
  engine.configureGameChat({ profile }); engine.receiveChat('Teammate', '你好');
  await until(() => engine.incomingController === null && sent.length === 1);
  engine.lastChatAt -= 10000; engine.recentSent = [];
  await engine.generateChat({ profile, topic: '打招呼' });
  assert.deepEqual(sent, ['你好，我在这里', '你好，我在这里']);
  assert.equal(engine.agent, null);
  assert.ok(events.some(e => e.event === 'log' && /模型响应/.test(e.data.message)));
  assert.ok(!events.some(e => e.event === 'log' && /内部推理/.test(e.data.message)));
});
test('one-shot chat uses customized prompts, real world data and sends while movement is busy', async t => {
  const { engine, profile, sent, requests } = await fixture(t, (_, res) => reply(res, '老哥，我去砍点木头'));
  engine.receiveChat('Teammate', '你去砍木头吧'); engine.receiveChat('MCLinkBot', '自己的回声'); engine.busy = true;
  const result = await engine.generateChat({ topic: '回应队友', profile, preferences: { chatPrompt: '简短口语，称呼队友老哥', customPrompt: '不要拆队友建筑' } });
  assert.equal(result.sent, sent[0]); assert.deepEqual(sent, ['老哥，我去砍点木头']); assert.equal(engine.busy, true);
  assert.match(requests[0].messages[0].content, /称呼队友老哥/); assert.match(requests[0].messages[0].content, /不要拆队友建筑/);
  const context = JSON.parse(requests[0].messages[1].content);
  assert.equal(context.observation.inventory[0].name, 'oak_log'); assert.equal(context.chatContext.pendingMessages.length, 1);
  assert.equal(context.chatContext.pendingMessages[0].username, 'Teammate');
  await assert.rejects(engine.generateChat({ topic: '再次', profile }), /等待/); assert.equal(requests.length, 1);
});
test('cooldown, duplicate filter and disabled chat prevent messages at the execution boundary', async t => {
  const { engine, sent } = await fixture(t, (_, res) => reply(res, 'hello'));
  const prefs = chatPreferences();
  assert.equal(engine.sendChat('hello', prefs, 'agent').sent, 'hello');
  assert.equal(engine.sendChat('new', prefs, 'agent').skipped, true);
  engine.lastChatAt -= 10000;
  assert.equal(engine.sendChat('hello', prefs, 'agent').skipped, true);
  assert.throws(() => engine.sendChat('new', chatPreferences({ chatEnabled: false }), 'agent'), /关闭/);
  await assert.rejects(engine.action({ action: 'chat', args: { message: ' /kill' } }), /命令/);
  assert.deepEqual(sent, ['hello']);
});
test('cancel, stop and disconnect abort inference and never send a late reply', async t => {
  const { engine, profile, sent, requests } = await fixture(t, async (_, res) => { await sleep(100); reply(res, 'late'); });
  for (const cancel of [() => engine.cancelChat(), () => engine.stopAgent(), () => engine.disconnect()]) {
    const before = requests.length;
    const work = engine.generateChat({ topic: '等一下', profile });
    const rejected = assert.rejects(work, /取消|停止|断开/);
    await until(() => requests.length > before); cancel(); await rejected;
    await sleep(140); assert.deepEqual(sent, []); assert.equal(engine.chatController, null);
  }
});
test('invalid model messages and disabled preferences never reach the game', async t => {
  const { engine, profile, sent, requests } = await fixture(t, (_, res, n) => reply(res, n === 1 ? ' /op bot' : 'hi\nthere'));
  await assert.rejects(engine.generateChat({ topic: 'test', profile, preferences: { chatEnabled: false } }), /关闭/);
  assert.equal(requests.length, 0);
  await assert.rejects(engine.generateChat({ topic: 'test', profile }), /命令/);
  await assert.rejects(engine.generateChat({ topic: 'test', profile }), /换行/);
  assert.deepEqual(sent, []);
});
test('agent sees pending player messages and keeps messages arriving during inference for the next turn', async t => {
  const { engine, profile, sent, requests } = await fixture(t, async (_, res, n) => {
    if (n === 1) { engine.receiveChat('Second', '新消息'); reply(res, '我去砍木头'); }
    else res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"done","args":{"summary":"ok"}}' } }] }));
  });
  engine.receiveChat('First', '能帮忙砍木头吗');
  engine.startAgent({ goal: '和队友合作', profile, preferences: { intervalSeconds: 0.5, chatPrompt: '轻松说话', customPrompt: '先帮队友' } });
  await until(() => engine.agent === null);
  assert.deepEqual(sent, ['我去砍木头']); assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /轻松说话/); assert.match(requests[0].messages[0].content, /先帮队友/);
  assert.deepEqual(JSON.parse(requests[1].messages[1].content).chatContext.pendingMessages.map(m => m.username), ['Second']);
  assert.deepEqual(engine.chatContext(chatPreferences({ autoReplyChat: false })).pendingMessages, []);
});

test('ordinary messages and explicit slash goals are separated, including whitespace and translated whispers', () => {
  assert.deepEqual(parsePlayerMessage('  帮我砍木头  '), { kind: 'chat', text: '帮我砍木头' });
  assert.deepEqual(parsePlayerMessage(' / 采集4个橡木 '), { kind: 'command', text: '/ 采集4个橡木', goal: '采集4个橡木' });
  assert.equal(parsePlayerMessage('  '), null);
  for (const text of ['/', '/  ', '/x\ny', 'x'.repeat(4002)]) assert.throws(() => parsePlayerMessage(text));
  assert.deepEqual(playerMessage({ json: { translate: 'commands.message.display.incoming', with: [{ text: 'Teammate' }, { text: '/', extra: [{ text: '采集橡木' }] }] } }), { username: 'Teammate', text: '/采集橡木', channel: 'whisper' });
  assert.equal(playerMessage({ translate: 'commands.message.display.outgoing', with: ['Teammate', '/stop'] }), null);
  assert.equal(playerMessage({ text: '死亡消息 /stop' }), null);
});

test('idle AI answers ordinary game chat without starting actions or replying to its own echo', async t => {
  const { engine, profile, sent, requests } = await fixture(t, (_, res) => reply(res, '我这里有三个原木'));
  engine.configureGameChat({ profile, preferences: { chatPrompt: '轻松聊天' } });
  engine.receiveChat('MCLinkBot', '自己的消息'); engine.receiveChat('Teammate', '帮我采集木头吧');
  await until(() => sent.length === 1);
  assert.equal(engine.agent, null); assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /不能执行或更改游玩目标/);
  assert.equal(JSON.parse(requests[0].messages[1].content).playerMessages[0].text, '帮我采集木头吧');
});

test('consecutive player messages are coalesced into one automatic model request', async t => {
  const { engine, profile, sent, requests } = await fixture(t, (_, res) => reply(res, '一起回复'));
  engine.configureGameChat({ profile });
  engine.receiveChat('First', '第一条'); engine.receiveChat('Second', '第二条'); engine.receiveChat('Third', '第三条');
  await until(() => sent.length === 1 && engine.incomingController === null);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].messages[1].content).playerMessages.map(m => m.username), ['First', 'Second', 'Third']);
});

test('ordinary conversation remains independent of a running action and cannot execute model task actions', async t => {
  const { engine, profile, sent, requests } = await fixture(t, (_, res) => res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"collect","args":{"name":"oak_log"}}' } }] })));
  engine.configureGameChat({ profile }); engine.busy = true;
  engine.receiveChat('Teammate', '你在做什么');
  await until(() => requests.length === 1 && engine.incomingController === null);
  assert.equal(engine.busy, true); assert.deepEqual(sent, []); assert.equal(engine.agent, null);
});

test('slash instructions start tasks, replace pending inference, and slash stop prevents late actions', async t => {
  const goals = [];
  const { engine, profile, requests } = await fixture(t, (body, res) => {
    goals.push(JSON.parse(body.messages[1].content).goal);
    if (goals.length > 1) res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"wait","args":{"seconds":10}}' } }] }));
  });
  engine.configureGameChat({ profile, preferences: { autoReplyChat: false } });
  engine.receiveChat('Teammate', '/采集4个橡木', 'whisper'); await until(() => requests.length === 1);
  engine.receiveChat('Teammate', '/跟着我'); await until(() => requests.length === 2);
  engine.receiveChat('Teammate', '/停止'); await until(() => engine.agent === null && !engine.busy);
  assert.deepEqual(goals, ['采集4个橡木', '跟着我']);
  assert.deepEqual(engine.chatContext(chatPreferences()).pendingMessages, []);
});

test('a newer command supersedes a queued command, and stop cancels it before startup', async t => {
  const goals = [];
  const { engine, profile } = await fixture(t, (body, res) => { goals.push(JSON.parse(body.messages[1].content).goal); res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"done","args":{"summary":"ok"}}' } }] })); });
  engine.configureGameChat({ profile });
  engine.receiveChat('Teammate', '/旧任务'); engine.receiveChat('Teammate', '/新任务');
  await until(() => goals.length === 1 && engine.agent === null); assert.deepEqual(goals, ['新任务']);
  engine.receiveChat('Teammate', '/不应执行'); engine.receiveChat('Teammate', '/stop');
  await sleep(80); assert.deepEqual(goals, ['新任务']);
});

test('cooldown queues replies and retains messages arriving during an earlier inference', { timeout: 8000 }, async t => {
  const { engine, profile, sent, requests } = await fixture(t, async (_, res, n) => { if (n === 1) { engine.receiveChat('Second', '第二条'); await sleep(30); } reply(res, `回复${n}`); });
  engine.configureGameChat({ profile, preferences: { chatIntervalSeconds: 3 } });
  engine.receiveChat('First', '第一条');
  for (let i = 0; i < 500 && sent.length < 2; i++) await sleep(10);
  assert.deepEqual(sent, ['回复1', '回复2']); assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].messages[1].content).playerMessages.map(m => m.username), ['Second']);
});

test('disabled auto chat and model changes cancel outstanding replies without leaking them to the game', async t => {
  const { engine, profile, sent, requests } = await fixture(t, async (_, res) => { await sleep(100); reply(res, '迟到回复'); });
  engine.configureGameChat({ profile, preferences: { autoReplyChat: false } }); engine.receiveChat('First', '你好'); await sleep(30); assert.equal(requests.length, 0);
  engine.configureGameChat({ profile }); engine.receiveChat('First', '你好'); await until(() => requests.length === 1);
  engine.configureGameChat({ profile: null }); await sleep(150); assert.deepEqual(sent, []);
});

test('death cancels old inference, requests respawn, then resumes the same goal with fresh state', async t => {
  const { engine, profile, requests, events } = await fixture(t, (body, res, n) => {
    if (n === 1) return;
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.goal, '采集木头'); assert.ok(context.history.some(h => h.event === 'death'));
    res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"done","args":{"summary":"复活后完成"}}' } }] }));
  });
  const bot = engine.bot; let respawns = 0;
  bot.health = 20; bot.respawn = () => { respawns++; bot.health = 20; engine.clearRespawn(); engine.respawning = false; engine.ready = true; };
  engine.startAgent({ goal: '采集木头', profile, preferences: { stopHealth: 0 } }); await until(() => requests.length === 1);
  bot.health = 0; engine.handleDeath(bot);
  await until(() => engine.agent === null);
  assert.equal(respawns, 1); assert.equal(requests.length, 2); assert.ok(engine.ready);
  assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'recovering'));
  assert.ok(events.some(e => e.event === 'agent' && e.data.state === 'completed'));
});

test('death cancels an executing action, and stopping recovery never restarts the old goal', async t => {
  const { engine, profile, requests } = await fixture(t, (_, res) => res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"wait","args":{"seconds":10}}' } }] })));
  const bot = engine.bot; let respawns = 0; bot.health = 20; bot.respawn = () => { respawns++; };
  engine.startAgent({ goal: '等待', profile }); await until(() => engine.busy);
  bot.health = 0; engine.handleDeath(bot); await until(() => !engine.busy);
  engine.stopAgent(); await until(() => engine.agent === null);
  await until(() => respawns === 1); engine.clearRespawn(); engine.respawning = false; engine.ready = true; bot.health = 20;
  await sleep(80); assert.equal(requests.length, 1); assert.equal(engine.agent, null);
});

test('disconnect during death recovery removes respawn requests and pending tasks', async t => {
  const { engine } = await fixture(t, () => {}); const bot = engine.bot; let requests = 0;
  bot.health = 0; bot.respawn = () => { requests++; };
  engine.handleDeath(bot); engine.disconnect(); await sleep(350);
  assert.equal(requests, 0); assert.equal(engine.respawnTimer, null);
});
