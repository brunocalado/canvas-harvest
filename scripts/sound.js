/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_SOUND_RADIUS, SETTING_SOUND_VOLUME, SFX_PATH, SOUND_CUES } from "./constants.js";

/**
 * The file a cue plays when the GM has not chosen one.
 * @param {"strike"|"chop"|"gather"|"carve"|"depleted"} cue
 * @returns {string}
 */
export function defaultCueSource(cue) {
  return `${SFX_PATH}/${cue}.ogg`;
}

/**
 * Play a file on this client only, on the Environment channel: a harvest is a sound in the world,
 * so each user's Environment volume scales it.
 * @param {string} src
 * @param {number} volume   base volume, 0 to 1
 */
export function playSound(src, volume) {
  if ( !volume || !src ) return;
  foundry.audio.AudioHelper.play({ src, volume, channel: "environment", autoplay: true }, false);
}

/**
 * Play one of the module's cues at the GM's volume: a resource's own file, else the GM's file for
 * the cue, else the module's.
 * @param {"strike"|"chop"|"gather"|"carve"|"depleted"} cue
 * @param {string} [override]
 */
export function playCue(cue, override = "") {
  const src = override || game.settings.get(MODULE_ID, SOUND_CUES[cue]) || defaultCueSource(cue);
  playSound(src, game.settings.get(MODULE_ID, SETTING_SOUND_VOLUME));
}

/**
 * Play a cue from a point on the map for this client: heard only by this user's listening tokens
 * within reach, blocked by walls and by floors (Define Surface regions). Nothing is created on the
 * map.
 * @param {"strike"|"chop"|"gather"|"carve"|"depleted"} cue
 * @param {ElevatedPoint} origin
 * @param {object} [options]
 * @param {string} [options.override]   the resource's own file
 * @param {number} [options.spaces]     reach in grid spaces; the world's default when omitted
 */
export function playCueAt(cue, origin, { override = "", spaces } = {}) {
  const src = override || game.settings.get(MODULE_ID, SOUND_CUES[cue]) || defaultCueSource(cue);
  const volume = game.settings.get(MODULE_ID, SETTING_SOUND_VOLUME);
  if ( !volume || !src ) return;
  // A GM with no token selected hears every strike, as they see every spot. Not through core's
  // gmAlways: it puts the GM on the origin, and core plays a listener there at volume 1 whatever
  // volume was asked for.
  if ( game.user.isGM && !canvas.tokens.controlled.length ) return playSound(src, volume);
  const radius = (spaces ?? game.settings.get(MODULE_ID, SETTING_SOUND_RADIUS)) * canvas.grid.distance;
  canvas.sounds.playAtPosition(src, origin, radius, { volume, walls: true, gmAlways: false });
}
