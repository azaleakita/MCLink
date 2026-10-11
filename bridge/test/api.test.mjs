import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { complete, endpoint, listModels, parseDecision, parsePlan, validateProfile } from '../src/api.mjs';
import { RequestScheduler, retryAfterMs } from '../src/request-scheduler.mjs';

const profile = overrides => ({ protocol: 'openai', baseUrl: 'http://localhost/v1', model: 'text-model', apiKey: 'test-secret', headersJson: '{}', maxTokens: 2048, temperature: 0.4, requestIntervalSeconds: 0, ...overrides });
async function fixture(t, handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    handler(req, res, body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('OpenAI compatible generation uses configured endpoint, headers and plain text messages', async t => {
  const url = await fixture(t, (req, res, body) => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer test-secret'); assert.equal(req.headers['x-custom'], 'works');
    assert.equal(body.model, 'text-model'); assert.equal(body.tools, undefined); assert.equal(body.response_format, undefined); assert.equal(body.messages[0].content, 'hello');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"wait","args":{"seconds":1}}' } }], usage: { total_tokens: 8 } }));
  });
  const reply = await complete(profile({ baseUrl: url + '/v1', headersJson: '{"x-custom":"works"}' }), [{ role: 'user', content: 'hello' }]);
  assert.equal(parseDecision(reply.text).action, 'wait'); assert.ok(reply.latencyMs >= 0);
});
test('Anthropic converts system messages and extracts only text content', async t => {
  const url = await fixture(t, (req, res, body) => {
    assert.equal(req.url, '/v1/messages'); assert.equal(req.headers['x-api-key'], 'test-secret'); assert.equal(body.system, 'rules'); assert.equal(body.messages.length, 1);
    res.end(JSON.stringify({ content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 5, output_tokens: 2 } }));
  });
  const result = await complete(profile({ protocol: 'anthropic', baseUrl: url + '/v1' }), [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hello' }]);
  assert.equal(result.text, '{"ok":true}'); assert.equal(result.usage.input_tokens, 5);
});
test('Ollama native format and model list are supported without an API key', async t => {
  const url = await fixture(t, (req, res, body) => {
    if (req.url === '/api/tags') { res.end('{"models":[{"name":"local:8b"}]}'); return; }
    assert.equal(req.url, '/api/chat'); assert.equal(body.stream, false); assert.equal(body.format, 'json'); assert.equal(req.headers.authorization, undefined);
    res.end('{"message":{"content":"{\\"ok\\":true}"},"prompt_eval_count":10,"eval_count":3}');
  });
  const p = profile({ protocol: 'ollama', baseUrl: url, apiKey: '' });
  const result = await complete(p, [{ role: 'user', content: 'hello' }]); assert.equal(result.usage.completion_tokens, 3);
  assert.deepEqual(await listModels(p), ['local:8b']);
});
test('HTTP errors never echo response bodies or secrets', async t => {
  const url = await fixture(t, (req, res) => { res.writeHead(401); res.end('your key was test-secret'); });
  await assert.rejects(complete(profile({ baseUrl: url }), [{ role: 'user', content: 'hi' }]), error => error.message.includes('401') && !error.message.includes('test-secret'));
});
test('stopping a request aborts an outstanding model call', async t => {
  const url = await fixture(t, () => {});
  const controller = new AbortController();
  const promise = complete(profile({ baseUrl: url }), [{ role: 'user', content: 'hi' }], controller.signal);
  controller.abort(new Error('user stop'));
  await assert.rejects(promise, /user stop/);
});
test('full endpoint URLs are accepted without duplicated suffixes', () => {
  assert.equal(endpoint(profile({ baseUrl: 'https://host/v1/chat/completions/' }), 'chat/completions'), 'https://host/v1/chat/completions');
  assert.equal(endpoint(profile({ baseUrl: 'https://host/v1/messages' }), 'models'), 'https://host/v1/models');
  assert.equal(endpoint(profile({ baseUrl: 'http://host/api/chat' }), 'api/tags'), 'http://host/api/tags');
});
test('invalid profiles and malformed decisions are rejected before any action', () => {
  for (const change of [{ protocol: 'unknown' }, { baseUrl: 'file:///secrets' }, { baseUrl: 'https://user:pass@host/v1' }, { maxTokens: 0 }, { temperature: NaN }, { headersJson: '[]' }, { headersJson: '{"key":2}' }]) assert.throws(() => validateProfile(profile(change)));
  for (const output of ['hello', '{}', '[]', '{"action":"wait","args":1}', '{"action":"wait","args":null}']) assert.throws(() => parseDecision(output));
  assert.equal(parseDecision('```json\n{"action":"inspect"}\n```').action, 'inspect');
});

test('one decision is recovered from explanation and reasoning without exposing reasoning or choosing among actions', () => {
  assert.deepEqual(parseDecision('<think>先观察 {不是行动}</think>\n下一步是：\n```json\n{"action":"chat","args":{"message":"你好 {队友}，\\"收到\\""}}\n```'), { action: 'chat', args: { message: '你好 {队友}，"收到"' }, reason: '' });
  for (const text of ['{"action":"inspect"} {"action":"done"}', '[{"action":"inspect"}]', '说明 [{"action":"inspect"}]', '<think>没有最终回答', '{"action":"inspect"', '说明 {"action":"inspect"} 后面 {broken}']) assert.throws(() => parseDecision(text));
});

test('Ollama conversation does not force a JSON format', async t => {
  const url = await fixture(t, (_, res, body) => {
    assert.equal(body.format, undefined);
    res.end(JSON.stringify({ message: { content: '你好，我在砍树' } }));
  });
  const result = await complete(profile({ protocol: 'ollama', baseUrl: url }), [{ role: 'user', content: '你好' }], undefined, { output: 'text' });
  assert.equal(result.text, '你好，我在砍树');
});

test('truncated model answers and non-JSON protocol responses have distinct safe errors', async t => {
  let calls = 0;
  const url = await fixture(t, (_, res) => {
    if (++calls === 1) res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"action":' } }] }));
    else res.end('proxy error containing test-secret');
  });
  await assert.rejects(complete(profile({ baseUrl: url }), []), /token 上限/);
  await assert.rejects(complete(profile({ baseUrl: url }), []), e => /API 响应不是有效 JSON/.test(e.message) && !e.message.includes('test-secret'));
});

test('transient HTTP failures retry with backoff and cancellation interrupts retry delay', async t => {
  let calls = 0; const retries = [];
  const url = await fixture(t, (_, res) => {
    if (++calls <= 1 || calls >= 3) { res.writeHead(503); res.end('private test-secret'); }
    else res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"inspect"}' } }] }));
  });
  const p = profile({ baseUrl: url });
  assert.equal(parseDecision((await complete(p, [], undefined, { onRetry: r => retries.push(r) })).text).action, 'inspect');
  assert.equal(calls, 2); assert.equal(retries.length, 1); assert.ok(!retries[0].message.includes('test-secret'));
  const controller = new AbortController();
  await assert.rejects(complete(p, [], controller.signal, { onRetry: () => controller.abort(new Error('stopped during retry')) }), /stopped during retry/);
  assert.equal(calls, 3);
});

test('reset connections produce useful redacted diagnostics and at most two retries', async t => {
  let calls = 0;
  const url = await fixture(t, (req) => { calls++; req.socket.destroy(); });
  await assert.rejects(complete(profile({ baseUrl: url }), []), e => /API 网络请求失败/.test(e.message) && /UND_ERR_SOCKET/.test(e.message) && !e.message.includes('test-secret') && !e.message.includes(url));
  assert.equal(calls, 3);
});

test('batch plans keep legacy decisions and reject ambiguous, oversized or malformed actions', () => {
  assert.deepEqual(parsePlan('{"action":"inspect"}'), [parseDecision('{"action":"inspect"}')]);
  assert.deepEqual(parsePlan('```json\n{"reason":"制作工具","actions":[{"action":"craft","args":{"item":"stick"}},{"action":"equip","args":{"item":"wooden_pickaxe"}}]}\n```').map(d => d.reason), ['制作工具', '制作工具']);
  for (const value of [[], { actions: [] }, { actions: [{ action: 'inspect', args: null }] }, { action: 'inspect', actions: [{ action: 'inspect' }] }, { actions: [{ action: 'done' }, { action: 'inspect' }] }, { actions: Array(5).fill({ action: 'inspect' }) }]) assert.throws(() => parsePlan(JSON.stringify(value)));
  assert.throws(() => parsePlan('{"actions":[{"action":"inspect"},{"action":"inspect"}]}', 1));
  assert.throws(() => validateProfile(profile({ requestIntervalSeconds: -1 })));
});

test('Retry-After supports seconds, dates and invalid values without truncating long waits', () => {
  assert.equal(retryAfterMs('120'), 120000);
  const now = Date.parse('2026-10-10T00:00:00Z');
  assert.equal(retryAfterMs('Sat, 10 Oct 2026 00:05:00 GMT', now), 300000);
  for (const value of [null, '', ' ', 'garbage', '-1']) assert.equal(retryAfterMs(value, now), 0);
});

test('requests to one origin serialize across profiles and consume bodies before releasing the lane', async t => {
  let active = 0, peak = 0; const arrivals = [];
  const url = await fixture(t, async (_, res) => {
    active++; peak = Math.max(peak, active); arrivals.push(Date.now());
    res.write('{"choices":[');
    await new Promise(resolve => setTimeout(resolve, 70));
    active--; res.end('{"message":{"content":"ok"}}]}');
  });
  const scheduler = new RequestScheduler();
  const a = profile({ baseUrl: url + '/v1', requestIntervalSeconds: 0.12 });
  const b = profile({ baseUrl: url + '/different', apiKey: 'another-secret', model: 'other', requestIntervalSeconds: 0.12 });
  await Promise.all([complete(a, [], undefined, { scheduler }), complete(b, [], undefined, { scheduler }), complete(a, [], undefined, { scheduler })]);
  assert.equal(peak, 1); assert.equal(arrivals.length, 3);
  assert.ok(arrivals[1] - arrivals[0] >= 105); assert.ok(arrivals[2] - arrivals[1] >= 105);
});

test('429 retries honor server cooldown, back off, and share protection with concurrent conversation', async t => {
  const arrivals = [], retries = [];
  const url = await fixture(t, (_, res) => {
    arrivals.push(Date.now());
    if (arrivals.length < 3) { res.writeHead(429, { 'Retry-After': '0.08' }); res.end('test-secret'); }
    else res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  const scheduler = new RequestScheduler({ rateLimitBaseMs: 20, jitter: () => 0 });
  const p = profile({ baseUrl: url });
  const replies = await Promise.all([complete(p, [], undefined, { scheduler, onRetry: r => retries.push(r) }), complete(p, [], undefined, { scheduler, output: 'text', onRetry: r => retries.push(r) })]);
  assert.deepEqual(replies.map(r => r.text), ['ok', 'ok']); assert.equal(arrivals.length, 4); assert.equal(retries.length, 2);
  assert.ok(arrivals[1] - arrivals[0] >= 70); assert.ok(arrivals[2] - arrivals[1] >= 70);
  assert.ok(retries.every(r => r.delayMs >= 80 && !r.message.includes('test-secret')));
});

test('cancelling a queued request removes its work without opening the lane early', async t => {
  let calls = 0;
  const url = await fixture(t, async (_, res) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 90));
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  const scheduler = new RequestScheduler(), p = profile({ baseUrl: url });
  const first = complete(p, [], undefined, { scheduler });
  const controller = new AbortController();
  const second = complete(p, [], controller.signal, { scheduler });
  const rejected = assert.rejects(second, /queued stop/);
  controller.abort(new Error('queued stop'));
  const third = complete(p, [], undefined, { scheduler });
  await Promise.all([first, third, rejected]); assert.equal(calls, 2);
});

test('cancellation interrupts a long Retry-After cooldown without another HTTP attempt', async t => {
  let calls = 0;
  const url = await fixture(t, (_, res) => { calls++; res.writeHead(429, { 'Retry-After': '600' }); res.end('test-secret'); });
  const controller = new AbortController(), scheduler = new RequestScheduler();
  await assert.rejects(complete(profile({ baseUrl: url }), [], controller.signal, { scheduler, onWait: w => { if (w.reason === 'cooldown') controller.abort(new Error('cooldown stop')); } }), /cooldown stop/);
  assert.equal(calls, 1);
});

test('model listing shares the generation lane and its request interval', async t => {
  let active = 0, peak = 0; const arrivals = [];
  const url = await fixture(t, async (req, res) => {
    active++; peak = Math.max(peak, active); arrivals.push(Date.now());
    await new Promise(resolve => setTimeout(resolve, 50)); active--;
    res.end(req.method === 'GET' ? '{"data":[{"id":"model"}]}' : '{"choices":[{"message":{"content":"ok"}}]}');
  });
  const p = profile({ baseUrl: url, requestIntervalSeconds: 0.12 });
  const [generation, models] = await Promise.all([complete(p, []), listModels(p)]);
  assert.equal(generation.text, 'ok'); assert.deepEqual(models, ['model']);
  assert.equal(peak, 1); assert.ok(arrivals[1] - arrivals[0] >= 105);
});

test('a proxy connection failure without a transport code remains recoverable and redacted', async t => {
  const originalFetch = globalThis.fetch; let calls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { calls++; throw new TypeError('private proxy details test-secret'); };
  const scheduler = new RequestScheduler({ transientBaseMs: 10, jitter: () => 0 });
  await assert.rejects(complete(profile(), [], undefined, { scheduler }), e => e.retryable === true && /连接失败/.test(e.message) && !e.message.includes('test-secret'));
  assert.equal(calls, 3);
});
