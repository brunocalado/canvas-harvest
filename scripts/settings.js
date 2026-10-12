/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ANIMATIONS, MODULE_ID, RESOURCE_LIMITS, SETTING_RESOURCE_EDITS, SETTING_RESOURCES, SETTING_SOUND_RADIUS, SETTING_SOUND_VOLUME, SETTING_THEME, SETTING_TOOL_SETS, SETTING_TOOL_WHISPER, SOUND_CUES, THEMES } from "./constants.js";
import { ResourceBook } from "./apps/resource-book.js";
import { SoundConfig } from "./apps/sound-config.js";
import { ToolSetsConfig } from "./apps/tool-sets-config.js";
import { redrawSpots } from "./harvest-control.js";
import { clearPalettes } from "./helpers.js";
import { catalogueChanged } from "./resources.js";
import { toolSetsChanged } from "./tool-sets.js";

export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "resourceBook", {
    name: "CANVASHARVEST.Settings.ResourceBook.Name",
    label: "CANVASHARVEST.Settings.ResourceBook.Label",
    hint: "CANVASHARVEST.Settings.ResourceBook.Hint",
    icon: "fa-solid fa-book-open",
    type: ResourceBook,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "toolSets", {
    name: "CANVASHARVEST.Settings.ToolSets.Name",
    label: "CANVASHARVEST.Settings.ToolSets.Label",
    hint: "CANVASHARVEST.Settings.ToolSets.Hint",
    icon: "fa-solid fa-toolbox",
    type: ToolSetsConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "sounds", {
    name: "CANVASHARVEST.Settings.Sounds.Name",
    label: "CANVASHARVEST.Settings.Sounds.Label",
    hint: "CANVASHARVEST.Settings.Sounds.Hint",
    icon: "fa-solid fa-volume-high",
    type: SoundConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTING_THEME, {
    name: "CANVASHARVEST.Settings.Theme.Name",
    hint: "CANVASHARVEST.Settings.Theme.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(THEMES.map(t => [t, `CANVASHARVEST.Theme.${t}`])),
    default: "wilds",
    onChange: () => {
      for ( const app of foundry.applications.instances.values() ) {
        if ( app.options.classes.includes(MODULE_ID) ) app.render();
      }
      clearPalettes();
      redrawSpots();
    }
  });

  // Whether a player who lacks a tool is whispered the full list. Off keeps the tools a secret.
  game.settings.register(MODULE_ID, SETTING_TOOL_WHISPER, {
    name: "CANVASHARVEST.Settings.ToolWhisper.Name",
    hint: "CANVASHARVEST.Settings.ToolWhisper.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // The GM's resources. Registered ones live in memory on each client and are never stored here.
  game.settings.register(MODULE_ID, SETTING_RESOURCES, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: catalogueChanged
  });

  // The GM's version of a package's resource, by its id, tags left out. It replaces the package's
  // version until the GM restores it; edits of a package that is off are kept and never read.
  game.settings.register(MODULE_ID, SETTING_RESOURCE_EDITS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: catalogueChanged
  });

  // The GM's items in each Tool Set, as ItemRefs. Packages' items live in memory on each client.
  game.settings.register(MODULE_ID, SETTING_TOOL_SETS, {
    scope: "world",
    config: false,
    type: Object,
    default: Object.fromEntries(ANIMATIONS.map(set => [set, []])),
    onChange: toolSetsChanged
  });

  // The base loudness of the cues for the whole table. Each user still scales it with their own
  // Environment volume, since the cues play on that channel.
  game.settings.register(MODULE_ID, SETTING_SOUND_VOLUME, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.NumberField({ min: 0, max: 1, step: 0.05, nullable: false, initial: 0.8 }),
    default: 0.8
  });

  // How far the cues carry, in grid spaces: the same number reaches as far in a scene in feet as in
  // one in metres.
  const [minRadius, maxRadius] = RESOURCE_LIMITS.soundRadius;
  game.settings.register(MODULE_ID, SETTING_SOUND_RADIUS, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.NumberField({ integer: true, min: minRadius, max: maxRadius, nullable: false, initial: 12 }),
    default: 12
  });

  // An empty path means the module's own file for the cue.
  for ( const key of Object.values(SOUND_CUES) ) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: String, default: "" });
  }
}
