/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { GUIDE_APP_ID, MODULE_ID, RESOURCE_DRAG_TYPE, SPOT_TYPE } from "./constants.js";
import { registerSettings } from "./settings.js";
import { api } from "./api.js";
import { ResourceBook } from "./apps/resource-book.js";
import { registerHarvest } from "./harvest.js";
import { registerHarvestControls } from "./harvest-control.js";
import { SpotBehaviorType } from "./spot-behavior.js";

Hooks.once("init", () => {
  registerSettings();
  CONFIG.RegionBehavior.dataModels[SPOT_TYPE] = SpotBehaviorType;
  CONFIG.RegionBehavior.typeLabels[SPOT_TYPE] = `TYPES.RegionBehavior.${SPOT_TYPE}`;
  CONFIG.RegionBehavior.typeIcons[SPOT_TYPE] = "fa-solid fa-pickaxe";
  CONFIG.RegionBehavior.typeHints[SPOT_TYPE] = "CANVASHARVEST.Spot.TypeHint";
  registerHarvestControls();
  registerHarvest();
  game.modules.get(MODULE_ID).api = api;
  globalThis.CanvasHarvest = api;
});

Hooks.once("ready", () => {
  Hooks.callAll(`${MODULE_ID}.ready`, api);

  // Core waits half a second before hiding a tooltip, in case the pointer reaches another tooltipped
  // element. On the module's own elements a tenth is enough: core hands an active tooltip to the next
  // element at once, so by then the tooltip has either moved on or should go.
  document.body.addEventListener("pointerleave", event => {
    const anchor = game.tooltip.element;
    if ( (event.target !== anchor) || !anchor.closest(`.${MODULE_ID}`) ) return;
    window.setTimeout(() => {
      if ( game.tooltip.element === anchor ) game.tooltip.deactivate();
    }, 100);
  }, { capture: true, passive: true });
});

/**
 * The spot lifecycle hooks, on every client whatever scene it views, so a listener can play a sound
 * anywhere; one that writes documents checks game.user.isActiveGM. A Region made with its behaviors
 * inside (createSpot, a drag from the book) fires createRegion only, so both hooks are watched.
 */
Hooks.on("createRegion", region => {
  for ( const behavior of region.behaviors ) {
    if ( behavior.type === SPOT_TYPE ) Hooks.callAll(`${MODULE_ID}.spotCreated`, behavior);
  }
});
Hooks.on("createRegionBehavior", behavior => {
  if ( behavior.type === SPOT_TYPE ) Hooks.callAll(`${MODULE_ID}.spotCreated`, behavior);
});
Hooks.on("updateRegionBehavior", (behavior, changes, options) => {
  const effect = options[MODULE_ID];
  if ( (behavior.type !== SPOT_TYPE) || !effect || !("previous" in effect) ) return;
  const { previous } = effect;
  const left = behavior.system.left;
  if ( (previous > 0) && (left === 0) ) {
    // null when the spot was emptied by hand rather than by a strike.
    const token = effect.strike ? foundry.utils.fromUuidSync(effect.strike, { strict: false }) : null;
    Hooks.callAll(`${MODULE_ID}.spotDepleted`, behavior, token);
  }
  else if ( left > previous ) Hooks.callAll(`${MODULE_ID}.spotRefilled`, behavior, { previous, left });
});

/**
 * The buttons at the top of the Items directory: the Field Guide for everyone, and the Resource Book
 * beside it for GMs.
 * @param {foundry.applications.sidebar.tabs.ItemDirectory} app
 * @param {HTMLElement} html
 */
Hooks.on("renderItemDirectory", (app, html) => {
  // A partial re-render can leave the header in place, buttons included.
  const header = html.querySelector(".directory-header");
  if ( !header || header.querySelector(`.${MODULE_ID}.ch-directory-buttons`) ) return;
  const row = document.createElement("div");
  row.className = `${MODULE_ID} ch-directory-buttons`;
  const addButton = (icon, label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fa-solid ${icon}" inert></i> <span>${game.i18n.localize(label)}</span>`;
    button.addEventListener("click", onClick);
    row.append(button);
  };
  if ( game.user.isGM ) addButton("fa-book-open", "CANVASHARVEST.Book.Open", () => api.openBook());
  addButton("fa-leaf", "CANVASHARVEST.Guide.Open", () => api.openGuide());
  header.querySelector(".header-actions")?.after(row);
});

/**
 * The button a harvest card carries when the strike first wrote its resource into the Field Guide. The
 * card is posted once on the GM, so each client wires the button as it renders the message.
 */
Hooks.on("renderChatMessageHTML", (message, html) => {
  const button = html.querySelector(`.${MODULE_ID} .ch-chat-guide`);
  button?.addEventListener("click", () => api.openGuide({ resource: button.dataset.resourceId }));
});

/**
 * The Field Guide marks the tools the selected token carries, so it follows a change of token and
 * the items coming and going on that token's actor. A burst of changes renders it once.
 */
const renderGuide = foundry.utils.debounce(() => foundry.applications.instances.get(GUIDE_APP_ID)?.render(), 100);
Hooks.on("controlToken", renderGuide);
for ( const hook of ["createItem", "deleteItem"] ) {
  Hooks.on(hook, item => {
    const guide = foundry.applications.instances.get(GUIDE_APP_ID);
    if ( guide && item.parent && (item.parent === guide.actor) ) renderGuide();
  });
}

/**
 * The book shows each tool and drop by its item's current name and image, so it follows a rename or a
 * new icon made in the directory while it is open.
 */
Hooks.on("updateItem", (item, changes) => {
  if ( ("name" in changes) || ("img" in changes) ) foundry.applications.instances.get(ResourceBook.DEFAULT_OPTIONS.id)?.render();
});

/**
 * A Resource dragged from the book onto the map becomes a spot there. Dropped on a token, the spot is
 * attached to it and follows it: a carcass dragged aside keeps its spot.
 */
Hooks.on("dropCanvasData", (board, data) => {
  if ( data.type !== RESOURCE_DRAG_TYPE ) return;
  if ( game.user.isGM ) {
    // The topmost token under the drop on the viewed Level, if any.
    const token = canvas.tokens.placeables.filter(t => t.visible && t.bounds.contains(data.x, data.y)
      && (!canvas.level || t.document.includedInLevel(canvas.level.id))).sort((a, b) => b.zIndex - a.zIndex)[0];
    api.createSpot({ resource: data.id, x: data.x, y: data.y, token: token?.document ?? null })
      .catch(err => ui.notifications.warn(err.message));
  }
  // Ours either way, so no later listener acts on a Resource drop.
  return false;
});
