# Phase 2 — Harvest sounds come from the spot, within earshot, cut by walls and Levels

## Start here

- Open `scripts/sound.js`, `scripts/harvest-control.js` (the `updateRegionBehavior` hook in
  `registerHarvestControls`), `scripts/settings.js`, `scripts/constants.js`,
  `scripts/apps/sound-config.js`, `templates/sound-config.hbs`, `styles/sound-config.css`,
  `lang/en.json` (`CANVASHARVEST.Sounds`), `README.md` (the Harvest Sounds paragraph).
- Phase 1 is renamed `DONE_01-medallion-vision.md`; read its Departures: a floor between Levels
  is a Define Surface region, never the Level itself, and the live suite needs `CHROME_PATH` and
  removes a floor before moving a token back through it.
- Who listens, read in build 369 after phase 1: with token vision on,
  `SoundsLayer#getListenerPositions` takes only the active vision sources, and
  `Token#_isVisionSource` keeps those to tokens on the viewed Level. A player with no sighted token
  on the viewed Level hears nothing, lit scene or not; a blinded token still listens.
- APIs confirmed on v14 build 369 (`SoundsLayer#playAtPosition`, `Sound#playAtPosition`,
  `SoundsLayer#getListenerPositions`, `_configurePlayback`); re-read them if the build moved.
- `git status` clean before the first edit.

## The shape

A world setting, beside the volume:

```js
// constants.js
export const SETTING_SOUND_RADIUS = "soundRadius";
// RESOURCE_LIMITS gains — grid spaces a harvest sound carries; phase 3 reuses it per resource.
soundRadius: [1, 60],

// settings.js — in grid spaces, so the same number means the same reach in a scene in feet or in metres.
game.settings.register(MODULE_ID, SETTING_SOUND_RADIUS, {
  scope: "world", config: false,
  type: new foundry.data.fields.NumberField({ integer: true, min: 1, max: 60, nullable: false, initial: 12 }),
  default: 12
});
```

`sound.js` gains a positional player; `playCue` (used by the book's preview) stays as it is:

```js
/**
 * Play a cue from a point on the map for this client: heard only by this user's listening
 * tokens within reach, blocked by walls and by floors (Define Surface regions). Nothing is
 * created on the map.
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
  const radius = (spaces ?? game.settings.get(MODULE_ID, SETTING_SOUND_RADIUS)) * canvas.grid.distance;
  // A GM with no token selected hears every strike in full, as they see every spot.
  canvas.sounds.playAtPosition(src, origin, radius, { volume, walls: true, gmAlways: !canvas.tokens.controlled.length });
}
```

The hook: the sound no longer waits on `viewed` (`control.region.viewed`, the Level test phase 1
moved to) — whoever is within earshot hears it, and core decides across levels. The visual effect
still needs the region on the viewed level.

```js
if ( !resource ) return;
if ( effect?.strike ) {
  const token = foundry.utils.fromUuidSync(effect.strike, { strict: false }) ?? null; // TokenDocument
  // The striker's elevation: the sound starts on the floor they stand on, whatever level this
  // client views.
  const origin = { x: control.x, y: control.y, elevation: token?.elevation ?? canvas.level.elevation.base };
  playCueAt(resource.animation, origin, { override: resource.sound });
  if ( effect.depleted ) setTimeout(() => playCueAt("depleted", origin), 500);
}
if ( !viewed ) return;
// …playStrike / playRefill as before, with token = tokenDoc?.object ?? null
```

The Harvest Sounds window gets one field under the volume, styled as the volume's
(`ch-field`, legend in the border, `?` help) — read `canvas-harvest-visual-identity` first:

```hbs
<fieldset class="ch-field ch-radius">
  <legend>{{localize "CANVASHARVEST.Sounds.Radius"}}</legend>
  <input type="number" name="radius" min="1" max="60" step="1" value="{{radius}}">
  <span class="ch-unit">{{localize "CANVASHARVEST.Sounds.Spaces"}}</span>
</fieldset>
```

`_prepareContext` adds `radius`; `#onSubmit` saves `Math.clamp(Math.round(Number(data.radius)) || 12, 1, 60)`.
New `lang/en.json` keys: `CANVASHARVEST.Sounds.Radius` ("Reach"), `CANVASHARVEST.Sounds.Spaces`
("grid spaces"), `CANVASHARVEST.Sounds.RadiusHint` ("How far a harvest is heard, in grid spaces. Walls and floors block it.").

**Stored data:** one new world setting with a default; worlds that never had it read 12. No
migration — and the module is in alpha.

## Invariants

Observed in a `claude-*` world, GM and player clients, through `foundry-playwright`. Headless
audio is not heard; observe by wrapping `canvas.sounds.playAtPosition` on the client and by
reading the resolved `Sound` (`playAtPosition` returns `null` when the volume is 0).

| Must hold | Falsified by |
|---|---|
| Player's token 3 spaces from a spot, no wall: the strike plays on the player client with volume > 0 | returned `Sound` is `null` |
| Player's token 20 spaces away (default 12): nothing plays | a `Sound` is returned |
| A wall (sound restriction on) between the player's token and the spot: nothing plays | a `Sound` is returned |
| Striker on Level A, player's token right above on Level B with a Define Surface floor (sound on) between: nothing plays | a `Sound` is returned — **verify first**; if core lets it through, record it as a departure and ask the maintainer |
| The same Levels with no Define Surface floor: nothing blocks, and the height counts toward the reach | a `Sound` for a listener beyond the radius once the height is counted, or `null` for one within it — **verify first**: this is core's rule, as phase 1 follows for sight |
| Striker and listener on the same level, same floor elevation, a Define Surface floor at that elevation: audible (the origin is not swallowed by its own floor) | `null` — **verify first**. Phase 1 read `Scene#testSurfaceCollision`: equal elevations return no collision at once, and a surface at the lower point's own elevation is skipped |
| GM with nothing selected hears every strike at full volume; GM with a token selected hears as that token | GM readings disagree |
| Radius saved in Harvest Sounds changes the reach on the next strike, on every client | old reach still applies |
| A depleting strike plays the depleted cue from the same spot, 500 ms later | not played, or played without position |
| The book's and the Harvest Sounds window's preview still play directly | preview silent or positional |
| No console error; existing `tests/live` cases pass | `node tests/live/run.js` |
| Whether 12 spaces sounds right at the table | the maintainer's call |

## The commits

1. `Play harvest sounds from the spot, within earshot and cut by walls and levels` — body: every
   client used to hear every strike at full volume wherever it was; the cues now play through
   core's positional sound from the medallion at the striker's elevation, blocked by walls and
   by floors between Levels, with a reach in grid spaces set in Harvest Sounds (12 by default). Includes the
   README Harvest Sounds paragraph, a CHANGELOG `# Unreleased` entry, and the rename to `DONE_02-…`.

## What this deliberately does not do

- No muffled-through-walls mode (`walls: false` + `muffledEffect`): the maintainer chose blocking.
- No `emitAtPosition`: every client already runs the hook, so each plays its own copy.
- No per-resource reach or toggle: phase 3.
- No change to the spot hooks' docs (`docs/API.md` "a listener can play a sound for everyone"
  is about the listener's own sound, not ours).

## Departures

(empty until the phase lands)
