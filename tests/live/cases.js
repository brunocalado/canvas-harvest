/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The live cases. Each `run` receives the GM's and the player's pages, the fixture ids and the
 * runner's helpers, throws on a failure, and leaves the world as it found it.
 */

/**
 * @param {*} condition
 * @param {string} message
 */
function assert(condition, message) {
  if ( !condition ) throw new Error(message);
}

/**
 * Change the test resource on the GM's client.
 * @param {object} t
 * @param {object} patch   fields to set; a string value is taken as JS evaluated there
 */
function patchResource({ gm, ev, ids }, patch) {
  const fields = Object.entries(patch).map(([k, v]) => `r[${JSON.stringify(k)}] = ${(typeof v === "string") ? v : JSON.stringify(v)};`).join(" ");
  return ev(gm, `const list = foundry.utils.deepClone(game.settings.get("canvas-harvest", "resources"));
    const r = list.find(r => r.id === ${JSON.stringify(ids.resource)}); ${fields}
    await game.settings.set("canvas-harvest", "resources", list);`);
}

/** An ItemRef of a world item, as a JS expression run in a client. */
const refOf = uuid => `(i => ({ uuid: i.uuid, name: i.name, img: i.img, type: i.type, sources: [i.uuid] }))(fromUuidSync(${JSON.stringify(uuid)}))`;

/** Strikes left on the test spot, read by the GM. */
const left = ({ gm, ev, ids }) => ev(gm, `return fromUuidSync(${JSON.stringify(ids.spot)}).system.left;`);

/** Set the test spot's strikes left. */
const setLeft = ({ gm, ev, ids }, n) => ev(gm, `await fromUuidSync(${JSON.stringify(ids.spot)}).update({ "system.remaining": ${n} });`);

/** The player strikes the test spot with the test token, through the API. */
const strike = ({ pl, ev, ids }) => ev(pl, `return CanvasHarvest.harvest(${JSON.stringify(ids.token)}, ${JSON.stringify(ids.spot)});`);

/**
 * Drop an item on an element of a window, as a drag from the Items directory would.
 * @param {string} target   JS for the drop target
 * @param {string} uuid     JS for the item's uuid
 * @returns {string} JS run in a client
 */
const dropItem = (target, uuid) => `{ const dt = new DataTransfer();
  dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: ${uuid} }));
  ${target}.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 800)); }`;

/** The medallion a client drew for a region, as a JS expression run there. */
const medallion = id => `canvas.controls.children.flatMap(c => c.children ?? []).find(c => c.region?.id === ${JSON.stringify(id)})`;

/**
 * Wait until a client shows or hides a region's medallion, or fail saying what the case had set up.
 * @param {object} t
 * @param {import("playwright").Page} page
 * @param {string} id       the region's id
 * @param {boolean} shown
 * @param {string} where
 */
async function expectShown({ until }, page, id, shown, where) {
  try {
    await until(page, `${medallion(id)}?.visible === ${shown}`);
  } catch {
    throw new Error(`${where}: the medallion stayed ${shown ? "hidden" : "shown"}`);
  }
}

/**
 * Light the scene and make a spot the test token stands at one end of, its medallion two token
 * widths off, so a wall fits between the two.
 * @param {object} t
 * @returns {Promise<{region: string, spot: string, wall: number[], light: boolean}>}
 */
function wideSpot({ gm, ev, ids }) {
  return ev(gm, `const light = canvas.scene.environment.globalLight.enabled;
    await canvas.scene.update({ "environment.globalLight.enabled": true });
    const token = fromUuidSync(${JSON.stringify(ids.token)});
    const c = token.getCenterPoint();
    const size = canvas.grid.size;
    const off = 2 * token.object.w;
    const region = await CanvasHarvest.createSpot({ resource: ${JSON.stringify(ids.resource)}, x: c.x + off, y: c.y,
      width: Math.ceil((2 * off) / size) + 2, height: Math.ceil(token.object.h / size) + 2 });
    return { region: region.id, spot: region.behaviors.contents[0].uuid, light,
      wall: [c.x + (off / 2), c.y - off, c.x + (off / 2), c.y + off].map(Math.round) };`);
}

/**
 * Put the test scene back as the fixture left it: its one spot, no walls, the light as it was.
 * @param {object} t
 * @param {boolean} light
 */
function resetScene({ gm, ev, ids }, light) {
  return ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Wall", canvas.scene.walls.map(w => w.id));
    await canvas.scene.deleteEmbeddedDocuments("Region", canvas.scene.regions.filter(r => r.id !== ${JSON.stringify(ids.region)}).map(r => r.id));
    await canvas.scene.update({ "environment.globalLight.enabled": ${light} });`);
}

/**
 * Record every harvest sound a client plays from now on: each call to core's positional player, with
 * the volume it resolved to (null when none of this user's tokens hears it), and each direct play.
 * A headless browser has no audio output, so this is what "heard" means in these cases.
 * @type {string}   JS run in a client
 */
const recordSounds = `globalThis.chTestSounds = [];
  const layer = canvas.sounds;
  if ( !layer.chTestWrapped ) {
    const play = Object.getPrototypeOf(layer).playAtPosition;
    layer.playAtPosition = async function(src, origin, radius, options) {
      const entry = { kind: "positional", src, origin: { ...origin }, radius, volume: null, done: false, at: performance.now() };
      chTestSounds.push(entry);
      const sound = await play.call(this, src, origin, radius, options);
      Object.assign(entry, { volume: sound?.volume ?? null, done: true });
      return sound;
    };
    layer.chTestWrapped = true;
  }
  const helper = foundry.audio.AudioHelper;
  if ( !helper.chTestWrapped ) {
    const play = helper.play;
    helper.play = function(data, socketOptions) {
      chTestSounds.push({ kind: "direct", src: data.src, volume: data.volume, done: true, at: performance.now() });
      return play.call(this, data, socketOptions);
    };
    helper.chTestWrapped = true;
  }`;

/**
 * A token of the GM's standing in a spot of its own, a number of grid spaces right of where the test
 * token listens from.
 * @param {object} t
 * @param {number} spaces
 * @param {object} [at]
 * @param {string|null} [at.level]   the test token's Level when null
 * @param {number} [at.elevation]
 * @returns {Promise<{token: string, spot: string, medallion: {x: number, y: number}}>}
 */
function placeStriker({ gm, ev, ids }, spaces, { level = null, elevation = 0 } = {}) {
  return ev(gm, `const hero = fromUuidSync(${JSON.stringify(ids.token)});
    const actor = game.actors.getName("CH Test Striker") ?? await Actor.implementation.create({ name: "CH Test Striker", type: hero.actor.type });
    const levelId = ${JSON.stringify(level)} ?? hero.level;
    const l = hero.getListenerPosition();
    const region = await CanvasHarvest.createSpot({ resource: ${JSON.stringify(ids.resource)}, x: l.x + (${spaces} * canvas.grid.size), y: l.y,
      levelId, margin: Math.ceil(Math.max(actor.prototypeToken.width, actor.prototypeToken.height) / 2) });
    const { x, y, width, height } = region.bounds;
    const w = actor.prototypeToken.width * canvas.grid.sizeX;
    const h = actor.prototypeToken.height * canvas.grid.sizeY;
    const data = (await actor.getTokenDocument({ x: x + ((width - w) / 2), y: y + ((height - h) / 2) })).toObject();
    const [token] = await canvas.scene.createEmbeddedDocuments("Token", [{ ...data, level: levelId, elevation: ${elevation} }]);
    return { token: token.uuid, spot: region.behaviors.contents[0].uuid, medallion: { x: x + (width / 2), y: y + (height / 2) } };`);
}

/**
 * The GM strikes a spot with a token; returns what each client played for the strike.
 * @param {object} t
 * @param {{token: string, spot: string}} striker
 * @param {number} [cues]   how many cues the strike plays: 2 when it empties the spot
 * @returns {Promise<{gm: object[], pl: object[]}>}
 */
async function strikeHeard(t, { token, spot }, cues = 1) {
  const { gm, pl, ev, until } = t;
  for ( const page of [gm, pl] ) await ev(page, `chTestSounds.length = 0;`);
  const left = await ev(pl, `return fromUuidSync(${JSON.stringify(spot)}).system.left;`);
  const ok = await ev(gm, `return CanvasHarvest.harvest(${JSON.stringify(token)}, ${JSON.stringify(spot)});`);
  assert(ok === true, `the strike failed: ${await t.notes(gm)}`);
  await until(pl, `fromUuidSync(${JSON.stringify(spot)}).system.left < ${left}`);
  const heard = {};
  for ( const [key, page] of Object.entries({ gm, pl }) ) {
    try {
      await until(page, `(chTestSounds.length >= ${cues}) && chTestSounds.every(e => e.done)`);
    } catch {
      throw new Error(`the ${key} client played ${await ev(page, `return JSON.stringify(chTestSounds);`)}, not ${cues} cue(s)`);
    }
    heard[key] = await ev(page, `return chTestSounds.map(({ kind, src, origin, radius, volume, at }) => ({ kind,
      cue: src.split("/").pop().replace(/\\.ogg$/, ""), origin, radius, volume, at }));`);
  }
  return heard;
}

/**
 * Set the reach of the harvest sounds, in grid spaces.
 * @param {object} t
 * @param {number} spaces
 */
const setReach = ({ gm, ev }, spaces) => ev(gm, `await game.settings.set("canvas-harvest", "soundRadius", ${spaces});`);

/**
 * Light the scene, so the test token's sight reaches the spots. Returns whether it was lit before.
 * @param {object} t
 * @returns {Promise<boolean>}
 */
const lightScene = ({ gm, ev }) => ev(gm, `const light = canvas.scene.environment.globalLight.enabled;
  await canvas.scene.update({ "environment.globalLight.enabled": true });
  return light;`);

/**
 * Remove the strikers the sound cases placed, tokens and actor.
 * @param {object} t
 */
const removeStrikers = ({ gm, ev }) => ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Token",
    canvas.scene.tokens.filter(t => t.name === "CH Test Striker").map(t => t.id));
  await game.actors.getName("CH Test Striker")?.delete();`);

export const cases = [
  {
    name: "a strike spends one, drops the item and posts the card",
    async run(t) {
      const { gm, ev, wait } = t;
      await setLeft(t, 5);
      const tiles = await ev(gm, `return canvas.scene.tiles.size;`);
      const ok = await strike(t);
      await wait(1500);
      assert(ok === true, `harvest returned ${ok}: ${await t.notes(t.pl)}`);
      assert(await left(t) === 4, "the spot did not drop to 4 strikes left");
      assert(await ev(gm, `return canvas.scene.tiles.size;`) === tiles + 1, "no item landed on the map");
      const card = await ev(gm, `return game.messages.contents.at(-1)?.content ?? "";`);
      assert(card.includes("ch-chat-card") && card.includes("CH Test Vein"), "no harvest card in the chat");
    }
  },
  {
    name: "preChatMessage restyles the card or drops it, and the flags survive",
    async run(t) {
      const { gm, ev, wait } = t;
      await setLeft(t, 5);
      await ev(gm, `globalThis.chTestChat = [];
        globalThis.chTestHook = Hooks.on("canvas-harvest.preChatMessage", (messageData, context) => {
          chTestChat.push({ event: context.event, token: context.token?.documentName, spot: context.spot?.documentName,
            user: context.user?.documentName, tags: Array.isArray(context.resource?.tags) });
          messageData.content = "<p class='ch-test-card'>mine</p>";
          messageData.flags = {};
          return !globalThis.chTestDrop;
        });`);
      try {
        const before = await ev(gm, `return game.messages.size;`);
        assert(await strike(t) === true, "the strike failed");
        await wait(1500);
        const msg = await ev(gm, `const m = game.messages.contents.at(-1);
          return { content: m.content, flags: m.flags["canvas-harvest"], calls: chTestChat };`);
        assert(msg.content.includes("ch-test-card"), "the listener's content was not used");
        const f = msg.flags ?? {};
        assert(f.event === "harvest" && f.actorName && f.resource?.name === "CH Test Vein" && !("verb" in f.resource)
          && f.items?.[0]?.quantity === 1 && f.items[0].uuid && f.left === 4 && f.spotUuid, `wrong flags: ${JSON.stringify(f)}`);
        const [call] = msg.calls;
        assert(call?.event === "harvest" && call.token === "Token" && call.spot === "RegionBehavior" && call.user === "User" && call.tags,
          `wrong context: ${JSON.stringify(msg.calls)}`);
        await ev(gm, `globalThis.chTestDrop = true;`);
        assert(await strike(t) === true, "the second strike failed");
        await wait(1500);
        assert(await ev(gm, `return game.messages.size;`) === before + 1, "a cancelled message was posted");
      } finally {
        await ev(gm, `Hooks.off("canvas-harvest.preChatMessage", chTestHook); delete globalThis.chTestDrop;`);
      }
    }
  },
  {
    name: "a strike Canvas Loot fails to deliver is given back",
    expectErrors: /Could not drop the items on the map/,
    async run(t) {
      const { gm, pl, ev, wait, notes } = t;
      await setLeft(t, 5);
      await ev(gm, `const api = game.modules.get("canvas-loot").api; api.__ch = api.getQuantityPath;
        api.getQuantityPath = () => { throw new Error("test: Canvas Loot broke"); };`);
      try {
        const ok = await strike(t);
        await wait(1000);
        assert(ok === false, "the strike was reported as done");
        assert(await left(t) === 5, "the strike was spent");
        const expected = await ev(pl, `return game.i18n.localize("CANVASHARVEST.Errors.Failed");`);
        assert((await notes(pl)).includes(expected), "the player was not told the strike was given back");
      } finally {
        await ev(gm, `const api = game.modules.get("canvas-loot").api; api.getQuantityPath = api.__ch; delete api.__ch;`);
      }
    }
  },
  {
    name: "a refusal made on the GM reads in the player's language",
    async run(t) {
      const { gm, pl, ev, wait, notes, ids } = t;
      await setLeft(t, 5);
      // A Tool Set only the GM's client has filled, so only the GM's check refuses; and the GM's
      // client words its messages differently, as if it ran another language.
      await patchResource(t, { toolSets: ["strike"] });
      await ev(gm, `const E = game.i18n.translations.CANVASHARVEST.Errors; E.__ch = { NeedTool: E.NeedTool, AnyTool: E.AnyTool };
        E.NeedTool = "GM-LANG {tools}"; E.AnyTool = "GM-LANG {verb}";
        CanvasHarvest.addTools("ch-test", "strike", [${JSON.stringify(ids.pick)}]);`);
      try {
        const ok = await strike(t);
        await wait(800);
        assert(ok === false, "the strike went through without the tool");
        assert(await left(t) === 5, "a refused strike was spent");
        const expected = await ev(pl, `return game.i18n.localize("CANVASHARVEST.Errors.NeedTool", {
          tools: game.i18n.localize("CANVASHARVEST.Errors.AnyTool", { verb: game.i18n.localize("CANVASHARVEST.Verb.strike") }) });`);
        const shown = await notes(pl);
        assert(shown.includes(expected), `the player read ${JSON.stringify(shown)}, not ${JSON.stringify(expected)}`);
      } finally {
        await ev(gm, `const E = game.i18n.translations.CANVASHARVEST.Errors; Object.assign(E, E.__ch); delete E.__ch;
          CanvasHarvest.removeTools("ch-test");`);
        await patchResource(t, { toolSets: [] });
      }
    }
  },
  {
    name: "a tool is matched by a hand-made copy of it",
    async run(t) {
      const { gm, pl, ev, wait, notes, until, ids } = t;
      await setLeft(t, 5);
      await patchResource(t, { tools: `[${refOf(ids.pick)}]` });
      try {
        assert(await strike(t) === false, "the strike went through without the tool");
        await wait(500);
        const pick = await ev(gm, `return fromUuidSync(${JSON.stringify(ids.pick)}).name;`);
        assert((await notes(pl)).some(n => n.includes(pick)), "the refusal does not name the tool");
        // Same type, the name in other case: what a GM typing it on a sheet would make.
        await ev(gm, `const i = fromUuidSync(${JSON.stringify(ids.pick)});
          await game.actors.get(${JSON.stringify(ids.actor)}).createEmbeddedDocuments("Item", [{ name: i.name.toLowerCase(), type: i.type }]);`);
        await until(pl, `fromUuidSync(${JSON.stringify(ids.token)}).actor.items.size > 0`);
        assert(await strike(t) === true, `the copy was not taken for the tool: ${await notes(pl)}`);
        await wait(1500);
        assert(await left(t) === 4, "the strike with the copy was not spent");
      } finally {
        await ev(gm, `const a = game.actors.get(${JSON.stringify(ids.actor)}); await a.deleteEmbeddedDocuments("Item", a.items.map(i => i.id));`);
        await patchResource(t, { tools: [] });
      }
    }
  },
  {
    name: "the Resource Book takes dropped items and refuses twins and sheet-only items",
    async run(t) {
      const { gm, ev, notes, ids } = t;
      const r = await ev(gm, `const book = await CanvasHarvest.openBook(); await new Promise(r => setTimeout(r, 600));
        book.element.querySelector('.ch-entry[data-resource-id=${JSON.stringify(ids.resource)}]').click();
        await new Promise(r => setTimeout(r, 600));
        ${dropItem(`book.element.querySelector('[data-drop="tool"]')`, JSON.stringify(ids.pick))}
        ${dropItem(`book.element.querySelectorAll('[data-drop="drop"]')[book.draft.drops.length]`, JSON.stringify(ids.gem))}
        const draft = { tools: book.draft.tools.map(t => t.uuid), drops: book.draft.drops.map(d => d.item.uuid), dirty: book.dirty };
        book.dirty = false; await book.close();
        return draft;`);
      assert(r.tools.length === 1 && r.tools[0] === ids.pick, "the tool was not taken");
      assert(r.drops.length === 2 && r.drops[1] === ids.gem, "the drop was not taken");
      assert(r.dirty, "the book did not mark the draft unsaved");
      const twin = await ev(gm, `const book = await CanvasHarvest.openBook(); await new Promise(r => setTimeout(r, 600));
        book.element.querySelector('.ch-entry[data-resource-id=${JSON.stringify(ids.resource)}]').click();
        await new Promise(r => setTimeout(r, 600));
        ${dropItem(`book.element.querySelectorAll('[data-drop="drop"]')[1]`, JSON.stringify(ids.ore))}
        const [sheetOnly] = await game.actors.get(${JSON.stringify(ids.actor)}).createEmbeddedDocuments("Item", [{ name: "CH Sheet Only", type: fromUuidSync(${JSON.stringify(ids.ore)}).type }]);
        ${dropItem(`book.element.querySelectorAll('[data-drop="tool"]')[0]`, "sheetOnly.uuid")}
        await sheetOnly.delete();
        const tools = book.draft.tools.length; book.dirty = false; await book.close();
        return tools;`);
      assert(twin === 0, "an item that exists only on a sheet was taken as a tool");
      const shown = await notes(gm);
      assert(shown.some(n => n.includes("CH Test Ore")), "the twin drop was not refused");
      assert(shown.some(n => n.includes("CH Sheet Only")), "the sheet-only item was not refused");
    }
  },
  {
    name: "an item name holding HTML is shown as text in a warning",
    async run(t) {
      const { gm, ev, notes } = t;
      const name = "<b>CH Bold</b> & Co";
      await ev(gm, `const item = game.items.getName(${JSON.stringify(name)}) ?? await Item.implementation.create({ name: ${JSON.stringify(name)},
          type: Item.TYPES.find(t => t !== "base") });
        const { ToolSetsConfig } = await import("/modules/canvas-harvest/scripts/apps/tool-sets-config.js");
        const app = new ToolSetsConfig(); await app.render({ force: true }); await new Promise(r => setTimeout(r, 600));
        const zone = () => app.element.querySelector('[data-drop-set="gather"]');
        ${dropItem("zone()", "item.uuid")}
        ${dropItem("zone()", "item.uuid")}
        const sets = foundry.utils.deepClone(game.settings.get("canvas-harvest", "toolSets"));
        sets.gather = sets.gather.filter(r => r.uuid !== item.uuid);
        await game.settings.set("canvas-harvest", "toolSets", sets);
        await app.close();`);
      const shown = await notes(gm);
      assert(shown.some(n => n.includes(name)), `the name did not read as typed: ${JSON.stringify(shown)}`);
    }
  },
  {
    name: "a settings menu brings the open window forward instead of replacing it",
    async run(t) {
      const { gm, ev } = t;
      const r = await ev(gm, `const book = await CanvasHarvest.openBook(); await new Promise(r => setTimeout(r, 600));
        const input = book.element.querySelector('.ch-book-detail [name="name"]');
        input.value = "CH unsaved edit"; input.dispatchEvent(new Event("input"));
        const out = {};
        await new (game.settings.menus.get("canvas-harvest.resourceBook").type)().render(true);
        await new Promise(r => setTimeout(r, 600));
        out.resourceBook = foundry.applications.instances.get(book.id) === book && book.element.isConnected
          && (book.draft.name === "CH unsaved edit") && (document.querySelectorAll("#" + book.id).length === 1);
        book.dirty = false; await book.close();
        for ( const key of ["toolSets", "sounds"] ) {
          const App = game.settings.menus.get("canvas-harvest." + key).type;
          const first = new App(); await first.render(true); await new Promise(r => setTimeout(r, 500));
          await new App().render(true); await new Promise(r => setTimeout(r, 500));
          out[key] = foundry.applications.instances.get(first.id) === first && first.element.isConnected
            && (document.querySelectorAll("#" + first.id).length === 1);
          await first.close();
        }
        return out;`);
      for ( const [key, ok] of Object.entries(r) ) assert(ok, `${key} was replaced by a second window`);
    }
  },
  {
    name: "the token a spot is attached to neither lights its medallion nor strikes it",
    async run(t) {
      const { gm, ev, wait, notes, ids } = t;
      const r = await ev(gm, `const carrier = fromUuidSync(${JSON.stringify(ids.token)});
        const region = await CanvasHarvest.createSpot({ resource: ${JSON.stringify(ids.resource)}, token: carrier });
        // A second token standing in the attached spot, over the carrier: the one that should strike.
        const [other] = await canvas.scene.createEmbeddedDocuments("Token", [{ ...carrier.toObject(), _id: undefined, name: "CH Test Hunter",
          x: carrier.x + canvas.grid.size, y: carrier.y }]);
        await new Promise(r => setTimeout(r, 1000));
        const behavior = region.behaviors.contents[0];
        const control = canvas.controls.children.flatMap(c => c.children ?? []).find(c => c.behavior === behavior);
        // A strike takes its blows and the drop's flight before the count moves, longer on a slow client.
        const click = async () => { const before = behavior.system.left;
          control.emit("pointerdown", { button: 0, shiftKey: false, stopPropagation() {} });
          for ( let i = 0; (i < 50) && (behavior.system.left === before); i++ ) await new Promise(r => setTimeout(r, 200)); };
        const out = {};
        carrier.object.control({ releaseOthers: true }); await new Promise(r => setTimeout(r, 300));
        out.carrierOnly = { ready: control.ready, alpha: control.alpha };
        // The carrier first, so a pick of the first token in the spot would take it.
        other.object.control({ releaseOthers: false }); await new Promise(r => setTimeout(r, 300));
        out.both = { ready: control.ready, before: behavior.system.left };
        await click();
        out.both.after = behavior.system.left;
        canvas.tokens.releaseAll();
        await canvas.scene.deleteEmbeddedDocuments("Token", [other.id]);
        await region.delete();
        return out;`);
      assert(!r.carrierOnly.ready, "the medallion lit for the token it is attached to");
      assert(r.both.ready, "the medallion did not light for a token standing in the spot");
      assert(r.both.after === r.both.before - 1, `the strike went to the carrier: ${await notes(gm)}`);
    }
  },
  {
    name: "only the medallion's disc takes a click, not the pill under it",
    async run(t) {
      const { gm, ev, ids } = t;
      const r = await ev(gm, `canvas.tokens.activate(); canvas.tokens.releaseAll();
        const behavior = fromUuidSync(${JSON.stringify(ids.spot)});
        const control = canvas.controls.children.flatMap(c => c.children ?? []).find(c => c.behavior === behavior);
        canvas.animatePan({ x: control.x, y: control.y, scale: 1, duration: 0 }); await new Promise(r => setTimeout(r, 600));
        // What a click at a point of the medallion lands on: the medallion, a token, or something else.
        const hit = (dx, dy) => {
          const p = canvas.stage.worldTransform.apply({ x: control.x + dx, y: control.y + dy });
          for ( let o = canvas.app.renderer.events.rootBoundary.hitTest(p.x, p.y); o; o = o.parent ) {
            if ( o === control ) return "medallion";
            if ( o.document?.documentName === "Token" ) return "token";
          }
          return "other";
        };
        // Every point of the pill outside the disc, sorted by whether a token lies under it.
        const r = control.radius;
        const pill = control.pill.getLocalBounds();
        const token = fromUuidSync(${JSON.stringify(ids.token)}).object.bounds;
        const out = { centre: hit(0, 0), overToken: [], elsewhere: [], hasPill: control.pill.visible };
        for ( let dx = pill.x + 2; dx < pill.x + pill.width - 2; dx += 3 ) {
          for ( let dy = pill.y + 2; dy < pill.y + pill.height - 2; dy += 3 ) {
            if ( Math.hypot(dx, dy) <= r + 1 ) continue;
            (token.contains(control.x + dx, control.y + dy) ? out.overToken : out.elsewhere).push(hit(dx, dy));
          }
        }
        return out;`);
      assert(r.hasPill, "the medallion has no pill to test");
      assert(r.centre === "medallion", `a click on the disc landed on ${r.centre}`);
      assert(r.overToken.length && r.elsewhere.length, "the pill does not reach both over and past the token");
      assert(!r.elsewhere.includes("medallion"), "a click on the pill still lands on the medallion");
      assert(r.overToken.every(h => h === "token"), `a click on the pill over the token lands on ${[...new Set(r.overToken)]}`);
    }
  },
  {
    name: "saving a spot's sheet keeps a resource that is gone",
    async run(t) {
      const { gm, ev, ids } = t;
      const r = await ev(gm, `const b = fromUuidSync(${JSON.stringify(ids.spot)});
        await b.update({ "system.resource": "chTestMissing001" });
        await b.update({ "system.remaining": 3 });
        await b.sheet.render({ force: true }); await new Promise(r => setTimeout(r, 800));
        await b.sheet.submit(); await new Promise(r => setTimeout(r, 500)); await b.sheet.close();
        const after = { resource: b.system.resource, remaining: b.system.remaining };
        await b.update({ "system.resource": ${JSON.stringify(ids.resource)}, "system.remaining": 10 });
        return after;`);
      assert(r.resource === "chTestMissing001", `the resource became ${JSON.stringify(r.resource)}`);
      assert(r.remaining === 3, `the strikes left became ${r.remaining}`);
    }
  },
  {
    name: "vision: a player sees a medallion only where their token sees it",
    async run(t) {
      const { gm, pl, ev, ids } = t;
      const token = JSON.stringify(ids.token);
      const range = await ev(gm, `return fromUuidSync(${token}).sight.range;`);
      const setup = await wideSpot(t);
      const shown = (state, where) => expectShown(t, pl, setup.region, state, where);
      try {
        await ev(pl, `fromUuidSync(${token}).object.control({ releaseOthers: true });`);
        await shown(true, "the token stands in the spot, the medallion in plain sight");
        await ev(gm, `await canvas.scene.createEmbeddedDocuments("Wall", [{ c: ${JSON.stringify(setup.wall)} }]);`);
        await shown(false, "a wall stands between the token and the medallion");
        await ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Wall", canvas.scene.walls.map(w => w.id));`);
        await shown(true, "the wall is gone");
        await ev(gm, `await canvas.scene.update({ "environment.globalLight.enabled": false });`);
        await shown(false, "the scene is unlit and the token has no darkvision");
        await ev(gm, `await fromUuidSync(${token}).update({ "sight.range": 30 * canvas.grid.distance });`);
        await shown(true, "the token has darkvision");
        await ev(gm, `await fromUuidSync(${token}).update({ "sight.range": ${range} });
          await canvas.scene.update({ "environment.globalLight.enabled": true });`);
        await shown(true, "the scene is lit again");
        await ev(gm, `await fromUuidSync(${token}).actor.toggleStatusEffect(CONFIG.specialStatusEffects.BLIND, { active: true });`);
        await shown(false, "the token is blinded");
      } finally {
        await ev(gm, `const token = fromUuidSync(${token});
          await token.actor.toggleStatusEffect(CONFIG.specialStatusEffects.BLIND, { active: false });
          await token.update({ "sight.range": ${range} });`);
        await resetScene(t, setup.light);
      }
    }
  },
  {
    name: "vision: the GM sees every spot, or what a selected token sees",
    async run(t) {
      const { gm, ev, ids } = t;
      const setup = await wideSpot(t);
      try {
        const r = await ev(gm, `const wait = ms => new Promise(r => setTimeout(r, ms));
          const token = fromUuidSync(${JSON.stringify(ids.token)});
          const c = token.getCenterPoint();
          // A spot beside the token, which it sees without standing in it.
          const aside = await CanvasHarvest.createSpot({ resource: ${JSON.stringify(ids.resource)}, x: c.x - (2 * token.object.w), y: c.y, margin: 0 });
          await canvas.scene.createEmbeddedDocuments("Wall", [{ c: ${JSON.stringify(setup.wall)} }]);
          const spots = { near: ${JSON.stringify(ids.region)}, far: ${JSON.stringify(setup.region)}, aside: aside.id };
          const read = () => Object.fromEntries(Object.entries(spots).map(([key, id]) => {
            const m = canvas.controls.children.flatMap(c => c.children ?? []).find(c => c.region?.id === id);
            return [key, { visible: m.visible, alpha: m.alpha,
              sees: canvas.visibility.testVisibility({ x: m.x, y: m.y }, { tolerance: m.radius / 2 }) }];
          }));
          canvas.tokens.releaseAll(); await wait(800);
          const none = read();
          token.object.control({ releaseOthers: true }); await wait(1000);
          const selected = read();
          canvas.tokens.releaseAll();
          return { none, selected };`);
        for ( const [key, m] of Object.entries(r.none) ) {
          assert(m.visible && (m.alpha < 1), `with nothing selected, the ${key} spot reads ${JSON.stringify(m)}`);
        }
        const { near, far, aside } = r.selected;
        assert(near.visible && (near.alpha === 1), `the spot the token stands in reads ${JSON.stringify(near)}`);
        assert(!far.visible, "the spot behind the wall is shown");
        assert(aside.visible && (aside.alpha < 1), `the spot the token sees but stands out of reads ${JSON.stringify(aside)}`);
        for ( const [key, m] of Object.entries(r.selected) ) {
          assert(m.visible === m.sees, `the ${key} spot is ${m.visible ? "shown" : "hidden"}, but the token ${m.sees ? "sees" : "doesn't see"} it`);
        }
      } finally {
        await resetScene(t, setup.light);
      }
    }
  },
  {
    name: "vision: a medallion is hidden from another Level and under a floor, shown on its own floor",
    async run(t) {
      const { gm, pl, ev, until, ids } = t;
      const token = JSON.stringify(ids.token);
      const s = await ev(gm, `const light = canvas.scene.environment.globalLight.enabled;
        await canvas.scene.update({ "environment.globalLight.enabled": true });
        const lower = canvas.level;
        const floor = lower.elevation.top;
        const [upper] = await canvas.scene.createEmbeddedDocuments("Level", [{ name: "CH Test Upper",
          elevation: { bottom: floor, top: 2 * floor }, visibility: { levels: [lower.id] } }]);
        const token = fromUuidSync(${token});
        return { light, floor, lower: lower.id, upper: upper.id, x: token.x, y: token.y, elevation: token.elevation };`);
      const lower = JSON.stringify(s.lower);
      const upper = JSON.stringify(s.upper);
      try {
        await until(pl, `canvas.ready && (canvas.scene.levels.size === 2)`);
        await ev(pl, `fromUuidSync(${token}).object.control({ releaseOthers: true });`);
        await expectShown(t, pl, ids.region, true, "the token stands in the spot on its Level, a Level above nobody views");
        // Not awaited: the view redraws the canvas, which the case waits on instead.
        await ev(pl, `canvas.scene.view({ level: ${upper} });`);
        await until(pl, `canvas.ready && (canvas.level.id === ${upper})`, 60000);
        await expectShown(t, pl, ids.region, false, "the player views the Level above");

        // Core gives a Level no floor of its own: a Define Surface region is what stops sight between
        // the two. One spot reaches both Levels but stays under that floor, one reaches up through it.
        const r = await ev(gm, `const levels = [${lower}, ${upper}];
          const token = fromUuidSync(${token});
          const c = token.getCenterPoint();
          const { width, height } = canvas.dimensions;
          await canvas.scene.createEmbeddedDocuments("Region", [{ name: "CH Test Floor", levels: [${upper}],
            elevation: { bottom: ${s.floor}, top: ${s.floor} }, shapes: [{ type: "rectangle", x: 0, y: 0, width, height }],
            behaviors: [{ type: "defineSurface", system: { placement: "bottom" } }] }]);
          const below = await CanvasHarvest.createSpot({ resource: ${JSON.stringify(ids.resource)}, x: c.x + (2 * token.object.w), y: c.y, margin: 1 });
          await below.update({ levels, elevation: { bottom: null, top: ${s.floor} / 2 } });
          const tall = await CanvasHarvest.createSpot({ resource: ${JSON.stringify(ids.resource)}, x: c.x, y: c.y, margin: 2 });
          await tall.update({ levels });
          await token.update({ level: ${upper}, elevation: ${s.floor} }, { animate: false });
          return { below: below.id, tall: tall.id };`);
        await until(pl, `fromUuidSync(${token}).object?.document.level === ${upper}`);
        await ev(pl, `fromUuidSync(${token}).object.control({ releaseOthers: true });`);
        await expectShown(t, pl, r.tall, true, "the player's token stands on the floor, in a spot reaching up through it");
        await ev(gm, `canvas.scene.view({ level: ${upper}, controlledTokens: [fromUuidSync(${token}).id] });`);
        await until(gm, `canvas.ready && (canvas.level.id === ${upper}) && (canvas.tokens.controlled.length === 1)`, 60000);
        await expectShown(t, gm, r.tall, true, "the GM's token stands on the floor, in a spot reaching up through it");
        await expectShown(t, gm, r.below, false, "the GM's token looks down at a spot under the floor");
        await ev(gm, `await canvas.scene.regions.getName("CH Test Floor").behaviors.contents[0].update({ disabled: true });`);
        await expectShown(t, gm, r.below, true, "the floor is switched off");
      } finally {
        // The floor goes first: while it stands it blocks the token's way back down, and deleting
        // the Level would take the token with it.
        await ev(gm, `canvas.tokens.releaseAll();`);
        await resetScene(t, s.light);
        await ev(gm, `await fromUuidSync(${token}).update({ level: ${lower}, elevation: ${s.elevation}, x: ${s.x}, y: ${s.y} }, { animate: false });`);
        for ( const page of [gm, pl] ) {
          await ev(page, `if ( canvas.level?.id !== ${lower} ) canvas.scene.view({ level: ${lower} });`);
          await until(page, `canvas.ready && (canvas.level?.id === ${lower})`, 60000);
        }
        await ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Level", [${upper}]);`);
      }
    }
  },
  {
    name: "vision: a strike throws sparks only for a player who sees the spot",
    async run(t) {
      const { gm, pl, ev, until, wait, ids } = t;
      const token = JSON.stringify(ids.token);
      const setup = await wideSpot(t);
      const spot = JSON.stringify(setup.spot);
      let striker = null;
      try {
        // A token at the medallion's end of the spot, which the player neither owns nor sees through.
        striker = await ev(gm, `const token = fromUuidSync(${token});
          const actor = await Actor.implementation.create({ name: "CH Test Striker", type: token.actor.type });
          const m = ${medallion(setup.region)};
          const w = actor.prototypeToken.width * canvas.grid.sizeX;
          const h = actor.prototypeToken.height * canvas.grid.sizeY;
          const data = (await actor.getTokenDocument({ x: m.x - (w / 2), y: m.y - (h / 2) })).toObject();
          const [striker] = await canvas.scene.createEmbeddedDocuments("Token", [data]);
          return { token: striker.uuid, actor: actor.id };`);
        await ev(pl, `fromUuidSync(${token}).object.control({ releaseOthers: true });`);
        await ev(gm, `await canvas.scene.createEmbeddedDocuments("Wall", [{ c: ${JSON.stringify(setup.wall)} }]);`);
        await expectShown(t, pl, setup.region, false, "a wall stands between the player's token and the medallion");
        // The particles the player's client threw during one strike by the other token.
        const strike = async () => {
          const spawned = `canvas.controls.children.find(c => "spawned" in c).spawned`;
          const before = await ev(pl, `return ${spawned};`);
          const left = await ev(pl, `return fromUuidSync(${spot}).system.left;`);
          const ok = await ev(gm, `return CanvasHarvest.harvest(${JSON.stringify(striker.token)}, ${spot});`);
          assert(ok === true, `the strike failed: ${await t.notes(gm)}`);
          await until(pl, `fromUuidSync(${spot}).system.left < ${left}`);
          // The three blows play over STRIKE_MS after the update lands.
          await wait(1500);
          return (await ev(pl, `return ${spawned};`)) - before;
        };
        assert(await strike() === 0, "sparks flew on the client of a player who cannot see the spot");
        await ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Wall", canvas.scene.walls.map(w => w.id));`);
        await expectShown(t, pl, setup.region, true, "the wall is gone");
        assert(await strike() > 0, "no sparks flew for a player who sees the spot");
      } finally {
        if ( striker ) {
          await ev(gm, `await fromUuidSync(${JSON.stringify(striker.token)})?.delete();
            await game.actors.get(${JSON.stringify(striker.actor)})?.delete();`);
        }
        await resetScene(t, setup.light);
      }
    }
  },
  {
    name: "sound: a strike is heard within earshot, not beyond it, through a wall or past a shorter reach",
    async run(t) {
      const { gm, pl, ev, ids } = t;
      const token = JSON.stringify(ids.token);
      const light = await lightScene(t);
      const reach = await ev(gm, `return game.settings.get("canvas-harvest", "soundRadius");`);
      try {
        await setReach(t, 12);
        for ( const page of [gm, pl] ) await ev(page, recordSounds);
        await ev(pl, `fromUuidSync(${token}).object.control({ releaseOthers: true });`);
        const near = await placeStriker(t, 3);
        const far = await placeStriker(t, 20);
        const elevation = await ev(gm, `return fromUuidSync(${JSON.stringify(near.token)}).elevation;`);

        let heard = await strikeHeard(t, near);
        const [cue] = heard.pl;
        assert((heard.pl.length === 1) && (cue.kind === "positional") && (cue.volume > 0),
          `3 spaces off, the player's client played ${JSON.stringify(heard.pl)}`);
        assert((cue.origin.x === near.medallion.x) && (cue.origin.y === near.medallion.y) && (cue.origin.elevation === elevation),
          `the strike played from ${JSON.stringify(cue.origin)}, not the medallion at the striker's elevation`);
        heard = await strikeHeard(t, far);
        assert(heard.pl[0].volume === null, `20 spaces off, past a reach of 12, the player's client played ${JSON.stringify(heard.pl)}`);

        await ev(gm, `const l = fromUuidSync(${token}).getListenerPosition();
          const x = Math.round((l.x + ${near.medallion.x}) / 2);
          const h = 6 * canvas.grid.size;
          await canvas.scene.createEmbeddedDocuments("Wall", [{ c: [x, l.y - h, x, l.y + h] }]);`);
        heard = await strikeHeard(t, near);
        assert(heard.pl[0].volume === null, `through a wall, the player's client played ${JSON.stringify(heard.pl)}`);
        await ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Wall", canvas.scene.walls.map(w => w.id));`);

        await setReach(t, 2);
        heard = await strikeHeard(t, near);
        const distance = await ev(pl, `return canvas.grid.distance;`);
        assert((heard.pl[0].radius === 2 * distance) && (heard.pl[0].volume === null),
          `with a reach of 2, the player's client played ${JSON.stringify(heard.pl)}`);
      } finally {
        await ev(pl, `canvas.tokens.releaseAll();`);
        await setReach(t, reach);
        await removeStrikers(t);
        await resetScene(t, light);
      }
    }
  },
  {
    name: "sound: the GM hears every strike with nothing selected, or as a selected token hears it",
    async run(t) {
      const { gm, pl, ev, ids } = t;
      const light = await lightScene(t);
      const reach = await ev(gm, `return game.settings.get("canvas-harvest", "soundRadius");`);
      try {
        await setReach(t, 12);
        for ( const page of [gm, pl] ) await ev(page, recordSounds);
        await ev(pl, `fromUuidSync(${JSON.stringify(ids.token)}).object.control({ releaseOthers: true });`);
        const near = await placeStriker(t, 3);
        const far = await placeStriker(t, 20);
        const volume = await ev(gm, `canvas.tokens.releaseAll(); return game.settings.get("canvas-harvest", "soundVolume");`);
        let heard = await strikeHeard(t, far);
        assert((heard.gm.length === 1) && (heard.gm[0].kind === "direct") && (heard.gm[0].volume === volume),
          `with nothing selected, the GM's client played ${JSON.stringify(heard.gm)} for a strike 20 spaces from any token`);
        await ev(gm, `fromUuidSync(${JSON.stringify(ids.token)}).object.control({ releaseOthers: true });`);
        heard = await strikeHeard(t, near);
        assert((heard.gm[0].kind === "positional") && (heard.gm[0].volume > 0) && (heard.gm[0].volume === heard.pl[0].volume),
          `with the test token selected, 3 spaces off, the GM played ${JSON.stringify(heard.gm)} and the player ${JSON.stringify(heard.pl)}`);
        heard = await strikeHeard(t, far);
        assert(heard.gm[0].volume === null, `with the test token selected, 20 spaces off, the GM's client played ${JSON.stringify(heard.gm)}`);
      } finally {
        for ( const page of [gm, pl] ) await ev(page, `canvas.tokens.releaseAll();`);
        await setReach(t, reach);
        await removeStrikers(t);
        await resetScene(t, light);
      }
    }
  },
  {
    name: "sound: a depleting strike plays its cue after the blow, from the same spot",
    async run(t) {
      const { gm, pl, ev, ids } = t;
      const light = await lightScene(t);
      try {
        for ( const page of [gm, pl] ) await ev(page, recordSounds);
        await ev(pl, `fromUuidSync(${JSON.stringify(ids.token)}).object.control({ releaseOthers: true });`);
        const near = await placeStriker(t, 3);
        await ev(gm, `await fromUuidSync(${JSON.stringify(near.spot)}).update({ "system.remaining": 1 });`);
        const heard = await strikeHeard(t, near, 2);
        const [blow, depleted] = heard.pl;
        assert((heard.pl.length === 2) && (blow.cue === "strike") && (depleted.cue === "depleted") && (depleted.volume > 0),
          `the player's client played ${JSON.stringify(heard.pl)}`);
        for ( const cue of [blow, depleted] ) {
          assert((cue.kind === "positional") && (cue.origin.x === near.medallion.x) && (cue.origin.y === near.medallion.y),
            `the ${cue.cue} cue played ${cue.kind === "positional" ? `from ${JSON.stringify(cue.origin)}` : "with no position"}, not from the medallion`);
        }
        // Timers run late under software WebGL, so only a lower bound holds.
        assert(depleted.at - blow.at >= 450, `the depleted cue played ${Math.round(depleted.at - blow.at)} ms after the blow`);
      } finally {
        await ev(pl, `canvas.tokens.releaseAll();`);
        await removeStrikers(t);
        await resetScene(t, light);
      }
    }
  },
  {
    name: "sound: a floor between Levels blocks a strike; without one the height counts; its own floor does not",
    async run(t) {
      const { gm, pl, ev, until, ids } = t;
      const token = JSON.stringify(ids.token);
      const light = await lightScene(t);
      const reach = await ev(gm, `return game.settings.get("canvas-harvest", "soundRadius");`);
      const s = await ev(gm, `const lower = canvas.level;
        const floor = lower.elevation.top;
        const [upper] = await canvas.scene.createEmbeddedDocuments("Level", [{ name: "CH Test Upper",
          elevation: { bottom: floor, top: 2 * floor }, visibility: { levels: [lower.id] } }]);
        const token = fromUuidSync(${token});
        return { floor, lower: lower.id, upper: upper.id, x: token.x, y: token.y, elevation: token.elevation };`);
      const lower = JSON.stringify(s.lower);
      const upper = JSON.stringify(s.upper);
      try {
        await until(pl, `canvas.ready && (canvas.scene.levels.size === 2)`);
        for ( const page of [gm, pl] ) await ev(page, recordSounds);
        // Right under where the test token will stand, and three spaces off it on the upper floor.
        const below = await placeStriker(t, 0);
        const beside = await placeStriker(t, 3, { level: s.upper, elevation: s.floor });
        // Core gives a Level no floor of its own: a Define Surface region is what separates the two.
        await ev(gm, `const { width, height } = canvas.dimensions;
          await canvas.scene.createEmbeddedDocuments("Region", [{ name: "CH Test Floor", levels: [${upper}],
            elevation: { bottom: ${s.floor}, top: ${s.floor} }, shapes: [{ type: "rectangle", x: 0, y: 0, width, height }],
            behaviors: [{ type: "defineSurface", system: { placement: "bottom" } }] }]);
          await fromUuidSync(${token}).update({ level: ${upper}, elevation: ${s.floor} }, { animate: false });`);
        await until(pl, `fromUuidSync(${token}).level === ${upper}`);
        // Not awaited: the view redraws the canvas, which the case waits on instead.
        await ev(pl, `canvas.scene.view({ level: ${upper} });`);
        await until(pl, `canvas.ready && (canvas.level.id === ${upper}) && !!fromUuidSync(${token}).object`, 60000);
        await ev(pl, `fromUuidSync(${token}).object.control({ releaseOthers: true });`);
        await until(pl, `canvas.sounds.getListenerPositions().length === 1`);
        // How far above the strike below the player's token listens, in grid spaces.
        const height = await ev(pl, `return canvas.sounds.getListenerPositions()[0].elevation / canvas.grid.distance;`);

        await setReach(t, Math.ceil(height) + 4);
        let heard = await strikeHeard(t, below);
        assert(heard.pl[0].volume === null, `through the floor, the player's client played ${JSON.stringify(heard.pl)}`);
        const floorBehavior = `canvas.scene.regions.getName("CH Test Floor").behaviors.contents[0]`;
        await ev(gm, `await ${floorBehavior}.update({ disabled: true });`);
        heard = await strikeHeard(t, below);
        assert(heard.pl[0].volume > 0, `with no floor, within reach, the player's client played ${JSON.stringify(heard.pl)}`);
        await setReach(t, Math.max(1, Math.floor(height) - 1));
        heard = await strikeHeard(t, below);
        assert(heard.pl[0].volume === null, `with no floor, a reach shorter than the height, the player's client played ${JSON.stringify(heard.pl)}`);

        await ev(gm, `await ${floorBehavior}.update({ disabled: false });`);
        await setReach(t, 12);
        heard = await strikeHeard(t, beside);
        assert(heard.pl[0].volume > 0, `on the floor the player's token stands on, the player's client played ${JSON.stringify(heard.pl)}`);
      } finally {
        // The strikers and the floor go first: deleting the Level would take its tokens with it, and
        // while the floor stands it blocks the token's way back down.
        await ev(pl, `canvas.tokens.releaseAll();`);
        await setReach(t, reach);
        await removeStrikers(t);
        await resetScene(t, light);
        await ev(gm, `await fromUuidSync(${token}).update({ level: ${lower}, elevation: ${s.elevation}, x: ${s.x}, y: ${s.y} }, { animate: false });`);
        for ( const page of [gm, pl] ) {
          await ev(page, `if ( canvas.level?.id !== ${lower} ) canvas.scene.view({ level: ${lower} });`);
          await until(page, `canvas.ready && (canvas.level?.id === ${lower})`, 60000);
        }
        await ev(gm, `await canvas.scene.deleteEmbeddedDocuments("Level", [${upper}]);`);
      }
    }
  },
  {
    name: "sound: Harvest Sounds sets the reach, and its preview still plays directly",
    async run(t) {
      const { gm, ev } = t;
      const reach = await ev(gm, `return game.settings.get("canvas-harvest", "soundRadius");`);
      try {
        const r = await ev(gm, `${recordSounds}
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const app = new (game.settings.menus.get("canvas-harvest.sounds").type)();
          await app.render({ force: true });
          const input = app.element.querySelector("input[name='radius']");
          input.value = 5;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const shown = app.element.querySelector(".ch-radius-value").textContent;
          app.element.querySelector(".ch-sound-row [data-action='preview']").click();
          await wait(500);
          const preview = chTestSounds.map(e => e.kind);
          app.element.querySelector("button[type='submit']").click();
          await wait(1000);
          return { shown, preview, saved: game.settings.get("canvas-harvest", "soundRadius") };`);
        assert(r.shown === "5", `the slider's value reads ${r.shown}`);
        assert(JSON.stringify(r.preview) === JSON.stringify(["direct"]), `the preview played ${JSON.stringify(r.preview)}`);
        assert(r.saved === 5, `the reach saved as ${r.saved}`);
      } finally {
        await setReach(t, reach);
      }
    }
  }
];
