# Phase 3 — A resource can silence its sounds or set how far they carry

## Start here

- Open `scripts/resources.js` (`blankResource`, `validateResource`, `toStored`, the package
  normaliser that returns `sound: (typeof entry.sound === "string") …`),
  `scripts/apps/resource-book.js` (`#onEditSound`, the context that builds `customSound` and
  `soundTip`), `scripts/harvest-control.js` (the strike in the `updateRegionBehavior` hook),
  `templates/book.hbs` (the sound button), `styles/book.css`, `lang/en.json`, `docs/API.md`
  (the resource reference table, rows `verb`…`strikes`), `README.md`, `CHANGELOG.md`.
- Phase 2 is renamed `DONE_02-positional-sound.md`; read its Departures (`playCueAt`'s signature
  and `RESOURCE_LIMITS.soundRadius` are used here). The live suite needs `CHROME_PATH` (see
  `DONE_01-medallion-vision.md`).
- Read `canvas-harvest-visual-identity` before touching the dialog: the toggle is its
  `.ch-toggle` switch, already used in `book.hbs` for Tool Sets.
- `git status` clean before the first edit.

## The shape

Two fields on a resource:

```js
// blankResource
soundEnabled: true,
soundRadius: null,   // grid spaces; null = the world's reach from Harvest Sounds

// toStored — both carried
const { …, sound, soundEnabled, soundRadius, … } = foundry.utils.deepClone(r);
return { …, sound, soundEnabled, soundRadius, … };

// package normaliser
soundEnabled: entry.soundEnabled !== false,
soundRadius: Number.isInteger(entry.soundRadius) ? Math.clamp(entry.soundRadius, ...L.soundRadius) : null,

// validateResource
if ( (r.soundRadius !== null) && !inRange(r.soundRadius, L.soundRadius) ) return "BadNumbers";
```

Readers treat a missing field as its default (`r.soundEnabled !== false`, `r.soundRadius ?? null`),
so resources already saved in `SETTING_RESOURCES` / `SETTING_RESOURCE_EDITS` before this phase
keep sounding with the world's reach. **No migration**: the module is in alpha and the defaults
read old entries correctly.

The strike:

```js
if ( effect?.strike && (resource.soundEnabled !== false) ) {
  const spaces = resource.soundRadius ?? undefined;
  playCueAt(resource.animation, origin, { override: resource.sound, spaces });
  if ( effect.depleted ) setTimeout(() => playCueAt("depleted", origin, { spaces }), 500);
}
```

The sound dialog (`#onEditSound`) gains, above the file field, a toggle and a reach field; the
reach and the file are disabled while the toggle is off. The `Done` callback returns
`{ sound, soundEnabled, soundRadius }` instead of a string; `#onEditSound` compares the three
with the draft and marks it dirty when any differs. Empty reach → `null`.

```html
<label class="ch-switch-row">
  <input type="checkbox" class="ch-toggle" name="soundEnabled">
  <span>${loc("CANVASHARVEST.Book.SoundEnabled")}</span>
</label>
<fieldset class="ch-field ch-sound-radius">
  <legend>${loc("CANVASHARVEST.Book.SoundRadius")}</legend>
  <input type="number" name="soundRadius" min="1" max="60" step="1"
         placeholder="${worldReach}">   <!-- the Harvest Sounds value -->
  <span class="ch-unit">${loc("CANVASHARVEST.Sounds.Spaces")}</span>
</fieldset>
```

The book's sound button shows the state: its tip reads "Sound: off" when the resource is silenced
(new key `CANVASHARVEST.Book.SoundOff`), and the icon becomes `fa-volume-xmark`.

New `lang/en.json` keys: `CANVASHARVEST.Book.SoundEnabled` ("Play sounds"),
`CANVASHARVEST.Book.SoundRadius` ("Reach"), `CANVASHARVEST.Book.SoundRadiusHint` ("Empty uses
the reach set in Harvest Sounds."), `CANVASHARVEST.Book.SoundOff` ("Sound: off").

`docs/API.md`, resource reference table, two rows after `strikes`:

```
| `soundEnabled` | boolean | Whether its strikes make a sound at all. | `true` by default |
| `soundRadius` | number | How far its sounds carry, in grid spaces. Omitted uses the world's reach. | 1–60 |
```

## Invariants

| Must hold | Falsified by |
|---|---|
| Toggle off, Done, Save: a strike plays nothing on any client, depleted cue included | a `playAtPosition` call seen on any client (wrap it in a `claude-*` world) |
| Reach 3 on the resource, world reach 12: a token 6 spaces away hears nothing; reach empty: it hears | the opposite reading |
| A resource saved before this phase (no fields) plays with the world's reach | silent, or a validation error on load |
| A package resource registered with `soundEnabled: false` / `soundRadius: 5` keeps them; `soundRadius: 500` is clamped to 60 | `api` resource read back differs |
| Reach 0 or 61 typed in the dialog cannot be saved (`BadNumbers` warning) | saved |
| Closing the dialog without Done changes nothing | book marked dirty |
| No console error; existing `tests/live` cases pass | `node tests/live/run.js` |
| The toggle and field look right in both themes | the maintainer's call |

## The commits

1. `Let a resource silence its sounds or set how far they carry` — body: a resource's sound dialog
   gains a toggle that silences its strike and depleted cues and a reach that overrides the world's;
   both are stored on the resource, read as their defaults on resources saved before, accepted
   from packages through the API. Includes `docs/API.md`, README, CHANGELOG `# Unreleased`, the
   rename to `DONE_03-…`, and — this being the last phase — leaves the closing of the plan as its
   own commit (`Close plan spot-vision-and-positional-sound`).

## What this deliberately does not do

- No per-cue toggles (strike on, depleted off): the maintainer chose one switch for everything.
- No per-spot override on the Region Behavior: the resource is the unit.
- No volume per resource: the world's volume and each user's Environment channel stay the controls.

## Departures

(empty until the phase lands)
