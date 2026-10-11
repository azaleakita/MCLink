import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { Engine } from './engine.mjs';
import { complete, listModels } from './api.mjs';
import { PROMPT_DEFAULTS } from './chat.mjs';

// stdout is a strict JSON-lines channel. Third-party diagnostic output goes to stderr.
const write = process.stdout.write.bind(process.stdout);
console.log = (...args) => console.error(...args);
const send = value => write(JSON.stringify(value) + '\n');
const engine = new Engine((event, data) => send({ kind: 'event', event, data }), process.env.MCLINK_DATA_DIR || join(process.cwd(), '.data'));
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  let request;
  try {
    if (line.length > 100000) throw new Error('请求过大。');
    request = JSON.parse(line);
    if (!request || typeof request.id !== 'string') throw new Error('请求缺少 id。');
    const p = request.payload || {};
    let result;
    switch (request.type) {
      case 'hello': result = { name: 'MCLink', protocolVersion: 1, node: process.version }; break;
      case 'connect': result = await engine.connect(p); break;
      case 'disconnect': result = engine.disconnect(); break;
      case 'observe': result = engine.observation(); break;
      case 'map_configure':
        if (engine.bot) throw new Error('请先断开游戏，再切换地图世界或维度。');
        await engine.maps.activate(p, p.dimension || 'overworld'); result = engine.maps.status(); break;
      case 'map_view': if (engine.ready) engine.maps.track(engine.bot); result = await engine.maps.snapshot(p); break;
      case 'map_import': result = await engine.maps.startImport(p); break;
      case 'map_import_stop': result = await engine.maps.stopImport(); break;
      case 'api_test': { const reply = await complete(p, [{ role: 'system', content: 'Reply with a JSON object.' }, { role: 'user', content: 'Return {"ok":true} to verify this connection.' }]); result = { latencyMs: reply.latencyMs, message: 'API 已返回文本，连接成功。' }; break; }
      case 'api_models': result = { models: await listModels(p) }; break;
      case 'agent_start': result = engine.startAgent(p); break;
      case 'prompt_defaults': result = PROMPT_DEFAULTS; break;
      case 'game_chat_configure': result = engine.configureGameChat(p); break;
      case 'chat_generate': result = await engine.generateChat(p); break;
      case 'chat_cancel': result = engine.cancelChat(); break;
      case 'agent_stop': result = engine.stopAgent(); engine.actionController?.abort(new Error('用户停止了操作。')); break;
      case 'action': if (engine.agent) throw new Error('请先停止自动任务，再手动操作。'); result = await engine.action(p); break;
      default: throw new Error('未知请求类型。');
    }
    send({ kind: 'response', id: request.id, ok: true, result });
  } catch (e) { send({ kind: 'response', id: request?.id || '', ok: false, error: String(e.message).slice(0, 1200) }); }
});
rl.on('close', async () => { try { await engine.close(); } finally { process.exit(0); } });
process.on('SIGTERM', async () => { try { await engine.close(); } finally { process.exit(0); } });
process.on('uncaughtException', e => { send({ kind: 'event', event: 'log', data: { level: 'error', message: '桥接进程异常：' + e.message, time: new Date().toISOString() } }); engine.close(); process.exit(1); });
send({ kind: 'event', event: 'ready', data: { node: process.version } });
