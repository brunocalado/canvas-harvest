/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/** The world resource every case strikes. A randomID-shaped id, as the Resource Book makes them. */
export const RESOURCE_ID = "chTestResource01";

/**
 * Run on the GM's client: everything the cases need, made once and put back to a known state on every
 * run. Items and the actor take the system's first types, so it works whatever the world's system.
 * @type {string}   a function body returning the ids the cases use
 */
export const setupWorld = `
  const type = cls => cls.TYPES.find(t => t !== "base");
  const item = async name => game.items.getName(name) ?? Item.implementation.create({ name, type: type(Item) });
  const ore = await item("CH Test Ore");
  const gem = await item("CH Test Gem");
  const pick = await item("CH Test Pick");
  const player = game.users.getName("Player");
  const actor = game.actors.getName("CH Test Hero") ?? await Actor.implementation.create({ name: "CH Test Hero", type: type(Actor),
    ownership: { [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
  await actor.deleteEmbeddedDocuments("Item", actor.items.map(i => i.id));

  const scene = game.scenes.getName("CH Test Scene") ?? await Scene.implementation.create({ name: "CH Test Scene", width: 3000, height: 2000, grid: { size: 100 } });
  await scene.deleteEmbeddedDocuments("Region", scene.regions.map(r => r.id));
  await scene.deleteEmbeddedDocuments("Tile", scene.tiles.map(t => t.id));
  await scene.deleteEmbeddedDocuments("Token", scene.tokens.map(t => t.id));
  if ( !scene.active ) await scene.activate();
  await new Promise(resolve => { const check = () => (canvas.ready && canvas.scene?.id === scene.id) ? resolve() : setTimeout(check, 200); check(); });
  const tokenData = (await actor.getTokenDocument({ x: 1200, y: 800 })).toObject();
  const [token] = await scene.createEmbeddedDocuments("Token", [tokenData]);

  const ref = i => ({ uuid: i.uuid, name: i.name, img: i.img, type: i.type, sources: [i.uuid] });
  const resource = { id: ${JSON.stringify(RESOURCE_ID)}, name: "CH Test Vein", img: "icons/commodities/stone/ore-chunk-iron-black.webp",
    verb: "", animation: "strike", toolSets: [], tools: [], drops: [{ item: ref(ore), weight: 100, min: 1, max: 1 }], strikes: 10,
    sound: "", category: "", tags: [] };
  const list = game.settings.get("canvas-harvest", "resources").filter(r => r.id !== resource.id);
  await game.settings.set("canvas-harvest", "resources", [...list, resource]);
  const testItems = [ore, gem, pick].map(i => i.uuid);
  const sets = foundry.utils.deepClone(game.settings.get("canvas-harvest", "toolSets"));
  for ( const set in sets ) sets[set] = sets[set].filter(r => !testItems.includes(r.uuid));
  await game.settings.set("canvas-harvest", "toolSets", sets);

  // Wide enough that the token's centre stands well inside, whatever grid size the system forces.
  const centre = token.getCenterPoint();
  const region = await CanvasHarvest.createSpot({ resource: resource.id, x: centre.x, y: centre.y, scene, margin: 3 });
  return { scene: scene.id, token: token.uuid, actor: actor.id, spot: region.behaviors.contents[0].uuid, region: region.id,
    resource: resource.id, ore: ore.uuid, gem: gem.uuid, pick: pick.uuid };
`;
