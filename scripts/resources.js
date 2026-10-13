/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ANIMATIONS, BOOK_APP_ID, DEFAULT_RESOURCE_IMG, MODULE_ID, RESOURCE_LIMITS, SETTING_RESOURCE_EDITS, SETTING_RESOURCES } from "./constants.js";
import { refreshSpots } from "./harvest-control.js";
import { isWebm, toItemRef } from "./helpers.js";

/**
 * A source of items a token can work: an ore vein, a tree, a herb bush, a carcass. Nothing here knows
 * which; only `animation` says how a strike looks and sounds.
 * @typedef {object} Resource
 * @property {string} id            randomID() for the GM's; "<packageId>.<id>" for registered ones
 * @property {string} name
 * @property {string} img
 * @property {string} verb          the button's label; "" = the animation's own verb, in the reader's language
 * @property {"strike"|"chop"|"gather"|"carve"} animation
 * @property {string[]} toolSets   ids from ANIMATIONS whose Tool Set items count as tools; an empty set is ignored
 * @property {ItemRef[]} tools      the resource's own tools: these or a switched-on set's items, any one is enough
 * @property {{item: ItemRef, weight: number, min: number, max: number}[]} drops
 * @property {number} strikes       strikes a spot holds before it runs dry
 * @property {string} sound         "" = the animation's cue from the Harvest Sounds window
 * @property {boolean} soundEnabled  false silences every cue it plays; missing on resources saved before it, read as true
 * @property {number|null} soundRadius   grid spaces its cues carry; null (or missing) = the reach set in Harvest Sounds
 * @property {string} category      the book's group for it; "" = its animation's
 * @property {string[]} tags        what packages make of the resource; Canvas Harvest only keeps and passes them on
 * @property {string} [source]      "world" or the registering package's id; added on read, never stored
 * @property {boolean} [edited]     a package's resource the GM changed; added on read, never stored
 */

/** Resources packages registered, by id. In memory: every client registers them again at ready. */
const registered = new Map();

/**
 * The book and the spots on the map follow every change to the catalogue, whoever makes it: a
 * resource deleted or unregistered leaves its spots inert, one registered brings them back.
 */
export function catalogueChanged() {
  foundry.applications.instances.get(BOOK_APP_ID)?.render();
  refreshSpots();
}

/** @returns {Resource[]} the GM's resources, in the GM's order */
export function getWorldResources() {
  return game.settings.get(MODULE_ID, SETTING_RESOURCES).map(r => ({ ...r, source: "world" }));
}

/** @returns {Resource[]} the world's first, then those packages registered, each as the GM edited it */
export function getAllResources() {
  const edits = game.settings.get(MODULE_ID, SETTING_RESOURCE_EDITS);
  // Tags always come from the package: they are how it recognises its resource in its hooks.
  const fromPackages = [...registered.values()].map(r => (edits[r.id]
    ? { ...edits[r.id], id: r.id, source: r.source, tags: r.tags, edited: true } : r));
  return [...getWorldResources(), ...fromPackages];
}

/**
 * @param {string} id
 * @returns {Resource|null}
 */
export function getResource(id) {
  return getAllResources().find(r => r.id === id) ?? null;
}

/** @returns {Resource} a new, unsaved resource */
export function blankResource() {
  return {
    id: foundry.utils.randomID(),
    name: "",
    img: DEFAULT_RESOURCE_IMG,
    verb: "",
    animation: "strike",
    toolSets: [],
    tools: [],
    drops: [],
    strikes: 10,
    sound: "",
    soundEnabled: true,
    soundRadius: null,
    category: "",
    tags: []
  };
}

/**
 * @param {*} n
 * @param {[number, number]} range
 * @returns {boolean}
 */
function inRange(n, [min, max]) {
  return Number.isInteger(n) && (n >= min) && (n <= max);
}

/**
 * Whether the same item sits twice in a list, as the book and registration both refuse it.
 * @param {ItemRef[]} refs
 * @returns {boolean}
 */
function hasTwins(refs) {
  return refs.some((ref, i) => refs.slice(i + 1).some(other => other.uuid === ref.uuid));
}

/**
 * Check a resource against the limits.
 * @param {Resource} r
 * @returns {string|null} the CANVASHARVEST.Errors key it fails, or null
 */
export function validateResource(r) {
  const L = RESOURCE_LIMITS;
  const name = r.name?.trim() ?? "";
  if ( !name ) return "NoName";
  if ( name.length > L.name ) return "NameTooLong";
  if ( (r.verb?.trim().length ?? 0) > L.verb ) return "VerbTooLong";
  if ( (typeof r.category !== "string") || (r.category.trim().length > L.category) ) return "CategoryTooLong";
  if ( !ANIMATIONS.includes(r.animation) ) return "BadAnimation";
  if ( !Array.isArray(r.toolSets) || !r.toolSets.every(s => ANIMATIONS.includes(s))
    || (new Set(r.toolSets).size !== r.toolSets.length) ) return "BadToolSets";
  if ( r.tools.length > L.tools ) return "TooManyTools";
  if ( !r.drops.length ) return "NoDrops";
  if ( r.drops.length > L.drops ) return "TooManyDrops";
  if ( hasTwins(r.tools) || hasTwins(r.drops.map(d => d.item)) ) return "Twins";
  if ( r.drops.some(d => !inRange(d.min, L.count) || !inRange(d.max, L.count) || (d.min > d.max)) ) return "BadNumbers";
  if ( !r.drops.every(d => inRange(d.weight, L.weight)) || !inRange(r.strikes, L.strikes) ) return "BadNumbers";
  if ( ((r.soundRadius ?? null) !== null) && !inRange(r.soundRadius, L.soundRadius) ) return "BadNumbers";
  return null;
}

/**
 * What the setting keeps of a resource: its own fields, never `source` or anything a caller added.
 * @param {Resource} r
 * @returns {object}
 */
function toStored(r) {
  const { id, name, img, verb, animation, toolSets, tools, drops, strikes, sound, soundEnabled, soundRadius, category, tags } = foundry.utils.deepClone(r);
  return { id, name: name.trim(), img, verb: verb.trim(), animation, toolSets, tools,
    drops: drops.map(({ item, weight, min, max }) => ({ item, weight, min, max })), strikes, sound,
    soundEnabled: soundEnabled !== false, soundRadius: soundRadius ?? null, category: category.trim(), tags };
}

/**
 * Add a resource to the world's, or replace the one with its id where it stands; a package's
 * resource is saved as the GM's edit of it instead.
 * @param {Resource} r   already validated
 * @returns {Promise<void>}
 */
export async function saveResource(r) {
  // A package's resource is kept as the GM's edit of it, under its id, so the spots already on the
  // map follow it; the package registers its own version again on every load, underneath.
  if ( registered.has(r.id) ) {
    const { tags, ...stored } = toStored(r);
    const edits = { ...game.settings.get(MODULE_ID, SETTING_RESOURCE_EDITS), [r.id]: stored };
    await game.settings.set(MODULE_ID, SETTING_RESOURCE_EDITS, edits);
    return;
  }
  const list = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_RESOURCES));
  const stored = toStored(r);
  const index = list.findIndex(e => e.id === r.id);
  if ( index >= 0 ) list[index] = stored;
  else list.push(stored);
  await game.settings.set(MODULE_ID, SETTING_RESOURCES, list);
}

/**
 * Throw away the GM's edit of a package's resource: the package's version is back.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function restoreResource(id) {
  const edits = { ...game.settings.get(MODULE_ID, SETTING_RESOURCE_EDITS) };
  delete edits[id];
  await game.settings.set(MODULE_ID, SETTING_RESOURCE_EDITS, edits);
}

/**
 * Replace a world resource's tags, leaving the rest of it as saved.
 * @param {string} id
 * @param {string[]} tags   already cleaned
 * @returns {Promise<void>}
 */
export async function setResourceTags(id, tags) {
  const list = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_RESOURCES));
  const entry = list.find(e => e.id === id);
  if ( !entry ) return;
  entry.tags = tags;
  await game.settings.set(MODULE_ID, SETTING_RESOURCES, list);
}

/**
 * A list of tags as a resource keeps it: trimmed, without blanks or repeats. Tags enter only through
 * the API, so this is where they are checked; the book carries them as they are.
 * @param {*} list
 * @returns {string[]|null}   null when the list holds anything but strings, or breaks a limit
 */
export function cleanTags(list) {
  if ( !Array.isArray(list) || !list.every(t => typeof t === "string") ) return null;
  const tags = [...new Set(list.map(t => t.trim()).filter(Boolean))];
  if ( (tags.length > RESOURCE_LIMITS.tags) || tags.some(t => t.length > RESOURCE_LIMITS.tag) ) return null;
  return tags;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteResource(id) {
  const list = game.settings.get(MODULE_ID, SETTING_RESOURCES);
  await game.settings.set(MODULE_ID, SETTING_RESOURCES, list.filter(e => e.id !== id));
}

/**
 * An ItemRef for a uuid, from the compendium index when the item is in one, so registering never
 * loads a document.
 * @param {string} uuid
 * @returns {ItemRef|null}
 */
export function refFromUuid(uuid) {
  if ( typeof uuid !== "string" ) return null;
  const entry = foundry.utils.fromUuidSync(uuid, { strict: false });
  if ( !entry ) return null;
  const ref = toItemRef(entry);
  ref.uuid ??= uuid;
  if ( !ref.sources.includes(uuid) ) ref.sources.unshift(uuid);
  return ref;
}

/**
 * @param {*} value
 * @param {[number, number]} range
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, [min, max], fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.clamp(n, min, max) : fallback;
}

/**
 * A {min, max} pair clamped to its range, with min never above max.
 * @param {object} pair
 * @param {[number, number]} range
 * @returns {{min: number, max: number}}
 */
function clampPair(pair, range) {
  const min = clampInt(pair?.min, range, range[0]);
  return { min, max: Math.max(min, clampInt(pair?.max, range, min)) };
}

/**
 * Turn what a package passed into a Resource.
 * @param {string} packageId
 * @param {object} entry
 * @param {string} label    how warnings name the entry
 * @returns {Resource|string}   the resource, or why it was skipped
 */
function fromPackage(packageId, entry, label) {
  if ( (typeof entry?.id !== "string") || !entry.id.trim() ) return "it needs an id";
  if ( (typeof entry.name !== "string") || !entry.name.trim() ) return "it needs a name";
  const animation = entry.animation ?? "strike";
  if ( !ANIMATIONS.includes(animation) ) return `animation must be one of ${ANIMATIONS.join(", ")}`;
  const L = RESOURCE_LIMITS;
  // Skipped rather than trimmed: a resource that lost a tag would quietly lose what a package does with it.
  const tags = (entry.tags === undefined) ? [] : cleanTags(entry.tags);
  if ( !tags ) return `tags must be a list of up to ${L.tags} strings of up to ${L.tag} characters`;
  const resolve = (uuid, what) => {
    const ref = refFromUuid(uuid);
    if ( !ref ) console.warn(`${MODULE_ID} | Resource ${label}: ${what} ${uuid} does not resolve to an item; left out.`);
    return ref;
  };
  const tools = [];
  for ( const uuid of (Array.isArray(entry.tools) ? entry.tools : []) ) {
    const ref = resolve(uuid, "tool");
    if ( ref && !tools.some(t => t.uuid === ref.uuid) ) tools.push(ref);
  }
  const toolSets = [];
  for ( const set of (Array.isArray(entry.toolSets) ? entry.toolSets : []) ) {
    if ( !ANIMATIONS.includes(set) ) console.warn(`${MODULE_ID} | Resource ${label}: ${set} is not a Tool Set; left out.`);
    else if ( !toolSets.includes(set) ) toolSets.push(set);
  }
  const drops = [];
  for ( const drop of (Array.isArray(entry.drops) ? entry.drops : []) ) {
    const item = resolve(drop?.uuid, "drop");
    if ( !item || drops.some(d => d.item.uuid === item.uuid) ) continue;
    drops.push({ item, weight: clampInt(drop.weight, L.weight, L.weight[1]), ...clampPair(drop, L.count) });
  }
  if ( !drops.length ) return "no drop resolves to an item";
  if ( tools.length > L.tools ) console.warn(`${MODULE_ID} | Resource ${label}: only the first ${L.tools} tools are kept.`);
  if ( drops.length > L.drops ) console.warn(`${MODULE_ID} | Resource ${label}: only the first ${L.drops} drops are kept.`);
  return {
    id: `${packageId}.${entry.id.trim()}`,
    name: entry.name.trim().slice(0, L.name),
    img: imageOf(entry.img, label),
    verb: (typeof entry.verb === "string") ? entry.verb.trim().slice(0, L.verb) : "",
    animation,
    toolSets,
    tools: tools.slice(0, L.tools),
    drops: drops.slice(0, L.drops),
    strikes: clampInt(entry.strikes, L.strikes, 10),
    sound: (typeof entry.sound === "string") ? entry.sound : "",
    soundEnabled: entry.soundEnabled !== false,
    soundRadius: Number.isInteger(entry.soundRadius) ? Math.clamp(entry.soundRadius, ...L.soundRadius) : null,
    category: (typeof entry.category === "string") ? entry.category.trim().slice(0, L.category) : "",
    tags,
    source: packageId
  };
}

/**
 * A registered resource's image: any image, or a webm. Another video falls back to the default.
 * @param {*} img
 * @param {string} label   for the warning
 * @returns {string}
 */
function imageOf(img, label) {
  if ( (typeof img !== "string") || !img ) return DEFAULT_RESOURCE_IMG;
  if ( foundry.helpers.media.VideoHelper.hasVideoExtension(img) && !isWebm(img) ) {
    console.warn(`${MODULE_ID} | Resource ${label}: ${img} is a video other than webm, so the default image is used.`);
    return DEFAULT_RESOURCE_IMG;
  }
  return img;
}

/**
 * Register a package's resources on this client. Call it on every client, from `ready` or the
 * `canvas-harvest.ready` hook. Registering an id again replaces it.
 * @param {string} packageId
 * @param {object[]} list
 * @returns {number} how many were accepted
 */
export function registerResources(packageId, list) {
  if ( (typeof packageId !== "string") || !packageId.trim() ) throw new Error(`${MODULE_ID} | registerResources needs a package id.`);
  if ( !Array.isArray(list) ) throw new Error(`${MODULE_ID} | registerResources needs a list of resources.`);
  let accepted = 0;
  list.forEach((entry, index) => {
    const label = (typeof entry?.id === "string") && entry.id ? `${packageId}.${entry.id}` : `${packageId} #${index + 1}`;
    const result = fromPackage(packageId, entry, label);
    if ( typeof result === "string" ) return console.warn(`${MODULE_ID} | Resource ${label} skipped: ${result}.`);
    registered.set(result.id, result);
    accepted++;
  });
  if ( accepted ) catalogueChanged();
  return accepted;
}

/**
 * Forget every resource a package registered on this client.
 * @param {string} packageId
 */
export function unregisterResources(packageId) {
  let removed = false;
  for ( const [id, r] of registered ) {
    if ( r.source !== packageId ) continue;
    registered.delete(id);
    removed = true;
  }
  if ( removed ) catalogueChanged();
}
