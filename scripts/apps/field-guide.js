/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ANIMATION_ICONS, ANIMATIONS, GUIDE_APP_ID, MODULE_ID, TEMPLATE_PATH, THEMES } from "../constants.js";
import {
  bindSearch, chance, filterGroups, getCollapsed, getTheme, groupLabel, isWebm, liveRef, refMatches, searchKey, setCollapsed,
  SingleWindow
} from "../helpers.js";
import { AmbientFX } from "../ambient-fx.js";
import { carriesTool, guideFields, isKnown, isListed, resourceTools } from "../guide.js";
import { getAllResources, getResource } from "../resources.js";
import { getToolSet } from "../tool-sets.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Where the guide keeps its folded groups, apart from the book's. */
const COLLAPSED_KEY = `${MODULE_ID}.guideCollapsed`;

/**
 * The players' read-only view of the catalogue: the resources they know, what each takes and gives,
 * and what each tool opens. A resource the party has not found yet is listed by its image alone, so
 * nothing about it but its look and its group reaches this window.
 */
export class FieldGuide extends SingleWindow(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: GUIDE_APP_ID,
    classes: [MODULE_ID, "ch-app", "ch-guide"],
    window: {
      title: "CANVASHARVEST.Guide.Title",
      icon: "fa-solid fa-leaf",
      resizable: false
    },
    position: { width: 820, height: "auto" },
    actions: {
      selectResource: FieldGuide.#onSelectResource,
      selectTool: FieldGuide.#onSelectTool
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/guide.hbs`, scrollable: [".ch-list-scroll", ".ch-guide-page"] }
  };

  static TABS = {
    main: {
      tabs: [{ id: "resources", icon: "fa-solid fa-book-open" }, { id: "tools", icon: "fa-solid fa-toolbox" }],
      initial: "resources",
      labelPrefix: "CANVASHARVEST.Guide.Tab"
    }
  };

  /** The selected entry on the Resources tab: undefined until the first render picks one, null for none. */
  resourceId = undefined;

  /** The selected tool on the Tools tab; null picks the first one listed. */
  toolUuid = null;

  /** The actor whose items mark what is carried, as of the last render. */
  actor = null;

  /** The particles behind the detail pane. */
  #fx = new AmbientFX(getTheme());

  /** The lists' search, as typed. */
  #query = "";

  /** Keys of the list groups the user closed. */
  #collapsed = getCollapsed(COLLAPSED_KEY);

  /**
   * Select a resource on the Resources tab and show the window. A resource the guide doesn't list
   * leaves nothing selected, with no warning, so a call can't tell a hidden id from a missing one.
   * @param {string} [id]
   * @returns {Promise<FieldGuide>}
   */
  async showResource(id) {
    if ( id !== undefined ) {
      const resource = getResource(id);
      this.resourceId = (resource && isListed(resource)) ? id : null;
      this.#query = "";
      if ( resource && this.#collapsed.delete(this.#groupKey(resource)) ) setCollapsed(this.#collapsed, COLLAPSED_KEY);
    }
    return this.render({ force: true, tab: "resources" });
  }

  /**
   * @param {Resource} r
   * @returns {string} the key of its group in the Resources list
   */
  #groupKey(r) {
    return `resources::${groupLabel(r).toLocaleLowerCase()}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const theme = getTheme();
    const fields = guideFields();
    const listed = getAllResources().filter(isListed);
    const known = new Set(listed.filter(isKnown).map(r => r.id));
    // The first controlled token's actor, else the user's own character.
    this.actor = (canvas.ready ? canvas.tokens.controlled[0]?.actor : null) ?? game.user.character ?? null;
    const actor = this.actor;
    const carries = tools => !!actor && !!tools.length && carriesTool(actor, tools);
    const loc = (key, data) => game.i18n.localize(`CANVASHARVEST.Guide.${key}`, data);
    const tip = (name, carried) => carried ? `${name} · ${loc("Carried")}` : name;
    const slot = ref => {
      const live = liveRef(ref);
      const carried = carries([ref]);
      return { uuid: ref.uuid, name: live.name, img: live.img, carried, tip: tip(live.name, carried) };
    };

    if ( this.resourceId === undefined ) this.resourceId = (listed.find(r => known.has(r.id)) ?? listed[0])?.id ?? null;
    // Hidden since it was picked: nothing is selected.
    const selected = listed.find(r => r.id === this.resourceId) ?? null;

    // Resources, in groups by label. An unknown entry carries its image and id only.
    const toEntry = r => {
      const isKnownEntry = known.has(r.id);
      const entry = { id: r.id, img: r.img, video: isWebm(r.img), known: isKnownEntry, active: r.id === selected?.id, search: "" };
      if ( !isKnownEntry ) return entry;
      const tools = resourceTools(r);
      const words = [r.name, r.verb, groupLabel(r)];
      if ( fields.tools ) words.push(...tools.map(t => liveRef(t).name));
      if ( fields.drops ) words.push(...r.drops.map(d => liveRef(d.item).name));
      return { ...entry, name: r.name, search: searchKey(words.join(" ")), carried: fields.tools && carries(tools) };
    };
    const groups = Object.entries(Object.groupBy(listed, r => this.#groupKey(r)))
      .map(([key, members]) => ({ key, label: groupLabel(members[0]), count: members.length,
        collapsed: this.#collapsed.has(key), entries: members.map(toEntry) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Tools: each set some listed resource switches on, in the sets' order, then the own tools that sit
    // in no set.
    const setItems = Object.fromEntries(ANIMATIONS.map(set => [set, getToolSet(set)]));
    const usedSets = new Set(listed.flatMap(r => r.toolSets));
    const sameTool = (a, b) => (a.uuid === b.uuid) || refMatches(a, b);
    const special = [];
    for ( const tool of listed.flatMap(r => r.tools) ) {
      if ( ![...Object.values(setItems).flat(), ...special].some(t => sameTool(t, tool)) ) special.push(tool);
    }
    const toolEntry = (ref, groupKey) => {
      const live = liveRef(ref);
      return { uuid: ref.uuid, name: live.name, img: live.img, carried: carries([ref]), search: searchKey(live.name), groupKey };
    };
    const toolGroups = fields.tools ? [
      ...ANIMATIONS.filter(set => usedSets.has(set) && setItems[set].length).map(set => ({
        key: `tools::${set}`, label: game.i18n.localize(`CANVASHARVEST.Verb.${set}`), icon: ANIMATION_ICONS[set], refs: setItems[set]
      })),
      ...(special.length ? [{ key: "tools::special", label: loc("Special"), icon: "fa-wrench", refs: special }] : [])
    ].map(({ refs, ...group }) => ({ ...group, count: refs.length, collapsed: this.#collapsed.has(group.key),
      entries: refs.map(ref => toolEntry(ref, group.key)) })) : [];
    const allTools = toolGroups.flatMap(g => g.entries);
    const shown = [...Object.values(setItems).flat(), ...special].filter(t => allTools.some(e => e.uuid === t.uuid));
    // A resource's own tool that matches a set's item is listed as that item.
    const clicked = [...shown, ...listed.flatMap(r => r.tools)].find(t => t.uuid === this.toolUuid);
    const toolRef = (clicked && shown.find(t => sameTool(t, clicked))) ?? shown[0] ?? null;
    for ( const entry of allTools ) entry.active = entry.uuid === toolRef?.uuid;

    if ( !fields.tools ) this.tabGroups.main = "resources";
    const tabs = fields.tools ? context.tabs : { resources: context.tabs.resources };
    return {
      theme,
      tabs,
      query: this.#query,
      fields,
      found: loc("Found", { known: known.size, listed: listed.length }),
      groups,
      resource: selected ? this.#resourceDetail(selected, known.has(selected.id), { fields, actor, carries, slot, loc }) : null,
      toolGroups,
      tool: toolRef ? this.#toolDetail(toolRef, { listed, known, setItems, sameTool, carries, loc }) : null,
      bareHands: fields.tools ? this.#bareHands(listed, known, loc) : ""
    };
  }

  /**
   * The detail pane of one resource: all of it for a known one, its image and group for another.
   * @param {Resource} r
   * @param {boolean} known
   * @param {object} helpers
   * @returns {object}
   */
  #resourceDetail(r, known, { fields, actor, carries, slot, loc }) {
    const base = { img: r.img, video: isWebm(r.img), known, category: groupLabel(r) };
    if ( !known ) return base;
    const detail = {
      ...base,
      name: r.name,
      verb: r.verb || game.i18n.localize(`CANVASHARVEST.Verb.${r.animation}`),
      icon: ANIMATION_ICONS[r.animation],
      strikes: fields.strikes ? loc("Strikes", { count: r.strikes }) : "",
      withheld: !fields.tools && !fields.drops
    };
    if ( fields.tools ) {
      // A set left empty is ignored by the harvest, so it is left out here too.
      const sets = r.toolSets.filter(set => getToolSet(set).length);
      detail.toolRows = [
        ...sets.map(set => ({ label: loc("AnyTool", { verb: game.i18n.localize(`CANVASHARVEST.Verb.${set}`) }),
          icon: ANIMATION_ICONS[set], tools: getToolSet(set).map(slot) })),
        ...(r.tools.length ? [{ label: loc("OwnTools"), tools: r.tools.map(slot) }] : [])
      ];
      const tools = resourceTools(r);
      if ( actor && tools.length ) detail.carryNote = { carried: carries(tools), text: loc(carries(tools) ? "CarriesOne" : "CarriesNone") };
    }
    if ( fields.drops ) {
      const total = r.drops.reduce((sum, d) => sum + d.weight, 0);
      detail.drops = r.drops.map(d => {
        const live = liveRef(d.item);
        return { name: live.name, img: live.img, amount: (d.min === d.max) ? `×${d.min}` : `×${d.min}–${d.max}`,
          share: chance(d.weight, total), percent: Math.max(Math.round((d.weight / total) * 100), 1) };
      });
    }
    return detail;
  }

  /**
   * The detail pane of one tool: the sets it sits in, and the listed resources it opens.
   * @param {ItemRef} ref
   * @param {object} helpers
   * @returns {object}
   */
  #toolDetail(ref, { listed, known, setItems, sameTool, carries, loc }) {
    const live = liveRef(ref);
    const opens = listed.filter(r => resourceTools(r).some(t => sameTool(t, ref)));
    return {
      name: live.name,
      img: live.img,
      carried: carries([ref]),
      sets: ANIMATIONS.filter(set => setItems[set].some(t => sameTool(t, ref)))
        .map(set => ({ icon: ANIMATION_ICONS[set], label: game.i18n.localize(`CANVASHARVEST.Verb.${set}`) })),
      opens: opens.map(r => (known.has(r.id)
        ? { known: true, id: r.id, name: r.name, img: r.img, video: isWebm(r.img) }
        : { known: false, img: r.img, video: isWebm(r.img) })),
      hasUnknown: opens.some(r => !known.has(r.id)),
      unknownHint: loc("OpensUnknown")
    };
  }

  /**
   * What needs no tool at all, in a line: the known ones by name, the others counted.
   * @param {Resource[]} listed
   * @param {Set<string>} known
   * @param {Function} loc
   * @returns {string}
   */
  #bareHands(listed, known, loc) {
    const bare = listed.filter(r => !resourceTools(r).length);
    const names = bare.filter(r => known.has(r.id)).map(r => r.name);
    const unknown = bare.length - names.length;
    if ( unknown ) names.push(loc("UnknownCount", { count: unknown }));
    return names.length ? game.i18n.getListFormatter().format(names) : "";
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
    this.#bindLists();
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#fx.stop();
  }

  /** Wire the search and the folding groups of both lists, and reapply the search a re-render would drop. */
  #bindLists() {
    const lists = [...this.element.querySelectorAll(".ch-guide-list .ch-list-scroll")];
    const apply = () => {
      for ( const list of lists ) filterGroups(list, { query: this.#query, collapsed: this.#collapsed });
    };
    bindSearch(this.element.querySelector(".ch-guide-list input[name=search]"), query => {
      this.#query = query;
      apply();
    });
    for ( const group of this.element.querySelectorAll(".ch-guide-list details.ch-group") ) {
      group.addEventListener("toggle", () => {
        // While searching, groups are opened by the filter, not by the user.
        if ( this.#query.trim() ) return;
        if ( group.open ) this.#collapsed.delete(group.dataset.group);
        else this.#collapsed.add(group.dataset.group);
        setCollapsed(this.#collapsed, COLLAPSED_KEY);
      });
    }
    apply();
  }

  /**
   * Pick a resource, from the list or from a card on the Tools tab.
   * @this {FieldGuide}
   */
  static #onSelectResource(event, target) {
    this.resourceId = target.dataset.resourceId;
    this.render({ tab: "resources" });
  }

  /**
   * Open a tool on the Tools tab, from the list or from a resource's "Worked with".
   * @this {FieldGuide}
   */
  static #onSelectTool(event, target) {
    this.toolUuid = target.dataset.uuid;
    this.render({ tab: "tools" });
  }
}
