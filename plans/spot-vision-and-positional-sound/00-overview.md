# Spots are seen and heard only where the viewer's tokens could see and hear them

A Harvest Spot's medallion, its strike effects and its sounds follow token vision, walls and v14's
native Levels: a player sees a medallion only when a token of theirs stands in the spot **and**
sees the medallion; a strike is heard only by tokens within earshot, cut by walls and by
floors between Levels; the GM follows the same tests while controlling a token with vision. Each resource can
silence its sounds or change how far they carry.

Confirmed against Foundry **v14 build 369** (core source at `fvtt14/client` and `fvtt14/common`),
2026-10-12.

## Phases

| # | File | Commit |
|---|---|---|
| 1 | [DONE_01-medallion-vision.md](DONE_01-medallion-vision.md) | Hide spot medallions where the viewer's tokens cannot see |
| 2 | [DONE_02-positional-sound.md](DONE_02-positional-sound.md) | Play harvest sounds from the spot, within earshot and cut by walls and levels |
| 3 | [DONE_03-per-resource-sound.md](DONE_03-per-resource-sound.md) | Let a resource silence its sounds or set how far they carry |

Phase 2 needs phase 1 only for the README paragraph they share; phase 3 needs phase 2's radius
setting.

## Why, and what was weighed

**Measured on 2026-10-12, by reading the code (not yet reproduced in a client):**

- `HarvestControl#refreshState` (`scripts/harvest-control.js`) shows a player the medallion when
  `onLevel && inside && resource && !disabled && !region.hidden`. `inside` is a *position* test
  (`TokenDocument#regions`, which core already makes level- and elevation-aware through
  `TokenDocument#testInsideRegion` → `region.includedInLevel(token level)`). Nothing tests *sight*.
  The medallion lives in `canvas.controls`, above the fog, so nothing hides it either. A player
  therefore sees it with the medallion's centre behind a wall, in darkness without darkvision,
  or with a blinded token.
- The GM sees every medallion on the viewed level, always, even while controlling a token with
  vision.
- `canSee` in `scripts/animation.js` (2 call sites: `playStrike`, `playRefill`) already tests
  vision for players, with `tolerance: 0`, no elevation, and a hard `isGM → true`.
- `playCue` is called 2× from the `updateRegionBehavior` hook in `registerHarvestControls`
  (strike, and depleted 500 ms later) and plays through `AudioHelper.play` on **every client on
  the scene**, at full volume, wherever the spot is, through walls and floors. It is not played
  when the region is off the viewed level. (`grep -rn "playCue" scripts`: those 2, plus 1 preview
  in `scripts/apps/resource-book.js`.)
- The `sound` field of a resource is read in 6 places (`grep -rn "\.sound\b\|sound:" scripts`):
  `blankResource`, `toStored` and the package normaliser in `scripts/resources.js`, the strike in
  `harvest-control.js`, and the book's tip and sound dialog in `resource-book.js`.

**Core facts this plan rests on** (read in build 369):

- `CanvasVisibility#testVisibility(points, {tolerance, object})` takes `ElevatedPoint`s. Without
  an elevation it uses `canvas.level.elevation.base` (`_createVisibilityTestConfig`). With no
  active vision source it returns `game.user.isGM`. `tokenVision` is only `canvas.scene.tokenVision`.
  Together these give the GM rule for free: a GM with no sighted token selected sees everything,
  a GM with one sees what it sees.
- `DoorControl#isVisible` is the core precedent for a control in `canvas.controls` that follows
  vision: it is re-evaluated in `CanvasVisibility#refresh`, which then calls `Hooks.callAll("sightRefresh")`.
- Changing the viewed Level redraws the whole canvas (`Canvas#draw` sets `#level`), so
  `canvasReady` already rebuilds the medallions after a level change.
- `SoundsLayer#playAtPosition(src, origin, radius, options)` builds a temporary
  `PointSoundSource` in memory (no document, nothing on the map), takes the volume from the
  nearest listener of `getListenerPositions()`, and plays once on `game.audio.environment`.
  Radius is in scene distance units. With `walls: true`, `_configurePlayback` treats the sound as
  "Blocked by walls and surfaces"; `PointSoundSource#getVolumeMultiplier` also fades it with the
  vertical distance. A surface is a Region with a `defineSurface` behavior (`Scene#getSurfaces`);
  a Level has none of its own (found in phase 1). `gmAlways` (default true) makes a GM hear it at full volume from the origin.
- `RegionDocument` prepares `elevation.bottom ??= -Infinity` (and top to `+Infinity`).
  `canvas.grid.distance` is `BaseGrid#distance`.

**Decisions, and what lost:**

- *Test the medallion's centre, not the region.* The medallion is drawn at the centre of the
  region's bounds; testing that point means what is tested is what is shown. A spot whose centre
  sits behind a wall stays hidden even with a token inside — the maintainer chose this: if you
  cannot see the button you cannot use it, and making a sensible spot is the map maker's job.
  **Lost:** sampling several points of the region (shows a button the token cannot see), and moving
  the medallion to a visible point (a medallion that wanders per viewer).
- *Hide, don't ghost, for the GM with a sighted token.* Core hides tokens and doors the controlled
  token cannot see; the GM deselects to see everything again. **Lost:** the GM previewing exactly
  the player's view (only spots a token stands in) — it takes away refills and warnings for no gain.
- *Positional sound, blocked by walls and surfaces* (`walls: true`). The maintainer asked for walls
  to block. **Lost:** `walls: false` with a lowpass `muffledEffect`, which lets a strike be heard
  muffled through a wall — softer, but it is not "blocked"; and simply silencing players who cannot
  see the spot, which mutes a strike heard round a corner.
- *Radius in grid spaces*, default 12, converted per scene with `canvas.grid.distance`. A default in
  feet or metres means a different thing in every scene. **Lost:** distance units (core's own unit).
- *A resource's toggle silences everything it plays*: strike and depleted cues.
- *Floors between Levels are core's: a Define Surface region the map maker draws.* Without one,
  sight and sound pass between Levels for tokens too, and a medallion or a strike follows the same
  rule. The Level test is core's `region.viewed`. The maintainer chose this after phase 1, on
  2026-10-12. **Lost:** a module rule hiding a spot whose elevation range does not reach the viewed
  Level (a special case core does not make for its tokens); and drawing the medallion as a Tile, as
  Canvas Loot draws its items. Core tests a Tile against vision no more than a control (Canvas Loot
  needed the same overlay, the same `testVisibility` and a `sightRefresh` hook, plus hiding core's
  mesh), and a Tile has no `attachment`, no elevation range and no "token inside" test.

## Collisions

`ls plans/` on 2026-10-12: this is the only open plan, and none was ever closed
(`git log --diff-filter=D -- plans/` is empty). Nothing to order. Canvas Loot's own vision fix
(its commit `ec1050c`) is the model for phase 1 but nothing in that repo is touched.
