/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  ANIMATION_ICONS, ANIMATIONS, BOOK_APP_ID, GUIDE_APP_ID, GUIDE_STATE_ICONS, GUIDE_STATES, MODULE_ID, RESOURCE_DRAG_TYPE, RESOURCE_LIMITS,
  SETTING_SOUND_RADIUS, TEMPLATE_PATH, THEMES
} from "../constants.js";
import {
  bindSearch, chance, confirmDialog, droppedItemRef, filterGroups, getCollapsed, getTheme, groupLabel, help, isWebm, liveRef, readCaret,
  restoreCaret, searchKey, setCollapsed, SingleWindow, sourceLabel
} from "../helpers.js";
import { AmbientFX } from "../ambient-fx.js";
import { playCue } from "../sound.js";
import { guideState, isFound, setFound, setGuideState } from "../guide.js";
import { blankResource, deleteResource, getAllResources, getResource, restoreResource, saveResource, validateResource } from "../resources.js";
import { getToolSet } from "../tool-sets.js";
import { FieldGuide } from "./field-guide.js";
import { ToolSetsConfig } from "./tool-sets-config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The key of a resource's group within its source. A category spelled like an animation's verb, in
 * any case, shares that animation's group. Package ids can't contain ":", so it never clashes with a source.
 * @param {Resource} r
 * @returns {string}
 */
function groupKey(r) {
  return `${r.source}::${groupLabel(r).toLocaleLowerCase()}`;
}

/**
 * What a resource's eye shows: its state in the Field Guide, and whether the party has found it.
 * @param {Resource} r
 * @returns {{state: string, icon: string, found: boolean, tip: string}}
 */
function eyeOf(r) {
  const state = guideState(r);
  const found = (state === "discover") && isFound(r.id);
  const tip = [game.i18n.localize(`CANVASHARVEST.Guide.State.${state}`)];
  if ( state === "discover" ) tip.push(game.i18n.localize(found ? "CANVASHARVEST.Guide.FoundYes" : "CANVASHARVEST.Guide.FoundNo"));
  return { state, icon: GUIDE_STATE_ICONS[state], found, tip: tip.join(" · ") };
}

/**
 * @param {string} state
 * @returns {string} the state an eye's click moves to: shown, discover, hidden, and round again
 */
function nextGuideState(state) {
  return GUIDE_STATES[(GUIDE_STATES.indexOf(state) + 1) % GUIDE_STATES.length];
}

/**
 * The GM's catalogue of resources: a list on the left, the one being edited on the right.
 */
export class ResourceBook extends SingleWindow(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: BOOK_APP_ID,
    classes: [MODULE_ID, "ch-app", "ch-book"],
    window: {
      title: "CANVASHARVEST.Book.Title",
      icon: "fa-solid fa-book-open",
      resizable: false
    },
    position: { width: 960, height: "auto" },
    actions: {
      newResource: ResourceBook.#onNew,
      selectResource: ResourceBook.#onSelect,
      saveResource: ResourceBook.#onSave,
      deleteResource: ResourceBook.#onDelete,
      duplicateResource: ResourceBook.#onDuplicate,
      restoreResource: ResourceBook.#onRestore,
      setCategory: ResourceBook.#onSetCategory,
      setAnimation: ResourceBook.#onSetAnimation,
      openToolSets: ResourceBook.#onOpenToolSets,
      clearTool: ResourceBook.#onClearTool,
      clearDrop: ResourceBook.#onClearDrop,
      browseImage: ResourceBook.#onBrowseImage,
      editSound: ResourceBook.#onEditSound,
      cycleGuide: ResourceBook.#onCycleGuide,
      cycleGuideGroup: ResourceBook.#onCycleGuideGroup,
      toggleFound: ResourceBook.#onToggleFound,
      openGuide: ResourceBook.#onOpenGuide
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/book.hbs`, scrollable: [".ch-list-scroll"] }
  };

  /** The resource being edited: a copy, saved only on demand. */
  draft = null;

  /** Unsaved edits on the draft. */
  dirty = false;

  /** The particles behind the detail pane. */
  #fx = new AmbientFX(getTheme());

  /** The list's search, as typed. */
  #query = "";

  /** Keys of the list groups the user closed. */
  #collapsed = getCollapsed();

  /** @override */
  async _prepareContext(options) {
    const all = getAllResources();
    const saved = this.draft ? all.find(r => r.id === this.draft.id) : undefined;
    // With no unsaved edits the draft is the saved resource, whoever saved it: an API call, another GM.
    // Saving a stale copy would quietly undo their change.
    if ( this.draft && !this.dirty ) {
      if ( saved ) this.draft = foundry.utils.deepClone(saved);
      // Deleted or unregistered elsewhere. A blank new resource has no source yet and stays.
      else if ( this.draft.source ) this.draft = null;
    }
    this.draft ??= all[0] ? foundry.utils.deepClone(all[0]) : blankResource();
    const draft = this.draft;
    const L = RESOURCE_LIMITS;
    const toEntry = r => ({
      id: r.id, name: r.name, img: r.img, video: isWebm(r.img), active: r.id === draft.id, edited: !!r.edited,
      icon: ANIMATION_ICONS[r.animation], guide: eyeOf(r),
      search: searchKey(`${r.name} ${r.verb} ${r.category} ${[...r.tools, ...r.drops.map(d => d.item)].map(i => liveRef(i).name).join(" ")}`),
      // Where a registered resource comes from, then the hint that the row drags onto the map.
      tip: [(r.source === "world") ? ""
        : game.i18n.localize(r.edited ? "CANVASHARVEST.Book.FromEdited" : "CANVASHARVEST.Book.From", { source: sourceLabel(r.source) }),
        game.i18n.localize("CANVASHARVEST.Book.DragHint")].filter(Boolean).map(t => foundry.utils.escapeHTML(t)).join("<br>")
    });
    // An animation's group keeps its verb's spelling and icon, whichever member names it.
    const verbs = new Map(ANIMATIONS.map(id => {
      const label = game.i18n.localize(`CANVASHARVEST.Verb.${id}`);
      return [label.toLocaleLowerCase(), { label, icon: ANIMATION_ICONS[id] }];
    }));
    const groups = Object.entries(Object.groupBy(all, r => r.source)).map(([source, list]) => {
      const group = { key: source, label: sourceLabel(source), count: list.length, collapsed: this.#collapsed.has(source) };
      const sub = Object.entries(Object.groupBy(list, groupKey));
      // A source whose resources all sit in one group stays a flat list: its one heading would say nothing.
      if ( sub.length < 2 ) {
        group.resources = list.map(toEntry);
        group.guide = group.resources[0].guide;
        return group;
      }
      group.categories = sub.map(([key, members]) => {
        const label = groupLabel(members[0]);
        const verb = verbs.get(label.toLocaleLowerCase());
        const resources = members.map(toEntry);
        return { key, label: verb?.label ?? label, icon: verb?.icon, count: members.length,
          collapsed: this.#collapsed.has(key), resources, guide: resources[0].guide };
      }).sort((a, b) => a.label.localeCompare(b.label));
      // A group's eye shows the state of its first row, the one a click starts from.
      group.guide = group.categories[0].guide;
      return group;
    });
    const totalWeight = draft.drops.reduce((sum, d) => sum + d.weight, 0);
    const tools = Array.from({ length: L.tools }, (_, index) => ({ index, item: draft.tools[index] ? liveRef(draft.tools[index]) : null }));
    const isNew = !all.some(r => r.id === draft.id);
    const eye = eyeOf(draft);
    return {
      theme: getTheme(),
      query: this.#query,
      groups,
      draft,
      imgVideo: isWebm(draft.img),
      isNew,
      // The guide's controls write at once, outside the draft, so a resource not saved yet has none.
      guide: eye,
      groupEyeTip: game.i18n.localize("CANVASHARVEST.Guide.Group"),
      found: { on: isFound(draft.id), locked: isNew || (eye.state !== "discover"),
        tip: game.i18n.localize(isFound(draft.id) ? "CANVASHARVEST.Guide.Forget" : "CANVASHARVEST.Guide.MarkFound") },
      // A blank new resource has no source until it is saved into the world.
      isPackage: !!draft.source && (draft.source !== "world"),
      // As saved: Restore is offered only for an edit that still exists.
      edited: !!saved?.edited,
      fromNote: (draft.source && (draft.source !== "world"))
        ? game.i18n.localize(saved?.edited ? "CANVASHARVEST.Book.FromEdited" : "CANVASHARVEST.Book.From",
          { source: sourceLabel(draft.source) }) : "",
      dirty: this.dirty,
      // Unset, the button names the animation's group the resource sits in, dimmed.
      category: { label: groupLabel(draft), set: !!draft.category.trim() },
      limits: L,
      verbPlaceholder: game.i18n.localize(`CANVASHARVEST.Verb.${draft.animation}`),
      animations: ANIMATIONS.map(id => ({ id, icon: ANIMATION_ICONS[id], active: id === draft.animation,
        label: game.i18n.localize(`CANVASHARVEST.Animation.${id}`) })),
      // An empty set's switch is off and locked whatever the draft holds: the harvest ignores an empty
      // set, and the draft keeps its choice for when the set is filled again.
      toolSets: ANIMATIONS.map(id => {
        const count = getToolSet(id).length;
        const verb = game.i18n.localize(`CANVASHARVEST.Verb.${id}`);
        return { id, icon: ANIMATION_ICONS[id], empty: !count, on: !!count && draft.toolSets.includes(id),
          tip: game.i18n.localize(`CANVASHARVEST.Book.${["ToolSetEmpty", "ToolSetOne"][count] ?? "ToolSetOn"}`, { verb, count }) };
      }),
      tools,
      drops: draft.drops.map((d, index) => ({ ...d, item: liveRef(d.item), index, share: chance(d.weight, totalWeight) })),
      // With one drop the weight changes nothing, so its slider is shown but cannot be moved.
      soleDrop: draft.drops.length === 1,
      canAddDrop: draft.drops.length < L.drops,
      verbHelp: help("CANVASHARVEST.Resource.Verb", "CANVASHARVEST.Book.VerbHint"),
      animationHelp: help("CANVASHARVEST.Resource.Animation", "CANVASHARVEST.Book.AnimationHint"),
      toolSetsHelp: help("CANVASHARVEST.Resource.ToolSets", "CANVASHARVEST.Book.ToolSetsHint"),
      toolsHelp: help("CANVASHARVEST.Resource.Tools", "CANVASHARVEST.Book.ToolsHint"),
      dropsHelp: help("CANVASHARVEST.Resource.Weight", "CANVASHARVEST.Book.WeightHint")
        + help("CANVASHARVEST.Resource.Amount", "CANVASHARVEST.Book.AmountHint"),
      customSound: !!draft.sound,
      soundOff: draft.soundEnabled === false,
      soundTip: (draft.soundEnabled === false) ? game.i18n.localize("CANVASHARVEST.Book.SoundOff")
        : game.i18n.localize("CANVASHARVEST.Book.SoundTip", {
          sound: draft.sound ? draft.sound.split("/").pop() : game.i18n.localize("CANVASHARVEST.Book.SoundDefault")
        }),
      strikesHelp: help("CANVASHARVEST.Resource.Strikes", "CANVASHARVEST.Book.StrikesHint")
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of THEMES ) this.element.classList.toggle(`ch-theme-${t}`, t === theme);
    this.#fx.attach(this.element.querySelector("canvas.ch-fx"), theme);
    // The light shafts' sway and the hearth's swell start at the document's time 0, the clock the
    // particles read, so a gust in the CSS and a gust of pollen are one gust.
    for ( const animation of this.element.getAnimations({ subtree: true }) ) {
      if ( /^ch-(breeze|bellows)/.test(animation.animationName ?? "") ) animation.startTime = 0;
    }
    this.#bindList();
    // A saved resource dragged onto the map becomes a spot there. While it is dragged the book fades
    // nearly out and lets the pointer through, so the map under it can be seen and dropped on. The
    // fade waits a tick: hiding the source in dragstart itself makes Chrome cancel the drag.
    for ( const entry of this.element.querySelectorAll(".ch-entry[data-resource-id]") ) {
      entry.draggable = true;
      entry.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: RESOURCE_DRAG_TYPE, id: entry.dataset.resourceId }));
        setTimeout(() => this.element.classList.add("ch-dragging-out"), 0);
      });
      entry.addEventListener("dragend", () => this.element.classList.remove("ch-dragging-out"));
    }
    // Typing only updates the draft. Re-rendering on every change would replace the Save button under
    // the cursor while a click on it is in progress, and the click would be lost.
    for ( const input of this.element.querySelectorAll(".ch-book-detail [name]") ) {
      input.addEventListener("input", this.#onFieldInput.bind(this));
    }
    for ( const el of this.element.querySelectorAll("[data-drop]") ) {
      el.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.currentTarget.classList.add("ch-drop-target");
      });
      el.addEventListener("dragleave", ev => ev.currentTarget.classList.remove("ch-drop-target"));
      el.addEventListener("drop", this.#onDrop.bind(this));
      el.addEventListener("dblclick", ev => {
        const ref = this.#slotRef(ev.currentTarget);
        if ( ref ) fromUuid(ref.uuid).then(item => item?.sheet?.render({ force: true }));
      });
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#fx.stop();
  }

  /** @override */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    state.caret = readCaret(priorElement);
  }

  /** @override */
  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);   // focuses the field first
    restoreCaret(newElement, state.caret);
  }

  /** Wire the search and the folding groups, and reapply the search a re-render would otherwise drop. */
  #bindList() {
    const list = this.element.querySelector(".ch-book-list");
    const apply = () => filterGroups(list, { query: this.#query, collapsed: this.#collapsed });
    bindSearch(list.querySelector("input[name=search]"), query => {
      this.#query = query;
      apply();
    });
    for ( const group of list.querySelectorAll("details.ch-group") ) {
      group.addEventListener("toggle", () => {
        // While searching, groups are opened by the filter, not by the user.
        if ( this.#query.trim() ) return;
        if ( group.open ) this.#collapsed.delete(group.dataset.group);
        else this.#collapsed.add(group.dataset.group);
        setCollapsed(this.#collapsed);
      });
    }
    apply();
  }

  /**
   * The item a slot shows.
   * @param {HTMLElement} slot
   * @returns {ItemRef|null}
   */
  #slotRef(slot) {
    const index = Number(slot.dataset.index);
    if ( slot.dataset.drop === "tool" ) return this.draft.tools[index] ?? null;
    return this.draft.drops[index]?.item ?? null;
  }

  /** @param {Event} event */
  #onFieldInput(event) {
    const input = event.currentTarget;
    const draft = this.draft;
    const L = RESOURCE_LIMITS;
    const int = range => Math.clamp(Math.round(Number(input.value) || range[0]), ...range);
    const [field, index, key] = input.name.split(".");
    switch ( field ) {
      case "name":
      case "verb":
        draft[field] = input.value;
        break;
      case "toolSets": {
        const on = new Set(draft.toolSets);
        if ( input.checked ) on.add(index);
        else on.delete(index);
        // In the sets' own order, so the stored list doesn't depend on the clicks.
        draft.toolSets = ANIMATIONS.filter(id => on.has(id));
        input.closest(".ch-tool-set")?.classList.toggle("ch-on", input.checked);
        break;
      }
      case "strikes":
        draft.strikes = int(L.strikes);
        this.#showValue(input, draft.strikes);
        break;
      case "drops": {
        const drop = draft.drops[Number(index)];
        if ( key === "weight" ) {
          // The book shows only the chance, never the raw weight.
          drop.weight = int(L.weight);
          this.#showShares();
        }
        else this.#setPair(input, drop, key, int(L.count));
        break;
      }
      default: return;
    }
    this.#markDirty(false);
  }

  /**
   * Set one end of a min–max pair. The other end follows when it would cross, slider and all.
   * @param {HTMLInputElement} input
   * @param {{min: number, max: number}} pair
   * @param {"min"|"max"} end
   * @param {number} value
   */
  #setPair(input, pair, end, value) {
    pair[end] = value;
    const other = (end === "min") ? "max" : "min";
    if ( (end === "min") ? (pair.max < value) : (pair.min > value) ) {
      pair[other] = value;
      const twin = this.element.querySelector(`[name="${input.name.replace(/\.(min|max)$/, `.${other}`)}"]`);
      if ( twin ) {
        twin.value = String(value);
        this.#showValue(twin, value);
      }
    }
    this.#showValue(input, value);
  }

  /**
   * Write a slider's value into the output beside it.
   * @param {HTMLInputElement} input
   * @param {number} value
   */
  #showValue(input, value) {
    const output = this.element.querySelector(`output[data-for="${input.name}"]`);
    if ( output ) output.textContent = String(value);
  }

  /** Rewrite every drop's chance beside its weight, since moving one weight changes them all. */
  #showShares() {
    const total = this.draft.drops.reduce((sum, d) => sum + d.weight, 0);
    this.draft.drops.forEach((d, i) => {
      const share = this.element.querySelector(`.ch-share[data-index="${i}"]`);
      if ( share ) share.textContent = chance(d.weight, total);
    });
  }

  /**
   * @param {boolean} render   whether the change alters what the form shows
   */
  #markDirty(render) {
    this.dirty = true;
    if ( render ) this.render();
    else this.element.querySelector(".ch-save")?.classList.add("ch-dirty");
  }

  /** @param {DragEvent} event */
  async #onDrop(event) {
    event.preventDefault();
    const target = event.currentTarget;
    target.classList.remove("ch-drop-target");
    const ref = await droppedItemRef(event);
    if ( !ref ) return;
    const isTool = target.dataset.drop === "tool";
    const index = ("index" in target.dataset) ? Number(target.dataset.index) : -1;
    const refs = isTool ? this.draft.tools : this.draft.drops.map(d => d.item);
    // Dropping onto a filled slot replaces its item, so that item is not a twin of the new one. Only
    // the same item is a twin: a duplicate shares its source but is a separate item of its own.
    if ( refs.some((r, i) => r && (i !== index) && (r.uuid === ref.uuid)) ) {
      return ui.notifications.warn(game.i18n.localize("CANVASHARVEST.Errors.AlreadyListed", { name: foundry.utils.escapeHTML(ref.name) }));
    }
    if ( isTool ) {
      if ( this.draft.tools[index] ) this.draft.tools[index] = ref;
      else if ( this.draft.tools.length < RESOURCE_LIMITS.tools ) this.draft.tools.push(ref);
    }
    else if ( this.draft.drops[index] ) this.draft.drops[index].item = ref;
    else if ( this.draft.drops.length < RESOURCE_LIMITS.drops ) this.draft.drops.push({ item: ref, weight: RESOURCE_LIMITS.weight[1], min: 1, max: 1 });
    this.#markDirty(true);
  }

  /**
   * Ask before throwing away unsaved edits.
   * @returns {Promise<boolean>}
   */
  async #confirmDiscard() {
    if ( !this.dirty ) return true;
    return confirmDialog({
      title: "CANVASHARVEST.Book.Unsaved",
      content: `<p>${game.i18n.localize("CANVASHARVEST.Book.DiscardChanges")}</p>`
    });
  }

  /**
   * Put a resource in the detail pane, in place of the draft.
   * @param {Resource|null} resource   null for a blank one
   */
  #open(resource) {
    this.draft = resource ? foundry.utils.deepClone(resource) : blankResource();
    this.dirty = false;
    // A resource picked through a search must not vanish into a closed group once the search is cleared.
    if ( resource && [resource.source, groupKey(resource)].map(key => this.#collapsed.delete(key)).some(Boolean) ) {
      setCollapsed(this.#collapsed);
    }
    this.render();
  }

  /**
   * Show a resource as if the GM had picked it in the list, with the search cleared so its row is
   * there to see. Unsaved edits to that same resource are kept; to another one, the GM is asked first.
   * @param {Resource} resource
   */
  async showResource(resource) {
    const keep = this.dirty && (resource.id === this.draft?.id);
    if ( !keep && !(await this.#confirmDiscard()) ) return;
    this.#query = "";
    if ( keep ) this.render();
    else this.#open(resource);
  }

  /** @this {ResourceBook} */
  static async #onNew() {
    if ( !(await this.#confirmDiscard()) ) return;
    this.#open(null);
  }

  /** @this {ResourceBook} */
  static async #onSelect(event, target) {
    if ( target.dataset.resourceId === this.draft?.id ) return;
    if ( !(await this.#confirmDiscard()) ) return;
    const resource = getResource(target.dataset.resourceId);
    if ( resource ) this.#open(resource);
  }

  /** @this {ResourceBook} */
  static async #onSave() {
    const draft = this.draft;
    const error = validateResource(draft);
    if ( error ) return ui.notifications.warn(game.i18n.localize(`CANVASHARVEST.Errors.${error}`));
    // The book never edits tags: a resource already saved keeps the ones it has now, which an API call
    // may have changed while the draft was open; a new one, a duplicate, takes those it was copied with.
    await saveResource({ ...draft, tags: getResource(draft.id)?.tags ?? draft.tags });
    this.draft = foundry.utils.deepClone(getResource(draft.id));
    this.dirty = false;
    this.render();
  }

  /**
   * Delete a world resource, or discard a new one. A registered resource has no Delete: its package
   * registers it again on every load.
   * @this {ResourceBook}
   */
  static async #onDelete() {
    const draft = this.draft;
    if ( draft.source && (draft.source !== "world") ) return;
    if ( getResource(draft.id) ) {
      const ok = await confirmDialog({
        title: "CANVASHARVEST.Book.Delete",
        content: `<p>${game.i18n.localize("CANVASHARVEST.Book.DeleteConfirm", { name: foundry.utils.escapeHTML(draft.name) })}</p>`
      });
      if ( !ok ) return;
      await deleteResource(draft.id);
    }
    this.draft = null;
    this.dirty = false;
    this.render();
  }

  /**
   * Start a world resource from the draft, unsaved edits included. It owes nothing to the original,
   * so it outlives a package that is disabled.
   * @this {ResourceBook}
   */
  static #onDuplicate() {
    this.draft = { ...foundry.utils.deepClone(this.draft), id: foundry.utils.randomID(), source: "world" };
    delete this.draft.edited;
    this.#markDirty(true);
  }

  /**
   * Bring back the version of a package's resource its package registers. The confirmation covers
   * unsaved edits too.
   * @this {ResourceBook}
   */
  static async #onRestore() {
    // Named as saved: the draft may hold an unsaved name.
    const saved = getResource(this.draft.id);
    // Its package unregistered it meanwhile: the render drops the draft, or hides Restore if it is dirty.
    if ( !saved?.edited ) return this.render();
    const ok = await confirmDialog({
      title: "CANVASHARVEST.Book.Restore",
      content: `<p>${game.i18n.localize("CANVASHARVEST.Book.RestoreConfirm", {
        name: foundry.utils.escapeHTML(saved.name), source: foundry.utils.escapeHTML(sourceLabel(saved.source)) })}</p>`
    });
    if ( !ok ) return;
    await restoreResource(saved.id);
    this.draft = foundry.utils.deepClone(getResource(saved.id));
    this.dirty = false;
    this.render();
  }

  /**
   * Pick the draft's category from those in use, or coin a new one; picking the lit one again unsets
   * it, and the resource goes back to its animation's group. Like every other field it waits for Save.
   * @this {ResourceBook}
   */
  static async #onSetCategory() {
    // Saved resources only: the counts say where a resource is listed now, not in this unsaved draft.
    const all = getAllResources();
    const names = [...new Set([...all.map(r => r.category.trim()), this.draft.category.trim()].filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const state = { picked: this.draft.category.trim() };
    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/category-dialog.hbs`, {
      max: RESOURCE_LIMITS.category,
      categories: names.map(name => ({ name, active: name === state.picked, count: all.filter(r => r.category.trim() === name).length }))
    });
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "CANVASHARVEST.Book.Category" },
      classes: [MODULE_ID, "ch-app", "ch-dialog", "ch-category-dialog", `ch-theme-${getTheme()}`],
      position: { width: 420 },
      content,
      ok: { class: "ch-button", callback: () => state.picked },
      render: (event, dialog) => ResourceBook.#bindCategoryCloud(dialog.element, state)
    });
    if ( (typeof result !== "string") || (result === this.draft.category) ) return;
    this.draft.category = result;
    this.#markDirty(true);
  }

  /**
   * One chip lit at most: a click lights it, or puts it out if it was lit. New turns into a field,
   * and Enter there adds a lit chip, or lights the one already spelled that way.
   * @param {HTMLElement} root   the dialog
   * @param {{picked: string}} state
   */
  static #bindCategoryCloud(root, state) {
    const cloud = root.querySelector(".ch-chip-cloud");
    const add = cloud.querySelector("[data-new-category]");
    const field = cloud.querySelector(".ch-chip-input");
    const pick = chip => {
      state.picked = (chip?.dataset.category === state.picked) ? "" : (chip?.dataset.category ?? "");
      for ( const c of cloud.querySelectorAll("[data-category]") ) {
        const on = c.dataset.category === state.picked;
        c.classList.toggle("ch-active", on);
        c.setAttribute("aria-pressed", String(on));
      }
    };
    const closeField = () => {
      field.value = "";
      field.hidden = true;
      add.hidden = false;
      add.focus();
    };
    const commit = () => {
      const name = field.value.trim().slice(0, RESOURCE_LIMITS.category);
      if ( !name ) return closeField();
      const chips = [...cloud.querySelectorAll("[data-category]")];
      let chip = chips.find(c => c.dataset.category.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
      if ( !chip ) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ch-chip";
        chip.dataset.category = name;
        chip.textContent = name;
        add.before(chip);
      }
      if ( chip.dataset.category !== state.picked ) pick(chip);
      closeField();
    };
    cloud.addEventListener("click", event => {
      const chip = event.target.closest("[data-category]");
      if ( chip ) return pick(chip);
      if ( !event.target.closest("[data-new-category]") ) return;
      add.hidden = true;
      field.hidden = false;
      field.focus();
    });
    field.addEventListener("keydown", event => {
      // Kept inside the field: Enter would submit the dialog and Escape would close it.
      if ( event.key === "Enter" ) {
        event.preventDefault();
        commit();
      } else if ( event.key === "Escape" ) {
        event.preventDefault();
        event.stopPropagation();
        closeField();
      }
    });
    field.addEventListener("blur", () => {
      if ( !field.hidden ) commit();
    });
  }

  /**
   * Only the look and sound change; the verb's placeholder follows.
   * @this {ResourceBook}
   */
  static #onSetAnimation(event, target) {
    const animation = target.dataset.animation;
    if ( !ANIMATIONS.includes(animation) || (animation === this.draft.animation) ) return;
    this.draft.animation = animation;
    this.#markDirty(true);
  }

  /**
   * Open the Tool Sets on the first set this resource uses, or on its animation's.
   * @this {ResourceBook}
   */
  static async #onOpenToolSets() {
    const tab = this.draft.toolSets[0] ?? this.draft.animation;
    const app = foundry.applications.instances.get(ToolSetsConfig.DEFAULT_OPTIONS.id) ?? new ToolSetsConfig();
    await app.render({ force: true, tab });
    app.bringToFront();
  }

  /**
   * Move a resource to its next state in the Field Guide. It is written at once, beside the resource
   * rather than in it: a package's resource would otherwise turn into a GM edit. The setting's
   * onChange re-renders the book, and an unsaved draft survives it.
   * @this {ResourceBook}
   */
  static async #onCycleGuide(event, target) {
    const resource = getResource(target.dataset.resourceId);
    if ( resource ) await setGuideState([resource.id], nextGuideState(guideState(resource)));
  }

  /**
   * Set every resource of a group (a source or a category) to the state after the one its eye shows,
   * in one write.
   * @this {ResourceBook}
   */
  static async #onCycleGuideGroup(event, target) {
    // The eye sits in the group's summary, whose click would also fold the group.
    event.preventDefault();
    const key = target.dataset.group;
    const ids = getAllResources().filter(r => (r.source === key) || (groupKey(r) === key)).map(r => r.id);
    if ( ids.length ) await setGuideState(ids, nextGuideState(target.dataset.state));
  }

  /**
   * Mark the draft's resource found by the party, or forget it: the GM's override of discovery.
   * @this {ResourceBook}
   */
  static async #onToggleFound() {
    const id = this.draft.id;
    if ( getResource(id) ) await setFound(id, !isFound(id));
  }

  /** @this {ResourceBook} */
  static async #onOpenGuide() {
    const app = foundry.applications.instances.get(GUIDE_APP_ID) ?? new FieldGuide();
    await app.render({ force: true });
    app.bringToFront();
  }

  /** @this {ResourceBook} */
  static #onClearTool(event, target) {
    this.draft.tools.splice(Number(target.closest("[data-index]").dataset.index), 1);
    this.#markDirty(true);
  }

  /** @this {ResourceBook} */
  static #onClearDrop(event, target) {
    this.draft.drops.splice(Number(target.closest("[data-index]").dataset.index), 1);
    this.#markDirty(true);
  }

  /**
   * Open the active file picker on a path; it calls back with the one chosen.
   * @param {"image"|"audio"} type
   * @param {string} current
   * @param {(path: string) => void} callback
   */
  #browse(type, current, callback) {
    // Hosts may substitute their own picker; resolve the active implementation first.
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
    new FilePickerClass({ type, current, callback }).render({ force: true });
  }

  /** @this {ResourceBook} */
  static #onBrowseImage() {
    this.#browse("imagevideo", this.draft.img, path => {
      // The picker lists every video; only a webm keeps its transparency in the medallion.
      if ( foundry.helpers.media.VideoHelper.hasVideoExtension(path) && !isWebm(path) ) {
        return ui.notifications.warn(game.i18n.localize("CANVASHARVEST.Errors.OnlyWebm"));
      }
      this.draft.img = path;
      this.#markDirty(true);
    });
  }

  /**
   * The sound sits behind a button: a small dialog to silence it, set how far it carries, choose a
   * file, hear it, or go back to the animation's cue. Closing it without Done changes nothing.
   * @this {ResourceBook}
   */
  static async #onEditSound() {
    const loc = key => game.i18n.localize(key);
    const button = (key, icon, label) => `<button type="button" class="ch-icon-button" data-sound="${key}" aria-label="${label}"
      data-tooltip="${label}"><i class="fa-solid ${icon}" inert></i></button>`;
    const helpIcon = html => `<i class="fa-solid fa-circle-question ch-help" data-tooltip-html="${foundry.utils.escapeHTML(html)}"
      data-tooltip-class="canvas-harvest ch-tooltip ch-theme-${getTheme()}" data-tooltip-direction="UP"></i>`;
    const [min, max] = RESOURCE_LIMITS.soundRadius;
    // A slider has no empty value, so a resource with no reach of its own sits at the world's, dimmed,
    // until it is moved; Reset dims it again.
    const worldReach = game.settings.get(MODULE_ID, SETTING_SOUND_RADIUS);
    const enabled = this.draft.soundEnabled !== false;
    const ownReach = this.draft.soundRadius ?? null;
    // An element, not a string, so DialogV2 keeps the data attributes it would clean out of HTML.
    const content = document.createElement("div");
    content.innerHTML = `<div class="ch-sound-head">
      <fieldset class="ch-field ch-sound-on">
        <legend>${loc("CANVASHARVEST.Book.SoundEnabled")}</legend>
        <input type="checkbox" class="ch-toggle" name="soundEnabled" aria-label="${loc("CANVASHARVEST.Book.SoundEnabled")}">
      </fieldset>
      <fieldset class="ch-field ch-sound-radius">
        <legend>${loc("CANVASHARVEST.Book.SoundRadius")}</legend>
        <input type="range" name="soundRadius" min="${min}" max="${max}" step="1">
        <output></output>
        <span class="ch-unit">${loc("CANVASHARVEST.Sounds.Spaces")}</span>
        ${button("reach", "fa-rotate-left", loc("CANVASHARVEST.Book.ResetReach"))}
        ${helpIcon(help("CANVASHARVEST.Book.SoundRadius", "CANVASHARVEST.Book.SoundRadiusHint"))}
      </fieldset>
    </div>
    <fieldset class="ch-field ch-sound">
      <legend>${loc("CANVASHARVEST.Book.SoundFile")}</legend>
      <input type="text" name="sound" placeholder="${loc("CANVASHARVEST.Book.SoundDefault")}">
      ${button("browse", "fa-file-audio", loc("CANVASHARVEST.Book.Browse"))}
      ${button("preview", "fa-play", loc("CANVASHARVEST.Book.Preview"))}
      ${button("reset", "fa-rotate-left", loc("CANVASHARVEST.Book.ResetSound"))}
      ${helpIcon(help("CANVASHARVEST.Resource.Sound", "CANVASHARVEST.Book.SoundHint"))}
    </fieldset>`;
    // Attributes, since the dialog copies the content's markup, not its live state.
    content.querySelector('input[name="sound"]').setAttribute("value", this.draft.sound);
    content.querySelector('input[name="soundRadius"]').setAttribute("value", ownReach ?? worldReach);
    content.querySelector("output").textContent = ownReach ?? worldReach;
    content.querySelector(".ch-sound-radius").classList.toggle("ch-unset", ownReach === null);
    if ( enabled ) content.querySelector('input[name="soundEnabled"]').setAttribute("checked", "");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "CANVASHARVEST.Resource.Sound" },
      classes: [MODULE_ID, "ch-app", "ch-dialog", "ch-sound-dialog", `ch-theme-${getTheme()}`],
      position: { width: 480 },
      content,
      buttons: [{ action: "done", label: "CANVASHARVEST.Book.Done", class: "ch-button", default: true,
        callback: (event, target) => {
          const form = target.form;
          const unset = form.querySelector(".ch-sound-radius").classList.contains("ch-unset");
          return { sound: form.elements.sound.value.trim(), soundEnabled: form.elements.soundEnabled.checked,
            soundRadius: unset ? null : Number(form.elements.soundRadius.value) };
        } }],
      render: (event, dialog) => {
        const el = dialog.element;
        const input = el.querySelector('input[name="sound"]');
        const toggle = el.querySelector('input[name="soundEnabled"]');
        const radius = el.querySelector(".ch-sound-radius");
        const slider = radius.querySelector("input");
        const showReach = (value, unset) => {
          slider.value = value;
          radius.querySelector("output").textContent = value;
          radius.classList.toggle("ch-unset", unset);
        };
        // Silenced, the reach and the file have nothing to act on.
        const lock = () => {
          for ( const c of el.querySelectorAll(".ch-sound-radius :is(input, button), .ch-sound :is(input, button)") ) c.disabled = !toggle.checked;
        };
        const on = (key, fn) => el.querySelector(`[data-sound="${key}"]`)?.addEventListener("click", fn);
        toggle.addEventListener("change", lock);
        slider.addEventListener("input", () => showReach(slider.value, false));
        on("reach", () => showReach(worldReach, true));
        on("browse", () => this.#browse("audio", input.value.trim(), path => input.value = path));
        on("preview", () => playCue(this.draft.animation, input.value.trim()));
        on("reset", () => input.value = "");
        lock();
      }
    });
    if ( !result ) return;
    const draft = this.draft;
    if ( (result.sound === draft.sound) && (result.soundEnabled === enabled) && (result.soundRadius === ownReach) ) return;
    Object.assign(draft, result);
    this.#markDirty(true);
  }
}
