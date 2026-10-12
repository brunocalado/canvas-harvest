/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ResourceBook } from "./apps/resource-book.js";
import { MODULE_ID, RESOURCE_LIMITS, SPOT_TYPE } from "./constants.js";
import { requestHarvest } from "./harvest.js";
import { readPalette } from "./helpers.js";
import {
  cleanTags, getAllResources, getResource, registerResources, setResourceTags, unregisterResources
} from "./resources.js";
import { addTools, getToolSets, removeTools } from "./tool-sets.js";

/**
 * Warn the caller and refuse.
 * @param {string} key   under CANVASHARVEST.Errors
 * @param {object} [data]
 * @returns {false}
 */
function warn(key, data) {
  ui.notifications.warn(game.i18n.localize(`CANVASHARVEST.Errors.${key}`, data));
  return false;
}

/**
 * The spot behind what an API caller passed.
 * @param {RegionBehavior|RegionDocument|string} spot   a spot behavior, a region carrying one, or the uuid of either
 * @param {string} method                                the API member, for the error
 * @returns {RegionBehavior|null}   null when a uuid resolves to no spot
 */
function toSpot(spot, method) {
  if ( typeof spot === "string" ) spot = foundry.utils.fromUuidSync(spot, { strict: false });
  else if ( !(spot instanceof foundry.documents.RegionBehavior) && !(spot instanceof foundry.documents.RegionDocument) ) {
    throw new Error(`${MODULE_ID} | ${method} needs a Harvest Spot behavior, a region carrying one, or the uuid of either.`);
  }
  if ( spot instanceof foundry.documents.RegionDocument ) return spot.behaviors.find(b => b.type === SPOT_TYPE) ?? null;
  return (spot instanceof foundry.documents.RegionBehavior) && (spot.type === SPOT_TYPE) ? spot : null;
}

/**
 * The token document behind what an API caller passed.
 * @param {Token|TokenDocument|string|null} token
 * @param {string} method
 * @returns {TokenDocument|null}   null when a uuid resolves to no token
 */
function toToken(token, method) {
  if ( typeof token === "string" ) token = foundry.utils.fromUuidSync(token, { strict: false });
  else if ( token instanceof foundry.canvas.placeables.Token ) token = token.document;
  else if ( !(token instanceof foundry.documents.TokenDocument) ) {
    throw new Error(`${MODULE_ID} | ${method} needs a Token, a TokenDocument or a token uuid.`);
  }
  return (token instanceof foundry.documents.TokenDocument) ? token : null;
}

/**
 * Canvas Harvest's public API, at game.modules.get(MODULE_ID).api and globalThis.CanvasHarvest.
 * Refusals a user can cause (not a GM, unknown id) show a localized warning and resolve false.
 * Programmer errors (wrong argument types) throw, prefixed with the module id.
 * Data handed out is always a deep clone.
 *
 * Packages ship resources by calling `registerResources` on every client, from their own `ready` hook
 * or the `canvas-harvest.ready` hook, which passes this object. A resource switches Tool Sets on by
 * id, and may name tools of its own; tools and drops are item uuids, usually from the package's own
 * compendium. A package can also add its items to the four Tool Sets with `addTools`:
 *
 *   CanvasHarvest.addTools("my-module", "strike", ["Compendium.my-module.items.Item.pickaxe00000000"]);
 *   CanvasHarvest.registerResources("my-module", [{
 *     id: "iron-vein", name: "Iron Vein", img: "icons/commodities/stone/ore-chunk-iron-black.webp",
 *     verb: "Mine", animation: "strike", toolSets: ["strike"],
 *     drops: [{ uuid: "Compendium.my-module.items.Item.ironore00000000", weight: 8, min: 1, max: 1 }],
 *     strikes: 10
 *   }]);
 */
export const api = {
  /**
   * Open the Resource Book, or bring it forward. GM only.
   * @param {object} [options]
   * @param {string} [options.resource]   a resource id to show in it
   * @returns {Promise<ResourceBook|false>}
   */
  async openBook({ resource } = {}) {
    if ( !game.user.isGM ) return warn("GMOnly");
    const shown = resource ? getResource(resource) : null;
    if ( resource && !shown ) return warn("UnknownResource", { id: resource });
    const existing = foundry.applications.instances.get(ResourceBook.DEFAULT_OPTIONS.id);
    const app = existing ?? new ResourceBook();
    // On a book not rendered yet this only sets the draft; the forced render below shows it.
    if ( shown ) await app.showResource(shown);
    await app.render({ force: true });
    if ( existing ) app.bringToFront();
    return app;
  },

  /**
   * Register a package's resources on this client; bad entries are skipped with a console warning.
   * @param {string} packageId
   * @param {object[]} list
   * @returns {number} how many were accepted
   */
  registerResources,

  /** @param {string} packageId */
  unregisterResources,

  /**
   * Add a package's items to one Tool Set, on this client; bad uuids are skipped with a console warning.
   * @param {string} packageId
   * @param {string} set        "strike", "chop", "gather" or "carve"
   * @param {string[]} uuids
   * @returns {number} how many were accepted
   */
  addTools,

  /** @param {string} packageId */
  removeTools,

  /** @returns {Record<string, object[]>} each Tool Set's items: the world's first, then those packages added */
  getToolSets: () => foundry.utils.deepClone(getToolSets()),

  /** @returns {object[]} every resource: the world's first, then those packages registered */
  getResources: () => getAllResources().map(r => foundry.utils.deepClone(r)),

  /**
   * @param {string} id
   * @returns {object|null}
   */
  getResource: id => {
    const resource = getResource(id);
    return resource ? foundry.utils.deepClone(resource) : null;
  },

  /**
   * Replace the tags of one of the world's resources. GM only. A package's resources take their tags
   * when they are registered.
   * @param {string} id
   * @param {string[]} tags   trimmed; blanks and repeats are dropped
   * @returns {Promise<boolean>}
   */
  async setTags(id, tags) {
    if ( typeof id !== "string" ) throw new Error(`${MODULE_ID} | setTags needs a Resource id.`);
    const clean = cleanTags(tags);
    if ( !clean ) {
      const L = RESOURCE_LIMITS;
      throw new Error(`${MODULE_ID} | setTags needs a list of up to ${L.tags} strings of up to ${L.tag} characters.`);
    }
    if ( !game.user.isGM ) return warn("GMOnly");
    const resource = getResource(id);
    if ( !resource ) return warn("UnknownResource", { id: foundry.utils.escapeHTML(id) });
    if ( resource.source !== "world" ) return warn("PackageResource", { name: foundry.utils.escapeHTML(resource.name) });
    await setResourceTags(id, clean);
    return true;
  },

  /**
   * Make a Harvest Spot: a square or rectangular Region carrying the spot behavior. GM only.
   * @param {object} args
   * @param {string} args.resource           a Resource id
   * @param {number} [args.x]                canvas coordinates of the centre; ignored with a token
   * @param {number} [args.y]
   * @param {Scene} [args.scene=canvas.scene]
   * @param {string|null} [args.levelId]     the viewed Level by default, every Level on a scene not on the
   *   canvas; ignored with a token, whose Level the spot takes
   * @param {number} [args.margin=1]        grid spaces around the centre space: 1 makes a 3×3 square
   * @param {number} [args.width]           with `height`, in place of `margin`: the rectangle's size in
   * @param {number} [args.height]            whole grid spaces, 1 or more; with a token, at least its size
   * @param {Token|TokenDocument|string|null} [args.token]   attach the spot to this token: centred on it, reaching
   *   `margin` spaces past its larger side, and following it when it moves
   * @returns {Promise<RegionDocument|false>}
   */
  async createSpot({ resource, x, y, scene = canvas.scene, levelId, margin, width, height, token = null } = {}) {
    if ( typeof resource !== "string" ) throw new Error(`${MODULE_ID} | createSpot needs a Resource id.`);
    if ( !(scene instanceof foundry.documents.Scene) ) throw new Error(`${MODULE_ID} | createSpot needs a Scene.`);
    const sized = (width !== undefined) || (height !== undefined);
    if ( sized ) {
      if ( margin !== undefined ) throw new Error(`${MODULE_ID} | createSpot takes a margin, or a width and height, not both.`);
      const whole = n => Number.isInteger(n) && (n >= 1);
      if ( !whole(width) || !whole(height) ) throw new Error(`${MODULE_ID} | createSpot needs a width and a height in whole grid spaces, 1 or more.`);
    }
    else {
      margin ??= 1;
      if ( !Number.isFinite(margin) || (margin < 0) ) throw new Error(`${MODULE_ID} | createSpot needs a margin of 0 or more.`);
    }
    const carrier = (token === null) ? null : toToken(token, "createSpot");
    if ( !carrier && (!Number.isFinite(x) || !Number.isFinite(y)) ) throw new Error(`${MODULE_ID} | createSpot needs x and y, or a token.`);
    // The token stands in its own spot, so the spot can't be smaller than the token.
    if ( carrier && sized && ((width < carrier.width) || (height < carrier.height)) ) {
      throw new Error(`${MODULE_ID} | createSpot needs a width and height at least the token's size.`);
    }
    if ( !game.user.isGM ) return warn("GMOnly");
    // A uuid that resolves to nothing must not quietly make an unattached spot at x, y.
    if ( (token !== null) && !carrier ) return warn("UnknownToken");
    const data = getResource(resource);
    if ( !data ) return warn("UnknownResource", { id: foundry.utils.escapeHTML(resource) });
    if ( carrier && (carrier.parent !== scene) ) return warn("NotOnScene");
    const grid = scene.grid;
    let centre;
    // Half the square's side without a size: half the centre space (or the token's larger side),
    // plus the margin.
    let side;
    if ( carrier ) {
      centre = carrier.getCenterPoint();
      side = (Math.max(carrier.width, carrier.height) / 2) + margin;
      levelId = carrier.level;
    }
    else {
      centre = grid.isGridless ? { x, y } : grid.getCenterPoint(grid.getOffset({ x, y }));
      // An even side has no middle space: its centre moves to the nearer grid line, so the
      // rectangle still covers whole spaces.
      if ( sized && !grid.isGridless ) {
        if ( width % 2 === 0 ) centre.x += ((x < centre.x) ? -0.5 : 0.5) * grid.size;
        if ( height % 2 === 0 ) centre.y += ((y < centre.y) ? -0.5 : 0.5) * grid.size;
      }
      side = 0.5 + margin;
      levelId ??= (scene === canvas.scene) ? (canvas.level?.id ?? null) : null;
    }
    const reach = sized ? { x: (width / 2) * grid.size, y: (height / 2) * grid.size } : { x: side * grid.size, y: side * grid.size };
    const [region] = await scene.createEmbeddedDocuments("Region", [{
      name: data.name,
      color: readPalette().glow.css,
      // The GM sees where a spot reaches on any layer; players only ever see its medallion.
      visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
      // gridBased off: the region is the rectangle drawn, not the grid spaces it touches.
      shapes: [{ type: "rectangle", x: centre.x - reach.x, y: centre.y - reach.y, width: 2 * reach.x, height: 2 * reach.y, gridBased: false }],
      levels: levelId ? [levelId] : [],
      attachment: { token: carrier?.id ?? null },
      behaviors: [{ type: SPOT_TYPE, name: data.name, system: { resource: data.id, remaining: data.strikes } }]
    }]);
    return region ?? false;
  },

  /**
   * Every Harvest Spot on a scene.
   * @param {Scene} [scene=canvas.scene]
   * @returns {{regionUuid: string, behaviorUuid: string, resourceId: string, left: number, strikes: number|null, disabled: boolean}[]}
   */
  getSpots(scene = canvas.scene) {
    if ( !(scene instanceof foundry.documents.Scene) ) throw new Error(`${MODULE_ID} | getSpots needs a Scene.`);
    return scene.regions.contents.flatMap(region => region.behaviors.filter(b => b.type === SPOT_TYPE).map(b => ({
      regionUuid: region.uuid,
      behaviorUuid: b.uuid,
      resourceId: b.system.resource,
      left: b.system.left,
      strikes: b.system.resourceData?.strikes ?? null,
      disabled: b.disabled
    })));
  },

  /**
   * Put strikes back into a spot. GM only. Every client plays the refill.
   * @param {RegionBehavior|RegionDocument|string} spot
   * @param {number} [amount]   strikes left afterwards, any number from 0; omitted means the resource's strikes
   * @returns {Promise<boolean>}
   */
  async refill(spot, amount) {
    const behavior = toSpot(spot, "refill");
    if ( (amount !== undefined) && !Number.isFinite(amount) ) throw new Error(`${MODULE_ID} | refill needs a number of strikes, or nothing for full.`);
    if ( !game.user.isGM ) return warn("GMOnly");
    if ( !behavior ) return warn("UnknownSpot");
    const remaining = (amount === undefined) ? (behavior.system.resourceData?.strikes ?? null) : Math.max(Math.round(amount), 0);
    await behavior.update({ "system.remaining": remaining }, { [MODULE_ID]: { refill: true } });
    return true;
  },

  /**
   * Strike a spot with a token, by the same rules and the same path as a click on its medallion.
   * @param {Token|TokenDocument|string} token
   * @param {RegionBehavior|RegionDocument|string} spot
   * @returns {Promise<boolean>}   false, after a warning, when the strike was refused or failed
   */
  async harvest(token, spot) {
    const tokenDoc = toToken(token, "harvest");
    const behavior = toSpot(spot, "harvest");
    if ( !tokenDoc ) return warn("UnknownToken");
    if ( !behavior ) return warn("UnknownSpot");
    return requestHarvest(behavior, tokenDoc);
  }
};
