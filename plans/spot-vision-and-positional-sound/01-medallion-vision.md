# Phase 1 — Medallions and strike effects follow token vision, walls and Levels

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

## Departures

(empty until the phase lands)
