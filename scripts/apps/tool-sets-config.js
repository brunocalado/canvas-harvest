/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ANIMATION_ICONS, ANIMATIONS, MODULE_ID, TEMPLATE_PATH, THEMES, TOOL_SETS_APP_ID } from "../constants.js";
import { droppedItemRef, getTheme, liveRef, SingleWindow, sourceLabel } from "../helpers.js";
import { AmbientFX } from "../ambient-fx.js";
import { getToolSet, getWorldToolSets, saveWorldToolSet } from "../tool-sets.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The four Tool Sets, one tab each, filled by dropping items. A change is saved at once: each tab is
 * one list with no draft to lose, so a Save button would only be a step to forget.
 */
export class ToolSetsConfig extends SingleWindow(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: TOOL_SETS_APP_ID,
    classes: [MODULE_ID, "ch-app", "ch-tool-sets"],
    window: {
      title: "CANVASHARVEST.ToolSets.Title",
      icon: "fa-solid fa-toolbox",
      resizable: false
    },
    position: { width: 560, height: "auto" },
    actions: {
      removeTool: ToolSetsConfig.#onRemove
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/tool-sets.hbs`, scrollable: [".ch-set-grid"] }
  };

  static TABS = {
    main: {
      tabs: ANIMATIONS.map(id => ({ id, icon: `fa-solid ${ANIMATION_ICONS[id]}` })),
      initial: "strike",
      labelPrefix: "CANVASHARVEST.Verb"
    }
  };

  /** The particles behind the tabs. */
  #fx = new AmbientFX(getTheme());

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const theme = getTheme();
    const sets = ANIMATIONS.map(id => {
      const items = getToolSet(id).map(ref => {
        const live = liveRef(ref);
        const fromPackage = ref.source !== "world";
        const source = fromPackage ? sourceLabel(ref.source) : "";
        return {
          uuid: ref.uuid, name: live.name, img: live.img, fromPackage,
          tip: fromPackage
            ? `${foundry.utils.escapeHTML(live.name)}<br>${foundry.utils.escapeHTML(game.i18n.localize("CANVASHARVEST.ToolSets.From", { source }))}`
            : foundry.utils.escapeHTML(live.name)
        };
      });
      return { ...context.tabs[id], items, count: items.length };
    });
    return { theme, sets };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of THEMES ) this.element.classList.toggle(`ch-theme-${t}`, t === theme);
    this.#fx.attach(this.element.querySelector("canvas.ch-fx"), theme);
    // The light's sway and the hearth's swell run on the particles' clock, from the document's time 0.
    for ( const animation of this.element.getAnimations({ subtree: true }) ) {
      if ( /^ch-(breeze|bellows)/.test(animation.animationName ?? "") ) animation.startTime = 0;
    }
    // An item dragged over a tab opens it, so it can be dropped into any set without letting go.
    for ( const tab of this.element.querySelectorAll("[data-action=tab]") ) {
      tab.addEventListener("dragenter", () => this.changeTab(tab.dataset.tab, tab.dataset.group));
      tab.addEventListener("dragover", ev => ev.preventDefault());
    }
    for ( const zone of this.element.querySelectorAll("[data-drop-set]") ) {
      zone.addEventListener("dragover", ev => {
        ev.preventDefault();
        zone.classList.add("ch-drop-target");
      });
      zone.addEventListener("dragleave", ev => {
        if ( !zone.contains(ev.relatedTarget) ) zone.classList.remove("ch-drop-target");
      });
      zone.addEventListener("drop", this.#onDrop.bind(this));
    }
    for ( const slot of this.element.querySelectorAll(".ch-slot[data-uuid]") ) {
      slot.addEventListener("dblclick", () => fromUuid(slot.dataset.uuid).then(item => item?.sheet?.render({ force: true })));
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#fx.stop();
  }

  /** @param {DragEvent} event */
  async #onDrop(event) {
    event.preventDefault();
    const zone = event.currentTarget;
    zone.classList.remove("ch-drop-target");
    const set = zone.dataset.dropSet;
    const ref = await droppedItemRef(event);
    if ( !ref ) return;
    // Only the same item is a twin. The same item in two sets is fine: an axe can chop and carve.
    if ( getToolSet(set).some(r => r.uuid === ref.uuid) ) {
      return ui.notifications.warn(game.i18n.localize("CANVASHARVEST.Errors.AlreadyListed", { name: foundry.utils.escapeHTML(ref.name) }));
    }
    // The setting's onChange re-renders this window, on the same tab.
    await saveWorldToolSet(set, [...getWorldToolSets()[set], ref]);
  }

  /** @this {ToolSetsConfig} */
  static async #onRemove(event, target) {
    const { set, uuid } = target.closest("[data-uuid]").dataset;
    await saveWorldToolSet(set, getWorldToolSets()[set].filter(r => r.uuid !== uuid));
  }
}
