/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  BOOK_APP_ID, GUIDE_APP_ID, GUIDE_FIELDS, GUIDE_STATES, MODULE_ID, SETTING_GUIDE_FIELDS, SETTING_GUIDE_FOUND,
  SETTING_GUIDE_VISIBILITY
} from "./constants.js";
import { liveRef, refMatches, toItemRef } from "./helpers.js";
import { getToolSet } from "./tool-sets.js";

/**
 * What the Field Guide shows: which resources players see, which the party has found, and which
 * fields every entry carries. The states live in their own world settings, never on the resource:
 * saving a package's resource would turn it into a GM edit that stops following its package.
 */

/**
 * A resource's state in the guide: the GM's choice, else its package's suggestion, else "discover".
 * @param {Resource} resource
 * @returns {"shown"|"discover"|"hidden"}
 */
export function guideState(resource) {
  const state = game.settings.get(MODULE_ID, SETTING_GUIDE_VISIBILITY)[resource.id] ?? resource.guide;
  return GUIDE_STATES.includes(state) ? state : "discover";
}

/**
 * @param {string} id
 * @returns {boolean} whether the party has found the resource
 */
export function isFound(id) {
  return game.settings.get(MODULE_ID, SETTING_GUIDE_FOUND).includes(id);
}

/**
 * @param {Resource} resource
 * @returns {boolean} whether the guide lists it at all, named or as a silhouette
 */
export function isListed(resource) {
  return guideState(resource) !== "hidden";
}

/**
 * @param {Resource} resource
 * @returns {boolean} whether the guide names it and shows what it takes and gives
 */
export function isKnown(resource) {
  const state = guideState(resource);
  return (state === "shown") || ((state === "discover") && isFound(resource.id));
}

/** @returns {Record<string, boolean>} what every entry shows players; chances mean nothing without drops */
export function guideFields() {
  const stored = game.settings.get(MODULE_ID, SETTING_GUIDE_FIELDS) ?? {};
  const fields = Object.fromEntries(GUIDE_FIELDS.map(field => [field, stored[field] !== false]));
  if ( !fields.drops ) fields.chances = false;
  return fields;
}

/**
 * Set the state of many resources in one write, as a group's eye does. GM only.
 * @param {string[]} ids
 * @param {"shown"|"discover"|"hidden"} state
 * @returns {Promise<void>}
 */
export async function setGuideState(ids, state) {
  const stored = { ...game.settings.get(MODULE_ID, SETTING_GUIDE_VISIBILITY) };
  for ( const id of ids ) stored[id] = state;
  await game.settings.set(MODULE_ID, SETTING_GUIDE_VISIBILITY, stored);
}

/**
 * Mark a resource found by the party, or forget it. GM only.
 * @param {string} id
 * @param {boolean} found
 * @returns {Promise<boolean>} true when it changed anything
 */
export async function setFound(id, found) {
  const list = game.settings.get(MODULE_ID, SETTING_GUIDE_FOUND);
  if ( list.includes(id) === found ) return false;
  await game.settings.set(MODULE_ID, SETTING_GUIDE_FOUND, found ? [...list, id] : list.filter(i => i !== id));
  return true;
}

/**
 * Every item that opens a resource: its own tools, then the items of each switched-on Tool Set. A set
 * left empty adds nothing, as if switched off. An item in two places is listed once.
 * @param {Resource} resource
 * @returns {ItemRef[]}   empty when bare hands will do
 */
export function resourceTools(resource) {
  const tools = [...resource.tools];
  for ( const set of resource.toolSets ) {
    for ( const item of getToolSet(set) ) {
      if ( !tools.some(t => t.uuid === item.uuid) ) tools.push(item);
    }
  }
  return tools;
}

/**
 * Whether an actor carries any of the tools.
 * @param {Actor} actor
 * @param {ItemRef[]} tools
 * @returns {boolean}
 */
export function carriesTool(actor, tools) {
  const carried = actor.items.map(i => toItemRef(i));
  // A hand-made copy is matched by name, and a tool renamed in the directory leaves copies under
  // either name, so the name it was listed with and its current one both count.
  const pairs = tools.map(tool => [tool, liveRef(tool)]);
  return pairs.some(pair => carried.some(ref => pair.some(tool => refMatches(tool, ref))));
}

/** The guide and the book's eyes follow every change to the states, the catalogue and the Tool Sets. */
export function guideChanged() {
  for ( const id of [GUIDE_APP_ID, BOOK_APP_ID] ) foundry.applications.instances.get(id)?.render();
}
