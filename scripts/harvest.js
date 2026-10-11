/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  ANIMATION_ICONS, HARVEST_FLIGHT, LOOT_ID, MODULE_ID, QUERY_HARVEST, QUERY_NEED_TOOL, SETTING_TOOL_WHISPER,
  SPOT_TYPE, STRIKE_MS, TEMPLATE_PATH
} from "./constants.js";
import { getTheme, isWebm, liveRef, refMatches, toItemRef } from "./helpers.js";
import { medallionArea } from "./harvest-control.js";
import { getToolSet } from "./tool-sets.js";

/**
 * A refusal's message in this client's language. The data never holds localized text, so a refusal
 * made on the GM reads in the player's language once it is back: NeedTool carries the item names and
 * the set ids, and the list is worded here.
 * @param {{key: string, data?: object}} refusal
 * @returns {string}
 */
function refusalMessage({ key, data }) {
  if ( key === "NeedTool" ) {
    const names = [
      ...data.tools.map(name => foundry.utils.escapeHTML(name)),
      ...data.sets.map(set => game.i18n.localize("CANVASHARVEST.Errors.AnyTool", {
        verb: game.i18n.localize(`CANVASHARVEST.Verb.${set}`)
      }))
    ];
    data = { tools: game.i18n.getListFormatter({ type: "disjunction" }).format(names) };
  }
  return game.i18n.localize(`CANVASHARVEST.Errors.${key}`, data);
}

/**
 * A refusal the user can cause, as an Error whose message is shown to them. It keeps its key and
 * data, which the harvest query sends back instead of the message.
 * @param {string} key    under CANVASHARVEST.Errors
 * @param {object} [data]
 * @returns {Error}
 */
function refusal(key, data) {
  const err = new Error(refusalMessage({ key, data }));
  err.refusal = { key, data };
  return err;
}

/**
 * Every rule a harvest must pass. Run on the clicking client to refuse early, and again on the GM
 * against the user the server identified. Throws an Error whose message is a localized string;
 * names are escaped, since notifications render HTML.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument} token
 * @param {User} user
 * @param {{authoritative?: boolean}} [options]   true on the GM: re-test "inside" geometrically
 * @returns {Resource}
 */
export function checkHarvest(behavior, token, user, { authoritative = false } = {}) {
  const region = behavior?.parent;
  if ( (behavior?.type !== SPOT_TYPE) || behavior.disabled || !region || (region.hidden && !user.isGM) ) throw refusal("NotASpot");
  const resource = behavior.system.resourceData;
  if ( !resource ) throw refusal("NoResource");
  // A token without an actor reports OWNER for everyone, so the actor is what gets tested.
  if ( !token?.actor?.testUserPermission(user, "OWNER") ) throw refusal("NotYourToken");
  // The persisted regions were computed by the client that moved the token; the GM measures itself.
  // A spot attached to a token (a carcass) is worked by the tokens around it, never by its carrier.
  const inside = (token.parent === region.parent) && (region.attachment?.token !== token)
    && (authoritative ? token.testInsideRegion(region) : !!token.regions?.has(region));
  if ( !inside ) throw refusal("NotInside");
  if ( behavior.system.left <= 0 ) throw refusal("Depleted");
  // The resource's own tools, or any item of a switched-on Tool Set. A set left empty is ignored, as if
  // switched off. The GM reads its own sets: the world's setting and what packages added on its client.
  const sets = resource.toolSets.map(set => [set, getToolSet(set)]).filter(([, items]) => items.length);
  const candidates = [...sets.flatMap(([, items]) => items), ...resource.tools];
  if ( candidates.length ) {
    const carried = token.actor.items.map(i => toItemRef(i));
    // A hand-made copy is matched by name, and a tool renamed in the directory leaves copies under
    // either name, so the name it was listed with and its current one both count.
    const tools = candidates.map(tool => [tool, liveRef(tool)]);
    if ( !tools.some(pair => carried.some(ref => pair.some(tool => refMatches(tool, ref)))) ) {
      // A set can hold dozens of items, so it is named as a set rather than item by item.
      const err = refusal("NeedTool", { tools: resource.tools.map(tool => liveRef(tool).name), sets: sets.map(([set]) => set) });
      // Every item that would do, in the notification's order, for the GM's whisper.
      err.tools = [...resource.tools, ...sets.flatMap(([, items]) => items)];
      throw err;
    }
  }
  return resource;
}

/**
 * @param {number} min
 * @param {number} max
 * @param {() => number} rng
 * @returns {number}
 */
function randomInt(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Draw what one strike gives: one drop picked by weight, in an amount between its min and max.
 * Pure, so it can be checked without a world.
 * @param {Resource} resource
 * @param {() => number} [rng=Math.random]
 * @returns {{ref: ItemRef, quantity: number}[]}   always one entry, kept as a list for the callers
 */
export function rollDrops(resource, rng = Math.random) {
  const total = resource.drops.reduce((sum, d) => sum + d.weight, 0);
  let pick = rng() * total;
  const index = resource.drops.findIndex(d => (pick -= d.weight) < 0);
  const drop = resource.drops[(index < 0) ? resource.drops.length - 1 : index];
  return [{ ref: drop.item, quantity: randomInt(drop.min, drop.max, rng) }];
}

/**
 * Client side: refuse what can be refused here, then ask the active GM to strike.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument|null} [token]   who strikes; by default the first controlled token in the spot, other
 *   than the one it is attached to
 * @returns {Promise<boolean>}   false, after a warning, when the strike was refused or failed
 */
export async function requestHarvest(behavior, token = null) {
  try {
    const gm = game.users.activeGM;
    if ( !gm ) throw refusal("NoGM");
    const region = behavior.parent;
    token ??= canvas.tokens.controlled.map(t => t.document).find(t => t.regions?.has(region) && (t !== region.attachment?.token));
    if ( !token ) throw refusal("NotInside");
    const resource = checkHarvest(behavior, token, game.user);
    const veto = { reason: "" };
    if ( Hooks.call(`${MODULE_ID}.preHarvest`, token, foundry.utils.deepClone(resource), behavior, veto) === false ) {
      throw new Error(veto.reason || game.i18n.localize("CANVASHARVEST.Errors.Vetoed"));
    }
    // A GM who disconnects mid-strike would otherwise leave the promise pending forever.
    const result = await gm.query(QUERY_HARVEST, { behaviorUuid: behavior.uuid, tokenUuid: token.uuid }, { timeout: 60 * 1000 });
    if ( result?.refusal ) throw refusal(result.refusal.key, result.refusal.data);
    return true;
  } catch(err) {
    ui.notifications.warn(err.message);
    // The GM checks again before naming anything, so the query can't be used to read a spot's tools.
    if ( err.tools && game.settings.get(MODULE_ID, SETTING_TOOL_WHISPER) ) {
      game.users.activeGM?.query(QUERY_NEED_TOOL, { behaviorUuid: behavior.uuid, tokenUuid: token.uuid }).catch(() => {});
    }
    return false;
  }
}

/* -------------------------------------------- */
/*  The active GM                               */
/* -------------------------------------------- */

let queue = Promise.resolve();

/**
 * Run claims one after another on the GM, so two players striking one spot can't both read the
 * same reserve before either spends it.
 * @param {() => Promise<*>} fn
 * @returns {Promise<*>}
 */
function serial(fn) {
  return (queue = queue.then(fn, fn));
}

/** Uuids of the spots mid-strike: the next claim on one waits for its delivery to end. */
const busy = new Set();

/**
 * Check a strike against the server's user and spend it, inside the queue. Nothing is spent unless
 * every item the resource gives still exists.
 * @param {{behaviorUuid: string, tokenUuid: string}} payload
 * @param {User} user   who the server says sent the query
 * @returns {Promise<object>}   what settle needs
 */
async function gmClaim({ behaviorUuid, tokenUuid } = {}, user) {
  // A player could address this query to any GM; only the active GM's queue serialises claims.
  if ( !game.user.isActiveGM ) throw refusal("NotActiveGM");
  const behavior = (typeof behaviorUuid === "string") ? await fromUuid(behaviorUuid) : null;
  if ( behavior?.documentName !== "RegionBehavior" ) throw refusal("NotASpot");
  const token = (typeof tokenUuid === "string") ? await fromUuid(tokenUuid) : null;
  if ( token?.documentName !== "Token" ) throw refusal("NotYourToken");
  const resource = foundry.utils.deepClone(checkHarvest(behavior, token, user, { authoritative: true }));
  if ( busy.has(behavior.uuid) ) throw refusal("Busy");
  const items = new Map();
  for ( const { item: ref } of resource.drops ) {
    const item = await fromUuid(ref.uuid);
    if ( item?.documentName !== "Item" ) throw refusal("BrokenResource");
    items.set(ref.uuid, item);
  }
  // Rolled before spending, so a strike with nowhere to land its drops is refused, not spent.
  const drops = rollDrops(resource);
  const units = unitsOf(drops, items);
  if ( findSpaces(token, behavior, units.length).length < units.length ) throw refusal("NoRoom");
  busy.add(behavior.uuid);
  try {
    const left = behavior.system.left - 1;
    // The options reach the updateRegionBehavior hook on every client, which plays the strike there.
    await behavior.update({ "system.remaining": left }, { [MODULE_ID]: { strike: token.uuid, depleted: left === 0 } });
    const { x, y, width, height } = behavior.parent.bounds;
    return { behavior, token, resource, items, left, user, drops, units, centre: { x: x + (width / 2), y: y + (height / 2) } };
  } catch(err) {
    busy.delete(behavior.uuid);
    throw err;
  }
}

/**
 * The item data for one unit of a drop. Where the world's quantity field exists on the item, it is
 * set to 1, so a tile never carries the stack size the source item happens to have; a system whose
 * item has no such field (Cairn's gear) keeps its data as it is.
 * @param {Item} item
 * @param {string} path   the quantity path, or ""
 * @returns {object}
 */
function unitData(item, path) {
  const data = item.toObject();
  if ( path && foundry.utils.hasProperty(data, path) ) foundry.utils.setProperty(data, path, 1);
  return data;
}

/**
 * The tiles a strike's drops become: one per unit, whatever the world's quantity field. Three of an
 * item are three items on the map, as a player sees them, and a system that stacks merges them
 * when they are picked up.
 * @param {{ref: ItemRef, quantity: number}[]} drops
 * @param {Map<string, Item>} items
 * @returns {{ref: ItemRef, item: Item, quantity: number}[]}
 */
function unitsOf(drops, items) {
  return drops.flatMap(({ ref, quantity }) => {
    const item = items.get(ref.uuid);
    return Array.from({ length: quantity }, () => ({ ref, item, quantity: 1 }));
  });
}

/**
 * Free spaces around the striking token, nearest first: inside the spot is fine, on loot, a token or
 * the spot's medallion is not (Canvas Loot checks all three). Read from the document, since the GM
 * may be viewing another scene.
 * @param {TokenDocument} token
 * @param {RegionBehavior} behavior   the spot struck
 * @param {number} count
 * @returns {{x: number, y: number}[]}
 */
function findSpaces(token, behavior, count) {
  try {
    return game.modules.get(LOOT_ID).api.findLootSpaces({ scene: token.parent, levelId: token.level,
      origin: token.getCenterPoint(), around: { x: token.x, y: token.y, ...token.getSize() }, count,
      avoid: [medallionArea(behavior)] });
  } catch(err) {
    console.error(`${MODULE_ID} | Could not look for free spaces`, err);
    return [];
  }
}

/**
 * Put the units on the map beside the token, flying from the spot. The spaces are searched again
 * here, after the blows, since a token may have stepped onto one meanwhile.
 * @param {object} claim
 * @param {string} path
 * @returns {Promise<{ref: ItemRef, item: Item, quantity: number}[]>}   the units that found no space
 */
async function spawnDrops(claim, path) {
  const loot = game.modules.get(LOOT_ID).api;
  const { behavior, token, units, centre } = claim;
  const scene = token.parent;
  const spaces = findSpaces(token, behavior, units.length + 4);
  const rest = [];
  let spawned = 0;
  for ( const unit of units ) {
    let tile = null;
    try {
      // null: a drop took that space meanwhile, so the next one is tried.
      while ( !tile && spaces.length ) {
        tile = await loot.spawnLoot({ scene, levelId: token.level, point: spaces.shift(), from: centre, chat: false,
          itemData: unitData(unit.item, path), flight: HARVEST_FLIGHT(spawned) });
      }
    } catch(err) {
      console.error(`${MODULE_ID} | Could not drop ${unit.item.name} on the map`, err);
    }
    if ( tile ) spawned++;
    else rest.push(unit);
  }
  return rest;
}

/**
 * Deliver a spent strike, outside the queue: wait for the blows, drop the items, then report.
 * Nothing is lost silently: a strike that delivered nothing is refunded, one that delivered part of
 * it tells the GMs what is missing.
 * @param {object} claim
 * @returns {Promise<{left: number}>}
 */
async function settle(claim) {
  const { behavior, token, resource, items, drops, user } = claim;
  try {
    await new Promise(resolve => setTimeout(resolve, STRIKE_MS));
    let rest;
    try {
      rest = await spawnDrops(claim, game.modules.get(LOOT_ID).api.getQuantityPath());
    } catch(err) {
      // Canvas Loot failed before a single unit was tried: nothing reached the map, so it is refunded below.
      console.error(`${MODULE_ID} | Could not drop the items on the map`, err);
      rest = claim.units;
    }
    const lost = new Map();
    for ( const u of rest ) lost.set(u.ref.uuid, (lost.get(u.ref.uuid) ?? 0) + u.quantity);
    const total = drops.reduce((sum, d) => sum + d.quantity, 0);
    const missing = [...lost.values()].reduce((sum, n) => sum + n, 0);
    if ( missing >= total ) {
      // Read fresh: the GM may have refilled the spot meanwhile.
      await behavior.update({ "system.remaining": behavior.system.left + 1 });
      throw refusal("Failed");
    }
    const left = behavior.system.left;
    const pick = map => drops.flatMap(({ ref }) => map.get(ref.uuid) ? [{ ref, quantity: map.get(ref.uuid) }] : []);
    const undelivered = pick(lost);
    await postCard(claim, undelivered, left);
    if ( undelivered.length ) await whisperUndelivered(claim, undelivered);
    Hooks.callAll(`${MODULE_ID}.harvest`, token, { resource, spot: behavior, drops, undelivered, left, user });
    return { left };
  } finally {
    busy.delete(behavior.uuid);
  }
}

/**
 * The resource as a message's flags carry it. A verb is left out unless the resource has its own,
 * so a card can word the animation's verb in its own language.
 * @param {Resource} resource
 * @returns {{id: string, name: string, img: string, animation: string, verb?: string}}
 */
function resourceFlag({ id, name, img, animation, verb }) {
  return verb ? { id, name, img, animation, verb } : { id, name, img, animation };
}

/**
 * Post one of the module's messages, on the active GM. The message carries what happened as data in
 * its flags, and canvas-harvest.preChatMessage lets a system or module restyle or cancel it first.
 * @param {object} messageData   what ChatMessage.create takes, without the flags
 * @param {object} data          the flags: event, actorName, resource, items, spotUuid, and left for a harvest
 * @param {object} context       the live objects the flags don't carry
 */
async function postMessage(messageData, data, context) {
  messageData.flags = { [MODULE_ID]: foundry.utils.deepClone(data) };
  // Not awaited, as every pre* hook: a listener has to finish messageData before it returns.
  if ( Hooks.call(`${MODULE_ID}.preChatMessage`, messageData, { event: data.event, ...context }) === false ) return;
  // Written again after the hook: a listener that rebuilt the flags would otherwise take the data away
  // from every other listener.
  foundry.utils.setProperty(messageData, `flags.${MODULE_ID}`, data);
  await ChatMessage.implementation.create(messageData);
}

/**
 * The public card: who harvested what, and how much is left.
 * @param {object} claim
 * @param {{ref: ItemRef, quantity: number}[]} undelivered
 * @param {number} left
 */
async function postCard({ behavior, token, resource, drops, user }, undelivered, left) {
  const speaker = ChatMessage.implementation.getSpeaker({ token });
  const rows = drops.flatMap(({ ref, quantity }) => {
    const ground = quantity - (undelivered.find(d => d.ref.uuid === ref.uuid)?.quantity ?? 0);
    const { uuid, name, img } = liveRef(ref);
    return (ground > 0) ? [{ uuid, name, img, quantity: ground }] : [];
  });
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/harvest-card.hbs`, {
    theme: getTheme(),
    resource,
    resourceVideo: isWebm(resource.img),
    verb: resource.verb || game.i18n.localize(`CANVASHARVEST.Verb.${resource.animation}`),
    icon: ANIMATION_ICONS[resource.animation],
    actorName: speaker.alias,
    drops: rows,
    left,
    depleted: left === 0
  });
  await postMessage({ speaker, content }, {
    event: "harvest", actorName: speaker.alias, resource: resourceFlag(resource), items: rows, left, spotUuid: behavior.uuid
  }, { token, resource: foundry.utils.deepClone(resource), spot: behavior, user });
}

/**
 * Tell the GMs what a strike gave but nobody received, so they can hand it over.
 * @param {object} claim
 * @param {{ref: ItemRef, quantity: number}[]} undelivered
 */
async function whisperUndelivered({ behavior, token, resource, user }, undelivered) {
  const rows = undelivered.map(({ ref, quantity }) => {
    const { uuid, name, img } = liveRef(ref);
    return { uuid, name, img, quantity };
  });
  const items = rows.map(({ name, quantity }) => game.i18n.localize("CANVASHARVEST.Chat.Stack", {
    name: foundry.utils.escapeHTML(name), quantity
  }));
  const content = `<p>${game.i18n.localize("CANVASHARVEST.Chat.Undelivered", {
    actor: foundry.utils.escapeHTML(token.name), resource: foundry.utils.escapeHTML(resource.name),
    items: game.i18n.getListFormatter().format(items)
  })}</p>`;
  await postMessage({ content, whisper: game.users.filter(u => u.isGM).map(u => u.id) }, {
    event: "undelivered", actorName: token.name, resource: resourceFlag(resource), items: rows, spotUuid: behavior.uuid
  }, { token, resource: foundry.utils.deepClone(resource), spot: behavior, user });
}

/**
 * Whisper a player who lacks a tool every item that would do, once the GM's own check agrees.
 * @param {{behaviorUuid: string, tokenUuid: string}} payload
 * @param {User} user   who the server says sent the query
 */
async function whisperTools({ behaviorUuid, tokenUuid } = {}, user) {
  if ( !game.user.isActiveGM || !game.settings.get(MODULE_ID, SETTING_TOOL_WHISPER) ) return;
  const behavior = (typeof behaviorUuid === "string") ? await fromUuid(behaviorUuid) : null;
  const token = (typeof tokenUuid === "string") ? await fromUuid(tokenUuid) : null;
  if ( (behavior?.documentName !== "RegionBehavior") || (token?.documentName !== "Token") ) return;
  let tools;
  try {
    checkHarvest(behavior, token, user, { authoritative: true });
  } catch(err) {
    tools = err.tools;
  }
  if ( !tools ) return;
  const resource = behavior.system.resourceData;
  // A tool can sit both in a set and among the resource's own.
  const seen = new Set();
  const rows = tools.map(liveRef).filter(ref => !seen.has(ref.uuid) && seen.add(ref.uuid));
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/tool-card.hbs`, {
    theme: getTheme(),
    resource,
    resourceVideo: isWebm(resource.img),
    icon: ANIMATION_ICONS[resource.animation],
    tools: rows
  });
  const items = rows.map(({ uuid, name, img }) => ({ uuid, name, img }));
  await postMessage({ content, whisper: [user.id] }, {
    event: "needTool", actorName: token.name, resource: resourceFlag(resource), items, spotUuid: behavior.uuid
  }, { token, resource: foundry.utils.deepClone(resource), spot: behavior, user });
}

export function registerHarvest() {
  // The claim is serialised; the delivery is not, so two spots struck at once don't wait on each other.
  // A refusal goes back as its key and data rather than thrown: a rejected query only carries its
  // message, worded in the GM's language.
  CONFIG.queries[QUERY_HARVEST] = async (payload, { user }) => {
    try {
      return await settle(await serial(() => gmClaim(payload, user)));
    } catch(err) {
      if ( err.refusal ) return { refusal: err.refusal };
      throw err;
    }
  };
  CONFIG.queries[QUERY_NEED_TOOL] = (payload, { user }) => whisperTools(payload, user);
}
