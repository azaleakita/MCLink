import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import protocol from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import chunkLoader from 'prismarine-chunk';
import { Vec3 } from 'vec3';
import { Engine } from '../src/engine.mjs';
import { sleep } from '../src/actions.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import nbt from 'prismarine-nbt';

// Sends real Minecraft wire packets over loopback. It is a protocol fixture,
// not a vanilla server or a full survival simulation.
test('Java protocol reads chunks and inventory, pathfinds, and exchanges model chat packets', { timeout: 20000 }, async t => {
  const version = '1.16.5', data = minecraftData(version), Chunk = chunkLoader(version);
  const server = protocol.createServer({ host: '127.0.0.1', port: 0, version, 'online-mode': false, keepAlive: false });
  const events = [], dataDir = mkdtempSync(join(tmpdir(), 'mclink-protocol-'));
  const engine = new Engine((event, payload) => events.push({ event, payload }), dataDir);
  let gameClient;
  t.after(async () => { await engine.close(); for (const client of Object.values(server.clients)) client.end(); server.close(); rmSync(dataDir, { recursive: true, force: true }); });
  server.on('playerJoin', client => {
    gameClient = client;
    client.write('login', { ...data.loginPacket, entityId: client.id, isHardcore: false, gameMode: 0, previousGameMode: 1, hashedSeed: [0, 0], maxPlayers: 10, viewDistance: 10, reducedDebugInfo: false, enableRespawnScreen: true, isDebug: false, isFlat: true });
    client.write('position', { x: 0.5, y: 65, z: 0.5, yaw: 0, pitch: 0, flags: 0, teleportId: 1 });
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const chunk = new Chunk();
      for (let bx = 0; bx < 16; bx++) for (let bz = 0; bz < 16; bz++) chunk.setBlockStateId(new Vec3(bx, 64, bz), data.blocksByName.grass_block.defaultState);
      if (x === 0 && z === 0) chunk.setBlockStateId(new Vec3(3, 65, 3), data.blocksByName.oak_log.defaultState);
      client.write('map_chunk', { x, z, groundUp: true, bitMap: chunk.getMask(), heightmaps: { type: 'compound', name: '', value: {} }, biomes: chunk.biomes, chunkData: chunk.dump(), blockEntities: [] });
    }
    client.write('update_health', { health: 20, food: 18, foodSaturation: 5 });
    client.write('set_slot', { windowId: 0, slot: 36, item: { present: true, itemId: data.itemsByName.apple.id, itemCount: 3 } });
  });
  await once(server, 'listening');
  await engine.connect({ host: '127.0.0.1', port: server.socketServer.address().port, username: 'MCLinkTest', auth: 'offline', version });
  for (let i = 0; i < 300 && !engine.ready; i++) await sleep(20);
  assert.ok(engine.ready, JSON.stringify(events));
  const observed = engine.observation();
  assert.equal(observed.source, 'minecraft_protocol'); assert.equal(observed.player.health, 20);
  assert.equal(observed.inventory.find(i => i.name === 'apple')?.count, 3);
  assert.deepEqual(observed.resources.oak_log, [{ x: 3, y: 65, z: 3 }]);
  assert.equal(observed.localMap.cells[220].name, 'grass_block');
  for (let i = 0; i < 300 && (engine.maps.pumping || engine.maps.pending.size); i++) await sleep(10);
  const map = await engine.maps.snapshot({ centerX: 0, centerZ: 0, size: 64, resolution: 64 });
  assert.equal(map.chunks, 25);
  assert.ok(map.legend.includes('grass_block'));
  assert.ok(map.legend.includes('oak_log'));
  assert.equal(map.position.y, 65);
  const result = await engine.action({ action: 'move_to', args: { x: 2, y: 65, z: 0, range: 0.5 } }, new AbortController().signal, 5000);
  assert.ok(result.position.x >= 1.5);
  gameClient.write('chat', { message: JSON.stringify({ translate: 'chat.type.text', with: [{ text: 'Teammate' }, { text: '这里有苹果，过来吧' }] }), position: 0, sender: '00000000-0000-0000-0000-000000000001' });
  for (let i = 0; i < 100 && !engine.events.some(e => e.type === 'player_chat'); i++) await sleep(10);
  assert.equal(engine.events.find(e => e.type === 'player_chat')?.username, 'Teammate');
  const api = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.match(body.messages[0].content, /称呼队友老哥/);
    assert.equal(JSON.parse(body.messages[1].content).observation.inventory[0].name, 'apple');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"chat","args":{"message":"老哥，我这有三个苹果"}}' } }] }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const packet = once(gameClient, 'chat');
  await engine.generateChat({ topic: '告诉队友背包有什么', profile: { protocol: 'openai', baseUrl: `http://127.0.0.1:${api.address().port}`, model: 'fixture', apiKey: '', headersJson: '{}', maxTokens: 1024, temperature: 0.4, requestIntervalSeconds: 0 }, preferences: { chatPrompt: '称呼队友老哥，简短说话' } });
  assert.equal((await packet)[0].message, '老哥，我这有三个苹果');

  // A vanilla /msg packet must be routed by its translation key only once.
  const before = engine.chatSequence;
  gameClient.write('chat', { message: JSON.stringify({ translate: 'commands.message.display.incoming', with: [{ text: 'Teammate' }, { text: '/停止' }] }), position: 0, sender: '00000000-0000-0000-0000-000000000001' });
  for (let i = 0; i < 100 && engine.chatSequence === before; i++) await sleep(10);
  assert.equal(engine.chatSequence, before + 1);
  const instruction = engine.events.find(e => e.type === 'player_command');
  assert.equal(instruction.text, '/停止'); assert.equal(instruction.channel, 'whisper');

  // The bridge explicitly sends a respawn request and waits for fresh spawn data.
  const revive = once(gameClient, 'client_command');
  gameClient.write('update_health', { health: 0, food: 18, foodSaturation: 5 });
  const [request] = await revive;
  assert.equal(request.actionId, 'perform_respawn'); assert.equal(engine.ready, false);
  gameClient.write('respawn', { dimension: data.loginPacket.dimension, worldName: 'minecraft:overworld', hashedSeed: [0, 0], gamemode: 0, previousGamemode: 0, isDebug: false, isFlat: true, copyMetadata: false });
  gameClient.write('position', { x: 4.5, y: 65, z: 0.5, yaw: 0, pitch: 0, flags: 0, teleportId: 2 });
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    const chunk = new Chunk();
    for (let bx = 0; bx < 16; bx++) for (let bz = 0; bz < 16; bz++) chunk.setBlockStateId(new Vec3(bx, 64, bz), data.blocksByName.grass_block.defaultState);
    gameClient.write('map_chunk', { x, z, groundUp: true, bitMap: chunk.getMask(), heightmaps: { type: 'compound', name: '', value: {} }, biomes: chunk.biomes, chunkData: chunk.dump(), blockEntities: [] });
  }
  gameClient.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
  for (let i = 0; i < 300 && !engine.ready; i++) await sleep(10);
  assert.ok(engine.ready, JSON.stringify(events.slice(-8)));
  assert.equal(engine.observation().player.health, 20); assert.equal(engine.observation().player.position.x, 4.5);
  assert.equal(engine.respawnTimer, null);
});

test('Java 1.21.11 mines reachable logs, receives chat and slash whispers once, replies while idle and respawns', { timeout: 35000 }, async t => {
  const version = '1.21.11', data = minecraftData(version), Chunk = chunkLoader(version);
  const server = protocol.createServer({ host: '127.0.0.1', port: 0, version, 'online-mode': false, keepAlive: false });
  const dir = mkdtempSync(join(tmpdir(), 'mclink-modern-')), events = [], requests = [], sent = [], dug = [];
  const engine = new Engine((event, payload) => events.push({ event, payload }), dir);
  const api = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks)), context = JSON.parse(body.messages[1].content); requests.push(context);
    res.end(JSON.stringify({ choices: [{ message: { content: context.goal ? '下一步：\n```json\n' + JSON.stringify({ action: 'done', args: { summary: '已收到指令' } }) + '\n```' : '<think>不发送的推理</think>\n你好，我在这里' } }] }));
  });
  t.after(async () => { await engine.close(); for (const client of Object.values(server.clients)) client.end(); server.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  let client;
  const spawn = () => {
    client.write('position', { teleportId: 1, x: 0.5, y: 65, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: {} });
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const chunk = new Chunk({ minY: -64, worldHeight: 384 });
      for (let bx = 0; bx < 16; bx++) for (let bz = 0; bz < 16; bz++) chunk.setBlockStateId(new Vec3(bx, 64, bz), data.blocksByName.grass_block.defaultState);
      if (x === 0 && z === 0) {
        chunk.setBlockStateId(new Vec3(1, 68, 0), data.blocksByName.oak_log.defaultState);
        chunk.setBlockStateId(new Vec3(6, 65, 0), data.blocksByName.oak_log.defaultState);
      }
      client.write('map_chunk', { x, z, heightmaps: [], chunkData: chunk.dump(), blockEntities: [], skyLightMask: [], blockLightMask: [], emptySkyLightMask: [], emptyBlockLightMask: [], skyLight: [], blockLight: [] });
    }
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
  };
  server.on('playerJoin', joined => {
    client = joined; client.on('chat_message', packet => sent.push(packet.message));
    client.on('block_dig', packet => { if (packet.status === 2) dug.push(packet.location); });
    client.write('login', { ...data.loginPacket, entityId: client.id }); spawn();
  });
  await Promise.all([once(server, 'listening'), new Promise(resolve => api.listen(0, '127.0.0.1', resolve))]);
  engine.configureGameChat({ profile: { protocol: 'openai', baseUrl: `http://127.0.0.1:${api.address().port}`, model: 'modern', headersJson: '{}', maxTokens: 1024, temperature: 0.4, requestIntervalSeconds: 0 } });
  await engine.connect({ host: '127.0.0.1', port: server.socketServer.address().port, username: 'MCLinkTest', auth: 'offline', version });
  for (let i = 0; i < 400 && !engine.ready; i++) await sleep(10);
  assert.ok(engine.ready, JSON.stringify(events.slice(-5)));
  const start = engine.bot.entity.position.clone();
  const upper = await engine.action({ action: 'dig', args: { x: 1, y: 68, z: 0 } });
  assert.equal(upper.mined, 'oak_log'); assert.ok(start.distanceTo(engine.bot.entity.position) < 0.1, 'Reachable upper log should not need movement');
  const further = await engine.action({ action: 'dig', args: { x: 6, y: 65, z: 0 } });
  assert.equal(further.mined, 'oak_log'); assert.ok(engine.bot.entity.position.x > 1, 'Farther log should require a reachable visible face');
  for (let i = 0; i < 100 && dug.length < 2; i++) await sleep(10);
  assert.deepEqual(dug, [{ x: 1, y: 68, z: 0 }, { x: 6, y: 65, z: 0 }]);
  const chat = (type, message) => client.write('profileless_chat', { message: nbt.comp({ text: nbt.string(message) }), type: { chatType: type }, name: nbt.comp({ text: nbt.string('Teammate') }) });
  chat(0, '你好');
  for (let i = 0; i < 200 && !sent.length; i++) await sleep(10);
  assert.deepEqual(sent, ['你好，我在这里']); assert.equal(engine.chatSequence, 1);
  chat(2, '/采集4个橡木');
  for (let i = 0; i < 200 && !requests.some(r => r.goal); i++) await sleep(10);
  assert.equal(requests.find(r => r.goal)?.goal, '采集4个橡木'); assert.equal(engine.chatSequence, 2);
  assert.equal(engine.events.find(e => e.type === 'player_command')?.channel, 'whisper');
  const revive = once(client, 'client_command'); client.write('update_health', { health: 0, food: 20, foodSaturation: 5 });
  assert.equal((await revive)[0].actionId, 'perform_respawn');
  client.write('respawn', { worldState: data.loginPacket.worldState, copyMetadata: 0 }); spawn();
  for (let i = 0; i < 400 && !engine.ready; i++) await sleep(10);
  assert.ok(engine.ready); assert.equal(engine.observation().player.health, 20);
});
