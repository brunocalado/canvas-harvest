# Phase 1 — Medallions and strike effects follow token vision, walls and Levels

## Departures

Landed on v14 build 369, the build the plan was stamped on. The code is the shape block as
written. Where the premises were wrong or incomplete, observed in `claude-canvas-harvest` on
2026-10-12:

- **A Level has no floor of its own.** `Scene#getSurfaces` (`#updateSurfaces`) builds surfaces only
  from Regions that carry a `defineSurface` behavior. The overview's "level surfaces between them
  block sight" holds only where the map has a Define Surface region. The raised-floor invariant was
  checked with one (a flat region at the upper Level's bottom, `placement: "bottom"`). Measured from
  a token on the upper Level (eye at elevation 22): `testVisibility` at elevations 0 and 10 below
  was `true` with no floor and `false` with the floor; at 20 it was `true` either way. A spot that
  reaches both Levels but sits under the floor (`elevation.top` 10) is hidden from the GM's token
  above with the floor and shown when the floor's behavior is disabled. That is core's own sight,
  and the maintainer chose to keep it (see the overview's decisions). A spot on the lower Level only never shows from the upper one,
  floor or not, because `includedInLevel` fails first.
- **A surface at the tested point's own elevation does not block it.** `Scene#testSurfaceCollision`
  skips surfaces with `elevation <= lower.elevation`. Observed: a player's token on the upper floor,
  standing in a spot that reaches through it, sees the medallion with the floor surface in place.
  Phase 2's "origin not swallowed by its own floor" premise rests on the same line.
- **Only tokens on the viewed Level see.** `Token#_isVisionSource` returns false when
  `document.level !== canvas.level.id`, and the redraw on a view change releases tokens on other
  Levels. A player who switches the view to Level B therefore has no vision source and no token in
  the spot. The medallion is hidden by all three tests, not only by the Level test.
- **Unlit scenes hide every player medallion.** With global light off and `sight.range: 0`
  (crucible's default token, and the `tests/live` fixture scene), players no longer see any
  medallion. That is the intended rule, but every world with unlit scenes and tokens without
  darkvision changes on update.
- **Test fixtures.** `TokenDocument` constrains an update's movement by walls and surfaces and drops
  a move it cannot make, and deleting a Level deletes the tokens on it. The Levels case removes the
  floor before moving the token back down, or a failed run takes the token with it. `tests/`
  pins Playwright 1.47.2, whose Chromium (1134) is not installed here; the suite ran with
  `CHROME_PATH=/root/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome`.
- The four new cases (`vision: …` in `tests/live/cases.js`) fail against the code before this
  phase at the wall, the GM's selected token and the floor, and pass after. The sparks case already
  held for players before (the old `canSee`), and is kept as a regression check. 15/15 cases pass,
  with no console error on either client.
- **After the phase**, in its own commit (`c645283`): the Level test is core's `region.viewed`
  (`CanvasDocument#viewed`) in `refreshVisibility` and in the strike hook, in place of
  `!canvas.level || region.includedInLevel(canvas.level.id)`. Same test, and false once the scene is
  unviewed. The live suite passed 15/15 again.
- **Still the maintainer's call:** how the medallion appears as vision reaches it. It shows and
  hides at once, with no fade.

## Start here

- Open `scripts/harvest-control.js` (`HarvestControl#refreshState`, `registerHarvestControls`),
  `scripts/animation.js` (`canSee`, `playStrike`, `playRefill`), `README.md` (the paragraph
  "Players only see the button of the spot their token stands in…"), `CHANGELOG.md`.
- Read `00-overview.md` first: the core facts and the decisions are there, not here.
- APIs confirmed on v14 build 369; if the running build differs, re-read
  `CanvasVisibility#testVisibility` and `#_createVisibilityTestConfig` in core before writing.
- `git status` clean before the first edit.

## The shape

One test, used by the medallion and by the strike/refill effects. It lives in
`harvest-control.js` beside the medallion, and `animation.js` imports it in place of `canSee`
(`canSee` and its `isGM` short-cut are deleted):

```js
/**
 * Whether this client's tokens see a spot's medallion. Core never tests what sits in
 * canvas.controls against vision (DoorControl does it for doors), so without this a medallion
 * showed behind walls, in darkness and on a blinded token. No sighted token: testVisibility
 * answers true for a GM and false for a player, which is the GM rule we want.
 * @param {HarvestControl} control
 * @returns {boolean}
 */
export function seesSpot(control) {
  if ( !canvas.visibility.tokenVision ) return true;
  // The floor of the viewed Level, raised to where the region starts when it starts higher (a
  // balcony): core compares this elevation with each vision source's, and level surfaces
  // between them block sight.
  const { bottom, top } = control.region.elevation;
  const elevation = Math.clamp(canvas.level.elevation.base, bottom, top);
  return canvas.visibility.testVisibility({ x: control.x, y: control.y, elevation },
    { tolerance: control.radius / 2 });
}
```

`refreshState` keeps its rules and adds `seen`; the visibility part is split out so the
`sightRefresh` hook can run it without repainting every medallion:

```js
refreshVisibility() {
  const region = this.region;
  const onLevel = !canvas.level || region.includedInLevel(canvas.level.id);
  const seen = onLevel && seesSpot(this);
  if ( game.user.isGM ) this.visible = seen;
  else this.visible = seen && this.inside && !!this.behavior.system.resourceData
    && !this.behavior.disabled && !region.hidden;
}
```

(`this.inside` is the value `refreshState` computes today with `standsIn`, kept on the instance.
`refreshState` calls `refreshVisibility()` where it sets `visible` today; the GM's `alpha` rules
stay as they are.)

```js
// registerHarvestControls
Hooks.on("sightRefresh", () => {
  if ( !container ) return;
  for ( const control of controls.values() ) control.refreshVisibility();
});
```

In `playStrike` / `playRefill`: `seesSpot(control) ? getSpotFX() : null` in place of
`canSee(control.position) ? …`. The medallion's own swing still plays on a hidden medallion; it
is invisible.

No stored shape changes.

## Invariants

All observed in a `claude-*` world through `foundry-playwright`, GM and player clients, scene with
token vision on; the new cases go in `tests/live/cases.js`.

| Must hold | Falsified by |
|---|---|
| A player's token inside a spot, medallion centre in plain sight: medallion visible | Player client: `control.visible === false` |
| A wall between the player's token (inside the region) and the medallion centre: hidden | Player client: `control.visible === true` |
| Unlit scene, token without darkvision, inside: hidden; give it darkvision: visible after `sightRefresh` | either reading wrong on the player client |
| Token with the Blinded status, inside: hidden | `control.visible === true` |
| Spot on Level A, player's token inside it on Level A, a second Level B above viewed by nobody: visible; player switches the view to Level B: hidden | either reading wrong — **verify first**, this is the premise reading could not settle |
| A raised floor between levels hides a medallion of the lower level from a token above that looks down through `Level#visibility.levels` | `control.visible === true` — **verify first**; if core shows it, record what it does as a departure and ask the maintainer |
| GM with nothing selected: every spot on the viewed level visible, dimmed as today | any `control.visible === false` on the GM client |
| GM selects a sighted token: spots that token cannot see are hidden, those it sees are shown (inside or not, dimmed as today) | GM client readings disagree with `testVisibility` for that token |
| A strike seen by a player standing elsewhere who cannot see the spot: no sparks on their client | `getSpotFX()` gets particles on that client during the strike |
| No console error on either client through all of the above; existing `tests/live` cases still pass | `node tests/live/run.js` |
| How the medallion appears and fades in as vision reaches it | the maintainer's call |

## The commits

1. `Hide spot medallions where the viewer's tokens cannot see` — body: core never tests
   controls-layer objects against vision; the medallion and the strike effects now share one test
   at the medallion's centre, at the viewed Level's floor, re-run on every sight refresh; a GM with
   a sighted token selected sees what that token sees. Includes the README paragraph and a
   CHANGELOG `# Unreleased` entry (`[Fixed] …`), and renames this file `DONE_01-…`.

## What this deliberately does not do

- No sampling of several points of the region and no moving the medallion: the centre is the test
  (see the overview's decisions).
- No `fog.isPointExplored` fallback as Notes have: an explored but unseen spot stays hidden.
- No change to who may strike in `harvest.js` (`checkHarvest`): the server-side check stays
  position-based. Vision is a client-side display rule; a player who cannot see the button cannot
  click it. Making the GM validate sight would be a trust-boundary change for a different plan.
- No sound changes: phase 2.
