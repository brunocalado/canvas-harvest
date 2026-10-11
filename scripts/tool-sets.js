/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ANIMATIONS, BOOK_APP_ID, MODULE_ID, SETTING_TOOL_SETS, TOOL_SETS_APP_ID } from "./constants.js";
import { refFromUuid } from "./resources.js";

/**
 * Four Tool Sets, one per animation, that always exist and may be empty. A resource switches any of
 * them on, and an item from a switched-on set counts as a tool for it. The GM fills them in the Tool
 * Sets window; packages add items through the API.
 */

/** Items packages added to the sets, by package id. In memory: every client adds them again at ready. */
const contributed = new Map();

/** @returns {Record<string, ItemRef[]>} the GM's items in each set, as stored */
export function getWorldToolSets() {
  const stored = game.settings.get(MODULE_ID, SETTING_TOOL_SETS) ?? {};
  return Object.fromEntries(ANIMATIONS.map(set => [set, Array.isArray(stored[set]) ? stored[set] : []]));
}

/**
 * One set: the GM's items, then those packages added, each item once.
 * @param {string} set
 * @returns {(ItemRef & {source: string})[]}   source is "world" or the package's id
 */
export function getToolSet(set) {
  const items = (getWorldToolSets()[set] ?? []).map(ref => ({ ...ref, source: "world" }));
  for ( const [packageId, sets] of contributed ) {
    for ( const ref of sets[set] ?? [] ) {
      if ( !items.some(i => i.uuid === ref.uuid) ) items.push({ ...ref, source: packageId });
    }
  }
  return items;
}

/** @returns {Record<string, (ItemRef & {source: string})[]>} every set, by id */
export function getToolSets() {
  return Object.fromEntries(ANIMATIONS.map(set => [set, getToolSet(set)]));
}

/**
 * Replace the GM's items in one set. GM only, since the setting is the world's.
 * @param {string} set
 * @param {ItemRef[]} refs
 * @returns {Promise<void>}
 */
export async function saveWorldToolSet(set, refs) {
  const sets = foundry.utils.deepClone(getWorldToolSets());
  sets[set] = refs.map(({ uuid, name, img, type, sources }) => ({ uuid, name, img, type, sources }));
  await game.settings.set(MODULE_ID, SETTING_TOOL_SETS, sets);
}

/**
 * Add a package's items to one set, on this client. Call it on every client, from `ready` or the
 * `canvas-harvest.ready` hook. Adding an item again changes nothing.
 * @param {string} packageId
 * @param {string} set        one of ANIMATIONS
 * @param {string[]} uuids    item uuids, usually from the package's compendium
 * @returns {number} how many were accepted
 */
export function addTools(packageId, set, uuids) {
  if ( (typeof packageId !== "string") || !packageId.trim() ) throw new Error(`${MODULE_ID} | addTools needs a package id.`);
  if ( !ANIMATIONS.includes(set) ) throw new Error(`${MODULE_ID} | addTools needs a set: ${ANIMATIONS.join(", ")}.`);
  if ( !Array.isArray(uuids) ) throw new Error(`${MODULE_ID} | addTools needs a list of item uuids.`);
  const sets = contributed.get(packageId) ?? {};
  const list = sets[set] ??= [];
  let accepted = 0;
  for ( const uuid of uuids ) {
    const ref = refFromUuid(uuid);
    if ( !ref ) {
      console.warn(`${MODULE_ID} | Tool ${uuid} from ${packageId} does not resolve to an item; left out.`);
      continue;
    }
    if ( !list.some(r => r.uuid === ref.uuid) ) list.push(ref);
    accepted++;
  }
  contributed.set(packageId, sets);
  if ( accepted ) toolSetsChanged();
  return accepted;
}

/**
 * Forget every item a package added to the sets, on this client.
 * @param {string} packageId
 */
export function removeTools(packageId) {
  if ( contributed.delete(packageId) ) toolSetsChanged();
}

/** The Tool Sets window and the Resource Book show the sets, so both follow every change to them. */
export function toolSetsChanged() {
  for ( const id of [TOOL_SETS_APP_ID, BOOK_APP_ID] ) foundry.applications.instances.get(id)?.render();
}
