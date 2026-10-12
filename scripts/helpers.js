/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_THEME } from "./constants.js";

/**
 * A plain, storable description of an Item: a resource's tools and drops, and a Tool Set's items.
 * @typedef {object} ItemRef
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {string} type
 * @property {string[]} sources   uuids this item is known by: itself and where it was copied from
 */

/**
 * Describe an Item (or a compendium index entry) as an ItemRef.
 * @param {Item|object} item
 * @returns {ItemRef}
 */
export function toItemRef(item) {
  // A copy keeps where it came from in _stats: compendiumSource for a compendium import, duplicateSource
  // for a clone of a world item. Matching on these lets "the pickaxe on my sheet" count as the pickaxe
  // the resource lists, even after a rename.
  const stats = item._stats ?? {};
  const sources = [item.uuid, stats.compendiumSource, stats.duplicateSource].filter(s => typeof s === "string" && s);
  return { uuid: item.uuid, name: item.name, img: item.img, type: item.type, sources: [...new Set(sources)] };
}

/**
 * A stored ItemRef with the item's current name and image. The ref keeps what the item looked like
 * when it was dropped in, so a rename in the directory would never show; the stored copy is only the
 * fallback for an item that is gone. A compendium entry answers from its index, loading nothing.
 * @param {ItemRef} ref
 * @returns {ItemRef}
 */
export function liveRef(ref) {
  const item = foundry.utils.fromUuidSync(ref.uuid, { strict: false });
  return item ? { ...ref, name: item.name, img: item.img } : ref;
}

/**
 * Is a carried item the one a list asks for, such as a resource's tool? By shared source first, by name
 * and type otherwise, so tools still count in worlds where items were created by hand instead of copied.
 * @param {ItemRef} wanted
 * @param {ItemRef} candidate
 * @returns {boolean}
 */
export function refMatches(wanted, candidate) {
  if ( !wanted || !candidate ) return false;
  if ( wanted.sources.some(s => candidate.sources.includes(s)) ) return true;
  return (wanted.type === candidate.type)
    && (wanted.name.trim().toLowerCase() === candidate.name.trim().toLowerCase());
}

/**
 * Whether a resource's image is a webm video. Webm is the one video a resource takes: it keeps its
 * transparency inside the medallion's circle, where an mp4 would show its background.
 * @param {string} src
 * @returns {boolean}
 */
export function isWebm(src) {
  return /\.webm(\?.*)?$/i.test(src ?? "");
}

/** @returns {string} the active visual theme id */
export function getTheme() {
  return game.settings.get(MODULE_ID, SETTING_THEME);
}

/** @returns {string} the class that applies the active theme's tokens; every app toggles it in _onRender */
export function themeClass() {
  return `ch-theme-${getTheme()}`;
}

/**
 * One help tooltip's HTML: a term and its explanation.
 * @param {string} term   a localization key
 * @param {string} hint   a localization key
 * @returns {string}
 */
export function help(term, hint) {
  return `<p><strong>${game.i18n.localize(term)}</strong><br>${game.i18n.localize(hint)}</p>`;
}

/**
 * One window per id. Core's settings menu builds a new instance on every click, and a second instance
 * with the id of an open one takes its place on screen, leaving the first alive off screen with its
 * unsaved edits. A new instance hands the render to the one already open instead.
 * @param {typeof foundry.applications.api.ApplicationV2} Base
 * @returns {typeof foundry.applications.api.ApplicationV2}
 */
export function SingleWindow(Base) {
  return class extends Base {
    /** @override */
    render(options, _options) {
      const open = foundry.applications.instances.get(this.id);
      if ( !open || (open === this) ) return super.render(options, _options);
      open.bringToFront();
      return open.render(options, _options);
    }
  };
}

/**
 * A yes/no question in the module's themed chrome rather than Foundry's default dialog.
 * @param {object} options
 * @param {string} options.title    Window title, a localization key
 * @param {string} options.content  HTML body
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, content }) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    classes: [MODULE_ID, "ch-app", "ch-dialog", themeClass()],
    content,
    yes: { label: "CANVASHARVEST.Dialog.Yes", class: "ch-button" },
    no: { label: "CANVASHARVEST.Dialog.No", class: "ch-button" }
  });
}

/**
 * The item a slot keeps for a dropped one. Tools and drops are looked up long after the window closes,
 * so they must outlive any one actor: an item from a sheet is replaced by the world or compendium
 * item it came from.
 * @param {Item} item
 * @returns {Promise<Item|null>}   null, after a warning, when the item exists only on a sheet
 */
async function sourceItem(item) {
  const onSheet = i => i.parent?.documentName === "Actor";
  if ( !onSheet(item) ) return item;
  const stats = item._stats ?? {};
  const source = await fromUuid(stats.compendiumSource ?? stats.duplicateSource ?? "");
  if ( source && !onSheet(source) ) return source;
  ui.notifications.warn(game.i18n.localize("CANVASHARVEST.Errors.FromActor", { name: foundry.utils.escapeHTML(item.name) }));
  return null;
}

/**
 * What an item dropped on one of the windows' slots becomes: the ItemRef of the item it stands for.
 * The Resource Book and the Tool Sets both take items this way.
 * @param {DragEvent} event
 * @returns {Promise<ItemRef|null>}   null for anything but an item a slot can keep
 */
export async function droppedItemRef(event) {
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  if ( data?.type !== "Item" ) return null;
  let item;
  try {
    item = await Item.implementation.fromDropData(data);
  } catch {
    return null;
  }
  const source = await sourceItem(item);
  return source ? toItemRef(source) : null;
}

/**
 * What the GM calls where a resource or a Tool Set item comes from: the world, or the title of the
 * package that registered it.
 * @param {string} source   "world" or a package id
 * @returns {string}
 */
export function sourceLabel(source) {
  if ( source === "world" ) return game.i18n.localize("CANVASHARVEST.Book.World");
  return game.modules.get(source)?.title ?? ((game.system.id === source) ? game.system.title : source);
}

/**
 * Text folded for search: lower case, accents dropped, so "veio" finds "Véio".
 * @param {string} text
 * @returns {string}
 */
export function searchKey(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Wire a list's search box. Typing never re-renders: a re-render under the cursor eats input.
 * Escape clears the search instead of closing the window.
 * @param {HTMLInputElement} input
 * @param {(query: string) => void} onQuery
 */
export function bindSearch(input, onQuery) {
  input.addEventListener("input", () => onQuery(input.value));
  input.addEventListener("keydown", ev => {
    if ( ev.key !== "Escape" ) return;
    ev.preventDefault();
    ev.stopPropagation();
    input.value = "";
    onQuery("");
  });
}

/**
 * Show only the entries that match, and open every group that holds one. With no query, groups go
 * back to the open state the user left them in.
 * @param {HTMLElement} root
 * @param {{query?: string, collapsed: Set<string>}} filter
 */
export function filterGroups(root, { query = "", collapsed }) {
  const key = searchKey(query.trim());
  const entries = [...root.querySelectorAll("li[data-search]")];
  for ( const li of entries ) li.hidden = !!key && !li.dataset.search.includes(key);
  for ( const group of root.querySelectorAll("details.ch-group") ) {
    const count = group.querySelectorAll("li[data-search]:not([hidden])").length;
    group.hidden = !count;
    group.open = !!key || !collapsed.has(group.dataset.group);
    const counter = group.querySelector(":scope > summary .ch-group-count");
    if ( counter ) counter.textContent = String(count);
  }
  // With no entries at all the list shows its own empty text instead.
  const noMatch = root.querySelector(".ch-no-match");
  if ( noMatch ) noMatch.hidden = !entries.length || entries.some(li => !li.hidden);
}

/**
 * The caret of the focused text field, for putting back after a re-render. Core restores which
 * field has focus, but not where in it the user was typing.
 * @param {HTMLElement} root
 * @returns {[number, number]|null}
 */
export function readCaret(root) {
  const field = root.querySelector("input:focus");
  return (typeof field?.selectionStart === "number") ? [field.selectionStart, field.selectionEnd] : null;
}

/**
 * @param {HTMLElement} root
 * @param {[number, number]|null} caret
 */
export function restoreCaret(root, caret) {
  const field = root.querySelector("input:focus");
  if ( caret && field ) field.setSelectionRange(...caret);
}

/**
 * The list groups a user closed. Kept per browser: it is a convenience, and storage may be missing
 * or blocked, in which case every group starts open.
 * @returns {Set<string>}
 */
export function getCollapsed() {
  try {
    const stored = JSON.parse(localStorage.getItem(`${MODULE_ID}.collapsed`));
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} collapsed */
export function setCollapsed(collapsed) {
  try {
    localStorage.setItem(`${MODULE_ID}.collapsed`, JSON.stringify([...collapsed]));
  } catch {
    // Storage is blocked: the state lasts as long as the window.
  }
}

/** The theme tokens as PIXI colours, per theme. Cleared when the theme setting changes. */
const palettes = new Map();

/**
 * The CSS tokens of a theme, read for the canvas, which can't read CSS variables: a detached probe
 * carrying the module and theme classes is styled by base.css, so the stylesheet stays the one
 * source of every colour.
 * @param {string} [theme]
 * @returns {{font: string} & Record<string, foundry.utils.Color>}   colours keyed by token, camel-cased (bg0, trimHi, …)
 */
export function readPalette(theme = getTheme()) {
  let palette = palettes.get(theme);
  if ( palette ) return palette;
  const probe = document.createElement("div");
  probe.className = `${MODULE_ID} ch-theme-${theme}`;
  probe.hidden = true;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  palette = { font: style.getPropertyValue("--ch-font-title").trim() };
  for ( const token of ["bg-0", "bg-1", "bg-2", "metal", "metal-hi", "trim", "trim-hi", "glow", "glow-2", "text", "text-dim", "danger"] ) {
    const key = token.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    palette[key] = foundry.utils.Color.from(style.getPropertyValue(`--ch-${token}`).trim());
  }
  probe.remove();
  palettes.set(theme, palette);
  return palette;
}

/** Forget the cached palettes, after the theme changed. */
export function clearPalettes() {
  palettes.clear();
}
