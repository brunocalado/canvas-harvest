# Canvas Harvest API

Ship resources with your module or system: ore veins, trees, herb bushes, carcasses, anything a
token can work for items. The resources you register appear in the GM's Resource Book (marked with
your package's name), ready to be dragged onto the map, with no setup from the GM. Your package can
add rules before a strike and consequences after it, and a macro can place spots, refill them and
strike them too.

The API is available as `CanvasHarvest` and as `game.modules.get("canvas-harvest").api`.

- [Quick start](#quick-start)
- [When to register](#when-to-register)
- [Hooks](#hooks)
- [Chat messages](#chat-messages)
- [Resource format](#resource-format)
- [Tags](#tags)
- [Tool Sets](#tool-sets)
- [How tools are matched](#how-tools-are-matched)
- [Spots](#spots)
- [Reference](#reference)
- [Full example: a module with its own compendium](#full-example-a-module-with-its-own-compendium)

---

## Quick start

A module adds its pickaxe to the Mine Tool Set and registers an iron vein that takes any tool from
that set. Its items live in its own compendium:

```js
Hooks.once("canvas-harvest.ready", api => {
  api.addTools("my-module", "strike", ["Compendium.my-module.items.Item.pickaxe00000000"]);
  api.registerResources("my-module", [{
    id: "iron-vein",
    name: "Iron Vein",
    img: "icons/commodities/stone/ore-chunk-iron-black.webp",
    verb: "Mine",
    animation: "strike",
    toolSets: ["strike"],
    drops: [
      { uuid: "Compendium.my-module.items.Item.ironore00000000", weight: 8, min: 1, max: 1 },
      { uuid: "Compendium.my-module.items.Item.gem000000000000", weight: 1, min: 1, max: 1 }
    ],
    strikes: 10
  }]);
});
```

Then a GM macro (type **Script**) puts a vein beside the selected token:

```js
const token = canvas.tokens.controlled[0];
if ( !token ) return ui.notifications.warn("Select a token first.");
await CanvasHarvest.createSpot({
  resource: "my-module.iron-vein",
  x: token.center.x + (2 * canvas.grid.size),
  y: token.center.y
});
```

A player whose token stands in the spot sees its button on the map and strikes it with a click.

---

## When to register

Registered resources live in memory, on each client. Register them on **every** client, every time
the world loads, from your own `ready` hook or from Canvas Harvest's, which passes the API:

```js
// At the top level of your script (or in "init"), so the listener exists before the hook fires.
Hooks.once("canvas-harvest.ready", api => {
  api.registerResources("my-module", MY_RESOURCES);
});
```

The hook only fires when Canvas Harvest is active, so you don't need to check. Register after your
compendium's index is loaded, which `ready` guarantees: tools and drops are looked up there.

---

## Hooks

| Hook | Where | Args | Notes |
|---|---|---|---|
| `canvas-harvest.ready` | every client | `api` | Fired once, on `ready`. |
| `canvas-harvest.preHarvest` | the client asking for the strike | `token`, `resource`, `spot`, `veto` | Before the strike is sent to the GM: a click on the spot's button, or `harvest()`. Return `false` to stop it; set `veto.reason` to tell the player why. |
| `canvas-harvest.harvest` | active GM | `token`, `{ resource, spot, drops, undelivered, left, user }` | After the items reached the map. Can't be cancelled. |
| `canvas-harvest.preChatMessage` | active GM | `messageData`, `{ event, token, resource, spot, user }` | Before one of the module's messages is created. Change `messageData` to restyle it; return `false` to drop it. See [Chat messages](#chat-messages). |
| `canvas-harvest.spotCreated` | every client | `spot` | A spot was made: by `createSpot`, a drag from the book, or the behavior added in a Region's sheet. |
| `canvas-harvest.spotDepleted` | every client | `spot`, `token` | The spot's strikes left reached 0: by a strike, or set by hand. `token` is the striking `TokenDocument`, or `null` when no strike did it. |
| `canvas-harvest.spotRefilled` | every client | `spot`, `{ previous, left }` | The spot's strikes left went up, whatever did it: a click on its button, `refill`, the GM's sheet, a new resource, or a strike given back because none of its items reached the map. `previous` is the strikes it had before. |

The three spot hooks fire on every client, whatever scene it is viewing, so a listener can play a
sound for everyone. A listener that writes documents (a chat message, say) should run on one client
only: check `game.user.isActiveGM` first. Both follow the spot's strikes left, so a listener sees
every change, including the GM's edits in the Region Behavior sheet.

```js
Hooks.on("canvas-harvest.spotDepleted", () => {
  foundry.audio.AudioHelper.play({ src: "sounds/lock.wav", volume: 0.8 });
});

Hooks.on("canvas-harvest.spotRefilled", (spot, { previous, left }) => {
  if ( !game.user.isActiveGM || (previous > 0) ) return;
  ChatMessage.implementation.create({ content: `<p>${spot.parent.name} can be worked again (${left} strikes).</p>` });
});
```

For `canvas-harvest.preHarvest`, `token` is the striking `TokenDocument`, `resource` a copy of the
[resource](#resource-format) and `spot` the spot's `RegionBehavior`. Add your own rules here, read
from the current state: the time of day, a condition on the actor, the resource's [tags](#tags):

```js
Hooks.on("canvas-harvest.preHarvest", (token, resource, spot, veto) => {
  if ( token.actor?.system.resources?.stamina?.value > 0 ) return;
  veto.reason = "You are too tired to work.";
  return false;
});
```

The hook is synchronous: a listener decides at once, and can't wait for a roll or a dialog. It runs
only on the client asking for the strike; the GM doesn't run it again. The reason is shown in a
notification, which renders HTML, so escape any name you put in it.

For `canvas-harvest.harvest`, `resource` is a copy of the resource struck, tags included. `drops`
lists everything the strike gave, as `{ ref, quantity }` (`ref` is `{ uuid, name, img, type,
sources }`), and `undelivered` the part that found no space on the map in the end (the GMs get a
whisper about it). `left` is the strikes the spot has left, and `user` the `User` who struck. It
fires on the GM's client only, so a listener that writes documents runs once. A strike that put
nothing on the map is given back to the spot and fires no hook.

---

## Chat messages

Canvas Harvest posts three messages, all from the active GM:

| `event` | Who sees it | When |
|---|---|---|
| `"harvest"` | everyone | A strike put its items on the map: who struck, what fell, and the strikes left. |
| `"needTool"` | the player who clicked | The player's token carries none of the tools the resource takes; lists every one that would do. Only while the GMs' "whisper the tools" setting is on. |
| `"undelivered"` | the GMs | Part of a strike found no space on the map, so the GM can hand it over. |

A system or module can give any of them its own look, or drop it, with
`canvas-harvest.preChatMessage`. It receives the data the message is about to be created from:

```js
Hooks.on("canvas-harvest.preChatMessage", (messageData, { event }) => {
  if ( event !== "harvest" ) return;
  const { actorName, resource, items, left } = messageData.flags["canvas-harvest"];
  const { escapeHTML } = foundry.utils;
  messageData.content = `<div class="my-system-card">
    <h3>${escapeHTML(actorName)} · ${escapeHTML(resource.name)}</h3>
    <ul>${items.map(i => `<li>${i.quantity} × ${escapeHTML(i.name)}</li>`).join("")}</ul>
    <p>${left} left</p>
  </div>`;
});
```

Change `messageData` in place, any field `ChatMessage.create` takes: `content`, `flavor`,
`speaker`, `whisper`, or a `type` and `system` of your own message subtype. Return `false` to post
nothing; the strike itself is not affected.

The hook is not awaited: Canvas Harvest creates the message as soon as the listener returns, so
`messageData` must be finished by then. A listener that is `async`, or that waits on
`renderTemplate`, changes nothing, and the message goes out with Canvas Harvest's own card. Compile
your template beforehand and call it inside the hook:

```js
Hooks.once("canvas-harvest.ready", async () => {
  const template = await foundry.applications.handlebars.getTemplate("systems/my-system/templates/harvest.hbs");
  Hooks.on("canvas-harvest.preChatMessage", messageData => {
    const data = messageData.flags["canvas-harvest"];
    if ( data.event === "harvest" ) messageData.content = template(data);
  });
});
```

The hook runs on the GM's client only, so text you localize there reads in the GM's language for
everyone, as Canvas Harvest's own cards do. The flags hold what happened as data, not as text, so a
`renderChatMessageHTML` listener can reword a card in each reader's language if that matters.

Every message carries in `flags["canvas-harvest"]`:

| Flag | | |
|---|---|---|
| `event` | `"harvest"`, `"needTool"` or `"undelivered"` | |
| `actorName` | `string` | The striking token's name. For `"needTool"`, the token that tried. |
| `resource` | `{ id, name, img, animation, verb }` | The resource struck. `verb` is there only when the resource has its own; otherwise word the `animation`'s verb yourself. |
| `items` | `{ uuid, name, img, quantity }[]` | `"harvest"`: what reached the map. `"undelivered"`: what did not. `"needTool"`: the tools that would do, without `quantity`. |
| `left` | `number` | The spot's strikes left. `"harvest"` only; `0` means depleted. |
| `spotUuid` | `string` | The spot's `RegionBehavior`. |

Canvas Harvest writes these flags again after the hook, so they stay as they are whatever a
listener does to them.

The second argument holds the live objects: `event` again, `token` the `TokenDocument`, `resource`
a copy of the [resource](#resource-format) with its tags, `spot` the `RegionBehavior`, and `user`
the `User` who struck (for `"needTool"`, the one being whispered).

To style the default cards instead of replacing them, target `.canvas-harvest.ch-chat-card`; the
tool whisper adds `.ch-tool-card` and a depleted spot `.ch-depleted`.

---

## Resource format

| Field | Type | | Limits |
|---|---|---|---|
| `id` | string | Unique within your package; stored as `"<packageId>.<id>"`. | required |
| `name` | string | | required, up to 64 characters |
| `img` | string | The image on the button and in the book: a picture or a webm video. Another video format falls back to the default. | ore chunk by default |
| `verb` | string | The button's label. Empty uses the animation's own: Mine, Chop, Gather, Carve. | up to 12 characters |
| `animation` | string | How a strike looks and sounds: `"strike"`, `"chop"`, `"gather"` or `"carve"`. | `"strike"` by default |
| `toolSets` | string[] | The [Tool Sets](#tool-sets) whose items open the resource: any of `"strike"`, `"chop"`, `"gather"`, `"carve"`. Unknown ids are left out. | none by default |
| `tools` | string[] | Item uuids of tools for this resource alone, on top of its Tool Sets. | up to 4 |
| `drops` | object[] | `{ uuid, weight, min, max }`: the item, how often it comes up against the others, and how many a strike gives when it does. Each strike gives one drop. | 1 to 5; weight 1–100 (100 when left out), min and max 1–20 |
| `strikes` | number | How many strikes a spot holds before it runs dry. | 1–30, 10 by default |
| `sound` | string | A file that replaces the animation's sound. | `""` by default |
| `soundEnabled` | boolean | Whether its strikes make a sound at all. | `true` by default |
| `soundRadius` | number | How far its sounds carry, in grid spaces. Omitted uses the world's reach. | 1–60 |
| `category` | string | The group the resource is listed under in the Resource Book, within your package's. Empty lists it under its animation's verb. | up to 24 characters, `""` by default |
| `tags` | string[] | Labels your package reacts to; see [Tags](#tags). Blanks and repeats are dropped. | up to 16, each up to 64 characters; none by default |

Numbers are rounded and clamped to their limits, and a `max` below its `min` is raised to it. Canvas
Harvest doesn't know what a resource is: a vein, a tree and a carcass differ only in their tools,
drops and animation. What a resource means to your package goes in its [tags](#tags).

---

## Tags

A tag is a string that Canvas Harvest keeps on a resource and hands back, and never reads. Your
package decides what each tag does, usually in the [hooks](#hooks): refuse a strike in
`preHarvest`, or post a consequence in `harvest`. Prefix your tags with your package id so they
don't collide with another package's.

Tags follow the resource, not its id. A registered resource the GM edits keeps the tags you
register, whatever the GM changed. The Resource Book's Duplicate copies them, and a resource the
GM made from scratch can be given any of them, so one behavior covers every resource that carries
its tag:

```js
// A resource registered with its tags.
api.registerResources("my-system", [{ id: "nettle-patch", name: "Nettle Patch", tags: ["my-system.stinging"], /* ... */ }]);

// A world resource tagged by the GM, from a macro or a window your package provides.
await CanvasHarvest.setTags(resourceId, ["my-system.stinging"]);

// What the tag does.
Hooks.on("canvas-harvest.harvest", (token, { resource, user }) => {
  if ( !resource.tags.includes("my-system.stinging") ) return;
  ChatMessage.implementation.create({ content: `<p>${foundry.utils.escapeHTML(token.name)} is stung.</p>`, whisper: [user.id] });
});
```

Tags are set only through the API: the Resource Book neither shows nor edits them, and keeps them
when the GM saves.

---

## Tool Sets

There are four Tool Sets, one per animation: `strike` (Mine), `chop`, `gather` and `carve`. Each is
a list of items that count as tools, as long as the GM likes. The GM fills them in the **Tool Sets**
window, opened from the module's settings or from the toolbox button in the Resource Book. A
package adds its own items with [`addTools`](#addtoolspackageid-set-uuids--number), so its
pickaxe counts for every resource that switches the Mine set on, the GM's included.

A resource switches on any of the sets (`toolSets`), and may list tools of its own (`tools`). A
token can strike when its actor carries an item from a switched-on set **or** one of the
resource's own tools. With no set switched on and no tools of its own, bare hands will do.

A set with no items is ignored, as if switched off: the resource neither asks for it nor is opened
by it until the set gets an item. In the Resource Book its switch is off and locked.

The active GM checks every strike against the sets on its own client, so register your tools on
every client, the GM's included.

---

## How tools are matched

A token can strike when its actor carries an item that **is** one of the tools, from a switched-on
set or the resource's own:

1. it **comes from** the tool: Foundry records the source of an item copied from a compendium
   (`_stats.compendiumSource`) or duplicated from a world item (`_stats.duplicateSource`), and Canvas
   Harvest compares those; or
2. failing that, it has the **same name and item type**.

So a pickaxe a GM made by hand still counts, as long as the name and type match. Point your tools at
the same compendium items you hand out to players, and matching is exact.

---

## Spots

A spot is a Region carrying the **Harvest Spot** behavior. The behavior holds the resource's id and
`remaining`, the strikes left. It is set to the resource's strikes when the spot is made or its
resource changes, unless a number is given in the same write, and the GM may set it to any number
after that. Changing a resource's strikes later only reaches new spots and refills. Each strike
spends one, whatever it gives. A dry spot stays on the map until the GM
refills it, with a click on its button or with [`refill`](#refillspot-amount--promiseboolean-gm-only),
or until a package refills it; see [A spot that grows back](#a-spot-that-grows-back).

A spot made on a token is attached to it (the Region's `attachment.token`) and moves with it. That
is how a carcass works: drag the token aside and its spot follows. The carrying token never strikes
its own spot, and deleting it deletes the spot.

Wherever a method takes a `spot`, it accepts the spot's `RegionBehavior`, the `RegionDocument`
carrying it, or the uuid of either.

### A spot that grows back

Canvas Harvest never refills a spot on its own. A package decides when a spot comes back and with
how much, from the spot hooks and the world's clock. This one makes apple trees bear again two
weeks of world time after they ran dry:

```js
const TREE = "my-module.apple-tree";
const REGROW = 14 * 24 * 60 * 60; // world time is in seconds

// Remember when the tree ran dry, on the spot itself, so it survives a reload.
Hooks.on("canvas-harvest.spotDepleted", spot => {
  if ( game.user.isActiveGM && (spot.system.resource === TREE) ) spot.setFlag("my-module", "dryAt", game.time.worldTime);
});
// Refilled by anyone, for any reason: nothing left to wait for.
Hooks.on("canvas-harvest.spotRefilled", spot => {
  if ( game.user.isActiveGM && (spot.getFlag("my-module", "dryAt") !== undefined) ) spot.unsetFlag("my-module", "dryAt");
});

async function regrow() {
  if ( !game.user.isActiveGM ) return;
  for ( const scene of game.scenes ) {
    for ( const { behaviorUuid } of CanvasHarvest.getSpots(scene) ) {
      const spot = fromUuidSync(behaviorUuid);
      const dryAt = spot.getFlag("my-module", "dryAt");
      if ( (dryAt !== undefined) && (game.time.worldTime - dryAt >= REGROW) ) await CanvasHarvest.refill(spot);
    }
  }
}
Hooks.on("updateWorldTime", regrow);
// Time may have moved while no GM was connected.
Hooks.once("ready", regrow);
```

`refill` takes a number too, so a spot can come back partly, or with a roll:
`CanvasHarvest.refill(spot, (await new Roll("1d4").evaluate()).total)`. A spot in a scene nobody
is viewing is refilled all the same, and players find it full when they get there.

---

## Reference

Refusals a user can cause (not a GM, an unknown id) show a warning and resolve `false`. Wrong
argument types throw. Data handed out is always a copy.

### `registerResources(packageId, list)` → `number`

Registers resources for your package, on this client, and returns how many were accepted.

- `packageId` *(string)*: your module's or system's id. It labels the resources in the GM's book
  and prefixes their ids.
- `list` *(object[])*: resources in the [format above](#resource-format).

A resource is skipped, with a warning in the console, when it has no `id` or `name`, an unknown
`animation`, `tags` that are not a list of strings within the limits, or no drop whose uuid can be
found. A tool or drop whose uuid can't be found is left out with a warning; tools past 4 and drops
past 5 are cut. Registering an `id` you already registered replaces that resource.

The GM can edit a registered resource in the Resource Book. The edit keeps your resource's id, so
spots already on the map follow it, and it replaces your version, other than its tags, until the GM
restores it. Registering the resource again doesn't undo the GM's edit; your tags always apply. The
GM can also duplicate it into a world resource of their own.

### `unregisterResources(packageId)`

Removes every resource your package registered, on this client. Its spots stay on the map, inert,
until it is registered again.

### `getResources()` → `object[]`

Every resource on this client: the world's first, then registered ones, each with `source`
(`"world"` or the package id), `toolSets` and `tags`, and `edited: true` on a registered resource
the GM changed. Tools are `{ uuid, name, img, type, sources }`;
drops are `{ item, weight, min, max }` with `item` in that shape.

### `getResource(id)` → `object|null`

One resource, or `null` when there is none with that id.

### `setTags(id, tags)` → `Promise<boolean>` *(GM only)*

Replaces the [tags](#tags) of one of the world's resources, and leaves the rest of it as saved.

- `id` *(string)*: the resource's id.
- `tags` *(string[])*: the new tags; `[]` clears them. Blanks and repeats are dropped.

A list that isn't strings, holds more than 16 tags, or a tag longer than 64 characters throws. A
resource a package registered can't be changed, even after the GM edited it: the package passes its
tags when it registers it.

### `addTools(packageId, set, uuids)` → `number`

Adds your package's items to one [Tool Set](#tool-sets), on this client, and returns how many
were accepted. Call it on every client, at the same time you register resources.

- `packageId` *(string)*: your module's or system's id. The Tool Sets window marks the items with
  your package's name.
- `set` *(string)*: `"strike"`, `"chop"`, `"gather"` or `"carve"`.
- `uuids` *(string[])*: item uuids, usually from your compendium.

A uuid that can't be found is left out with a warning in the console; adding an item already there
changes nothing. The GM can't remove your items from the window, since you add them on every load.

### `removeTools(packageId)`

Removes every item your package added to the Tool Sets, on this client.

### `getToolSets()` → `object`

Every Tool Set on this client, keyed by id, each a list of `{ uuid, name, img, type, sources,
source }`: the GM's items first (`source: "world"`), then those packages added.

### `openBook({ resource })` → `Promise<ResourceBook|false>` *(GM only)*

Opens the Resource Book, or brings it forward. With `resource`, a resource id, the book shows that
resource, as if the GM had picked it in the list; if the book holds unsaved edits to another one, the GM
is asked first. An unknown id warns and resolves `false`.

### `createSpot(args)` → `Promise<RegionDocument|false>` *(GM only)*

Makes a spot: a square or rectangular Region carrying the Harvest Spot behavior, full. Its visibility is
**Gamemaster**: the GM sees the area on every layer, players only see the spot's medallion.

| Argument | Type | Default | |
|---|---|---|---|
| `resource` | `string` | | A resource id. |
| `x`, `y` | `number` | | The centre, in canvas coordinates. On a grid it snaps to the centre of that space. Not needed with `token`. |
| `scene` | `Scene` | `canvas.scene` | |
| `levelId` | `string\|null` | the viewed Level | The Level the spot is on. On a scene that is not on the canvas there is no viewed Level, and without `levelId` the spot is on every Level. With `token`, the spot takes the token's Level. |
| `margin` | `number` | `1` | Grid spaces around the centre space. 1 makes a 3×3 square, 0 just the one space. |
| `width`, `height` | `number` | | In place of `margin`, a rectangle of this many grid spaces across and down, each a whole number from 1 up. Pass both, and never with `margin`. |
| `token` | `Token\|TokenDocument\|string\|null` | `null` | Attach the spot to this token: centred on it, reaching `margin` spaces past its larger side, and following it. With `width` and `height`, the rectangle is centred on the token and must be at least the token's size. |

Dragging a resource from the book onto the map does the same with the default `margin`, and onto a
token attaches it.

A side with an odd number of spaces is centred on the space under `x`, `y`; an even side has no
middle space, so its centre moves to the grid line nearest to `x`, `y`. Either way the rectangle
covers whole spaces. On a gridless scene `width` and `height` count the scene's grid size and
nothing snaps.

```js
// A riverbank four spaces wide and one deep.
await CanvasHarvest.createSpot({ resource: "my-module.sand-bank", x, y, width: 4, height: 1 });
```

Any other shape is a Region you make yourself, with the Harvest Spot behavior added to it:

```js
await region.createEmbeddedDocuments("RegionBehavior", [{
  type: "canvas-harvest.spot", system: { resource: "my-module.sand-bank" }
}]);
```


### `getSpots(scene)` → `object[]`

Every spot on a scene (`canvas.scene` by default), as
`{ regionUuid, behaviorUuid, resourceId, left, strikes, disabled }`. `strikes` is `null` when the
resource no longer exists.

### `refill(spot, amount)` → `Promise<boolean>` *(GM only)*

Puts strikes back. Without `amount` the spot is back at its resource's strikes; with it, `amount`
is the strikes left afterwards, any number from 0. Every client viewing the scene plays the refill.

To refill every spot on the scene from a macro:

```js
for ( const spot of CanvasHarvest.getSpots() ) await CanvasHarvest.refill(spot.behaviorUuid);
```

### `harvest(token, spot)` → `Promise<boolean>`

Strikes a spot with a token, by the same rules and the same path as a click on its button: the
token must be the user's and stand in the spot, carry a tool when the resource asks for one, and the
spot must have strikes left. Resolves `true` once the GM delivered the strike, `false` after a
warning otherwise.

---

## Full example: a module with its own compendium

`module.json`:

```json
"relationships": {
  "recommends": [
    {
      "id": "canvas-harvest",
      "type": "module",
      "manifest": "https://github.com/brunocalado/canvas-harvest/releases/latest/download/module.json",
      "reason": "Lets players mine and gather this module's materials on the map."
    }
  ]
}
```

`scripts/harvest.js`:

```js
const PACK = "Compendium.my-module.materials.Item";

Hooks.once("canvas-harvest.ready", api => {
  // The module's axe and knife count for every resource that takes those sets.
  api.addTools("my-module", "chop", [`${PACK}.axe000000000000`]);
  api.addTools("my-module", "carve", [`${PACK}.knife0000000000`]);
  api.registerResources("my-module", [
    {
      id: "oak", name: "Oak", img: "icons/environment/wilderness/tree-oak.webp", animation: "chop",
      toolSets: ["chop"],
      drops: [{ uuid: `${PACK}.logs00000000000`, weight: 1, min: 1, max: 2 }],
      strikes: 6
    },
    {
      id: "herb-bush", name: "Herb Bush", animation: "gather",
      drops: [{ uuid: `${PACK}.herbs0000000000`, weight: 1, min: 1, max: 3 }],
      strikes: 3
    },
    {
      id: "deer", name: "Deer Carcass", verb: "Skin", animation: "carve",
      // A knife from the Carve set, or the module's own skinning knife.
      toolSets: ["carve"],
      tools: [`${PACK}.skinknife000000`],
      drops: [
        { uuid: `${PACK}.meat00000000000`, weight: 3, min: 1, max: 2 },
        { uuid: `${PACK}.hide00000000000`, weight: 1, min: 1, max: 1 }
      ],
      strikes: 4
    }
  ]);
});
```

Use `recommends` rather than `requires` if your module also works without Canvas Harvest.
