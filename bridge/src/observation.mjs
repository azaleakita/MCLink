import { Vec3 } from 'vec3';

export const round = value => Math.round(value * 10) / 10;
export const position = p => ({ x: round(p.x), y: round(p.y), z: round(p.z) });
export const item = i => ({ name: i.name, displayName: i.displayName, count: i.count, slot: i.slot });
const hazard = name => /lava|fire|cactus|magma|campfire|berry_bush/.test(name);

export function mapCells(bot, radius = 10) {
  const center = bot.entity.position.floored();
  const cells = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx, z = center.z + dz;
      let found = null, loaded = false;
      // This is a local slice, not an omniscient surface map. Works inside caves.
      for (let y = center.y + 4; y >= center.y - 8; y--) {
        const b = bot.blockAt(new Vec3(x, y, z), false);
        if (!b) continue;
        loaded = true;
        if (b.boundingBox !== 'empty' || /water|lava/.test(b.name)) {
          const feet = bot.blockAt(new Vec3(x, y + 1, z), false);
          const head = bot.blockAt(new Vec3(x, y + 2, z), false);
          if (feet && head && feet.boundingBox === 'empty' && head.boundingBox === 'empty') {
            found = { x, z, y, name: b.name, walkable: !hazard(b.name) && !hazard(feet.name) && !hazard(head.name), hazardous: hazard(b.name) || hazard(feet.name) || hazard(head.name) }; break;
          }
        }
      }
      cells.push(found || { x, z, y: center.y, name: loaded ? 'obstacle' : 'unloaded', walkable: false, hazardous: false });
    }
  }
  return { center: position(center), radius, cells };
}

export function observe(bot, events = []) {
  if (!bot?.entity || bot.health <= 0) throw new Error('机器人尚未进入世界，或正在重生。');
  const origin = bot.entity.position;
  const resources = {};
  const interesting = b => /_log$|_ore$|coal|crafting_table|furnace|chest|barrel|_bed$|water|lava|wheat|carrot|potato|sugar_cane/.test(b.name);
  const blocks = bot.findBlocks({ matching: interesting, maxDistance: 32, count: 72 });
  for (const p of blocks) {
    const b = bot.blockAt(p, false);
    if (!b) continue;
    (resources[b.name] ??= []).push(position(p));
  }
  const entities = Object.values(bot.entities).filter(e => e !== bot.entity && e.position && e.position.distanceTo(origin) <= 32)
    .sort((a, b) => a.position.distanceTo(origin) - b.position.distanceTo(origin)).slice(0, 32)
    .map(e => ({ id: e.id, name: e.name || e.username || e.displayName || e.type, type: e.type, position: position(e.position), distance: round(e.position.distanceTo(origin)), ...(e.getDroppedItem?.() ? { droppedItem: item(e.getDroppedItem()) } : {}) }));
  return {
    source: 'minecraft_protocol', scope: '仅包含服务器发送给机器人的已加载区块；不包含未加载地形或未打开容器内容。',
    player: { username: bot.username, position: position(origin), health: bot.health, food: bot.food, oxygen: bot.oxygenLevel, experience: bot.experience?.level || 0, dimension: bot.game?.dimension, gameMode: bot.game?.gameMode, heldItem: bot.heldItem ? item(bot.heldItem) : null },
    time: { timeOfDay: bot.time?.timeOfDay, isDay: bot.time?.isDay, isRaining: bot.isRaining },
    inventory: bot.inventory.items().map(item), entities, resources,
    localMap: mapCells(bot), recentEvents: events.slice(-12)
  };
}

export function forModel(observation) {
  const { localMap, ...rest } = observation;
  const names = [...new Set(localMap.cells.map(c => c.name))];
  return { ...rest, localMap: { center: localMap.center, radius: localMap.radius, legend: names, description: '按 z 从北到南，每行 x 从西到东；格子为 [方块索引,地面y,可站立0/1]。unloaded 是未知，obstacle 是此高度范围没有可站立面。', rows: Array.from({ length: localMap.radius * 2 + 1 }, (_, row) => localMap.cells.slice(row * (localMap.radius * 2 + 1), (row + 1) * (localMap.radius * 2 + 1)).map(c => [names.indexOf(c.name), c.y, c.walkable ? 1 : 0])) } };
}
