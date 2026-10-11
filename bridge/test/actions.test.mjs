import test from 'node:test';
import assert from 'node:assert/strict';
import pathfinderModule from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { execute, sleep } from '../src/actions.mjs';
const { goals } = pathfinderModule;

function miner() {
  const logs = [new Vec3(1, 68, 0), new Vec3(1, 75, 0)], calls = [], navigation = [];
  const bot = {
    entity: { position: new Vec3(0.5, 65, 0.5), eyeHeight: 1.62 },
    world: { raycast: () => ({ position: logs[0] }) },
    blockAt: p => ({ name: 'oak_log', position: p, diggable: true }),
    canDigBlock: b => b.position.y <= 68,
    inventory: { items: () => [] },
    findBlock: () => logs.length ? bot.blockAt(logs[0]) : null,
    nearestEntity: () => null,
    pathfinder: { goto: async g => { navigation.push(g); throw new Error('Took to long to decide path to goal!'); }, bestHarvestTool: () => null, setGoal() {} },
    dig: async b => { calls.push(b.position); logs.shift(); }, stopDigging() {}, clearControlStates() {}, deactivateItem() {}
  };
  return { bot, calls, navigation };
}

test('a reachable upper tree log is mined from the ground without unnecessary navigation', async () => {
  const { bot, calls, navigation } = miner();
  const result = await execute(bot, { action: 'dig', args: { x: 1, y: 68, z: 0 } }, new AbortController().signal);
  assert.equal(result.mined, 'oak_log'); assert.equal(calls.length, 1); assert.equal(navigation.length, 0);
});

test('collection keeps partial progress when a higher log is unreachable and does not walk to empty high cells', async () => {
  const { bot, calls, navigation } = miner();
  const result = await execute(bot, { action: 'collect', args: { name: 'oak_log', count: 4 } }, new AbortController().signal);
  assert.deepEqual(result.mined, ['oak_log']); assert.equal(calls.length, 1);
  assert.match(result.stoppedReason, /未找到可达路线/); assert.equal(navigation.length, 1);
  assert.ok(navigation[0] instanceof goals.GoalLookAtBlock); assert.equal(navigation[0].world, bot.world);
});

test('a block hidden behind another block navigates to a visible face before digging', async () => {
  const { bot, navigation } = miner();
  bot.world.raycast = () => ({ position: new Vec3(0, 66, 0) });
  bot.pathfinder.goto = async g => navigation.push(g);
  await execute(bot, { action: 'dig', args: { x: 1, y: 68, z: 0 } }, new AbortController().signal);
  assert.equal(navigation.length, 1); assert.ok(navigation[0] instanceof goals.GoalLookAtBlock);
});

test('cancelling navigation after partial mining still cancels the whole action and no late block is mined', async () => {
  const { bot, calls } = miner(); const controller = new AbortController();
  bot.pathfinder.goto = async () => { controller.abort(new Error('player stopped')); await sleep(30); };
  await assert.rejects(execute(bot, { action: 'collect', args: { name: 'oak_log', count: 4 } }, controller.signal), /player stopped/);
  await sleep(40); assert.equal(calls.length, 1);
});

test('a hanging mining route has a ten-second limit and clears movement', { timeout: 12000 }, async () => {
  const { bot, calls } = miner(); let stopped = false;
  bot.world.raycast = () => null;
  bot.pathfinder.goto = () => new Promise(() => {});
  bot.pathfinder.setGoal = goal => { if (goal === null) stopped = true; };
  await assert.rejects(execute(bot, { action: 'dig', args: { x: 1, y: 68, z: 0 } }, new AbortController().signal), /寻路超过 10 秒/);
  assert.ok(stopped); assert.equal(calls.length, 0);
});
