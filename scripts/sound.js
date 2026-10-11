/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_SOUND_VOLUME, SFX_PATH, SOUND_CUES } from "./constants.js";

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
