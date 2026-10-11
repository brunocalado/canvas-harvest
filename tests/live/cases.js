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
  }
];
