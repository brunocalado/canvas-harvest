/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

export const MODULE_ID = "canvas-harvest";
export const LOOT_ID = "canvas-loot";
// Module-defined subtypes are namespaced by the module id.
export const SPOT_TYPE = `${MODULE_ID}.spot`;
export const QUERY_HARVEST = `${MODULE_ID}.harvest`;
export const QUERY_DISCOVER = `${MODULE_ID}.discover`;
export const RESOURCE_DRAG_TYPE = `${MODULE_ID}.Resource`;
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;
// Window ids, for the files that re-render a window without importing its class.
export const BOOK_APP_ID = `${MODULE_ID}-book`;
export const TOOL_SETS_APP_ID = `${MODULE_ID}-tool-sets`;
export const GUIDE_APP_ID = `${MODULE_ID}-guide`;
export const SFX_PATH = `modules/${MODULE_ID}/assets/sfx`;

export const SETTING_THEME = "theme";
export const SETTING_RESOURCES = "resources";
export const SETTING_RESOURCE_EDITS = "resourceEdits";
export const SETTING_TOOL_SETS = "toolSets";
export const SETTING_GUIDE_VISIBILITY = "guideVisibility";
export const SETTING_GUIDE_FOUND = "guideFound";
export const SETTING_GUIDE_FIELDS = "guideFields";
export const THEMES = ["wilds", "forge"];
// How a strike looks and sounds — chosen per Resource, independent of what it gives.
export const ANIMATIONS = ["strike", "chop", "gather", "carve"];

// What a Resource may hold. Every number is a whole number; each [min, max] pair bounds a slider.
export const RESOURCE_LIMITS = {
  name: 64,
  // The GM's own group for a resource in the book.
  category: 24,
  verb: 12,
  // A resource's own tools; a Tool Set holds any number.
  tools: 4,
  drops: 5,
  weight: [1, 100],
  count: [1, 20],
  strikes: [1, 30],
  // Tags are set through the API only, never in the book: how many a resource carries, and each one's length.
  tags: 16,
  tag: 64,
  // Grid spaces a harvest sound carries.
  soundRadius: [1, 60]
};
export const ANIMATION_ICONS = { strike: "fa-pickaxe", chop: "fa-axe", gather: "fa-hand-holding-seedling", carve: "fa-knife" };
// Always listed; listed as an unnamed silhouette until the party finds it; never listed.
export const GUIDE_STATES = ["shown", "discover", "hidden"];
export const GUIDE_STATE_ICONS = { shown: "fa-eye", discover: "fa-eye-low-vision", hidden: "fa-eye-slash" };
// What a Field Guide entry may show players; the GM switches each on or off for the whole world.
export const GUIDE_FIELDS = ["tools", "drops", "chances", "strikes"];
export const GUIDE_FIELD_ICONS = { tools: "fa-toolbox", drops: "fa-box-open", chances: "fa-percent", strikes: "fa-burst" };
export const DEFAULT_RESOURCE_IMG = "icons/commodities/stone/ore-chunk-iron-black.webp";

// A strike is three blows; the drops leave the spot when the third lands.
export const STRIKE_MS = 750;
// Items pop out of the spot: they leave it small, rise above a short hop, and come out one after
// another. Canvas Loot plays this arc on every client; its delay tops out at 5 s.
export const HARVEST_FLIGHT = i => ({ startScale: 0.2, apexScale: 1.3, arc: 1, delay: Math.min(i * 0.15, 5) });

export const SETTING_SOUND_VOLUME = "soundVolume";
export const SETTING_SOUND_RADIUS = "soundRadius";
export const SOUND_CUES = { strike: "soundStrike", chop: "soundChop", gather: "soundGather", carve: "soundCarve", depleted: "soundDepleted" };
// Seconds per cycle of each theme's clock: the Wilds breeze, and Grid Crafter's forge bellows.
export const BREEZE_PERIOD = 9;
export const BELLOWS_PERIOD = 7;
