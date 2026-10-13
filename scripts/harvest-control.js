/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { attachSpotFX, playRefill, playStrike, themeClock } from "./animation.js";
import { api } from "./api.js";
import { MODULE_ID, SPOT_TYPE } from "./constants.js";
import { requestHarvest } from "./harvest.js";
import { readPalette } from "./helpers.js";
import { playCueAt } from "./sound.js";

/** Side of the pre-rendered halo texture, in pixels. */
const HALO_SIZE = 128;

/** How far the GM's medallions fade when no controlled token stands in the spot, or it is disabled. */
const DIM_ALPHA = 0.45;
const DISABLED_ALPHA = 0.25;

let haloTexture = null;

/**
 * A soft white radial glow, drawn once on a 2D canvas and tinted per medallion: a texture with
 * additive blending is cheap, where a PIXI filter would cost a render pass per medallion.
 * @returns {PIXI.Texture}
 */
function halo() {
  if ( haloTexture && !haloTexture.destroyed ) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = HALO_SIZE;
  const ctx = c.getContext("2d");
  const half = HALO_SIZE / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  g.addColorStop(0.45, "rgba(255, 255, 255, 0.35)");
  g.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, HALO_SIZE, HALO_SIZE);
  haloTexture = PIXI.Texture.from(c);
  return haloTexture;
}

/** The spots each token has walked into and arrived in, until it walks out of them. */
const arrived = new WeakMap();

/**
 * Whether a token stands in a region. TokenDocument#regions changes when the move's update lands,
 * before the token animates, so a token coming in only counts once it has finished walking, or the
 * medallion would appear as it sets off. A token already in counts while it walks on inside: every
 * step of a move (each arrow key, each waypoint) animates on its own, and waiting on each one made
 * the medallion blink.
 * @param {Token} token
 * @param {RegionDocument} region
 * @returns {boolean}
 */
function standsIn(token, region) {
  const spots = arrived.get(token);
  if ( !token.document.regions?.has(region) ) {
    spots?.delete(region);
    return false;
  }
  if ( token.movementAnimationPromise ) return !!spots?.has(region);
  if ( spots ) spots.add(region);
  else arrived.set(token, new Set([region]));
  return true;
}

/**
 * Whether this client's tokens see a spot's medallion. Core never tests what sits in canvas.controls
 * against vision (DoorControl does it for doors), so without this a medallion showed behind walls,
 * in darkness and on a blinded token. No sighted token: testVisibility answers true for a GM and
 * false for a player, which is the GM rule we want.
 * @param {HarvestControl} control
 * @returns {boolean}
 */
export function seesSpot(control) {
  if ( !canvas.visibility.tokenVision ) return true;
  // The floor of the viewed Level, raised to where the region starts when it starts higher (a
  // balcony): core compares this elevation with each vision source's, and a surface between them
  // blocks sight. Surfaces come from Define Surface regions; a Level has none of its own.
  const { bottom, top } = control.region.elevation;
  const elevation = Math.clamp(canvas.level.elevation.base, bottom, top);
  return canvas.visibility.testVisibility({ x: control.x, y: control.y, elevation },
    { tolerance: control.radius / 2 });
}

/**
 * The button of one Harvest Spot, living in canvas.controls like core's DoorControl: the controls
 * layer is always interactive, where a Region only receives pointer events on the Regions layer.
 */
export class HarvestControl extends PIXI.Container {
  /** @param {RegionBehavior} behavior   a behavior of type SPOT_TYPE */
  constructor(behavior) {
    super();
    this.behavior = behavior;
    /** "full", "depleted" or "warning" (no resource), as last painted. */
    this.state = null;
    /**
     * A look kept while an effect plays, over the state: "full" until a strike's last blow greys
     * the spot it emptied, "depleted" until a refill heals it.
     */
    this.heldState = null;
    /** The image's tint while it fades between full and depleted. */
    this.imageTint = null;
  }

  /** @returns {number} the image's tint on a depleted spot: greyed by tint, never a filter */
  get greyTint() {
    return 0x6a6a6a;
  }

  /** @returns {RegionDocument} */
  get region() {
    return this.behavior.parent;
  }

  /** @returns {number} the medallion's radius: 0.7 of a grid space across, as the scene asked for it */
  get radius() {
    // uiScale reads the grid size in the scene's source, not the prepared one: crucible forces 20 px
    // spaces whatever the scene asks, and its tokens cover several of them.
    return 35 * canvas.dimensions.uiScale;
  }

  /**
   * Build the children once and lay them out; a redraw reuses them.
   * @returns {this}
   */
  draw() {
    const r = this.radius;
    this.eventMode = "static";
    this.interactiveChildren = false;
    this.cursor = "pointer";

    // The medallion itself swings and shakes in a strike; the verb pill under it stays put.
    this.body ??= this.addChild(new PIXI.Container());
    this.halo ??= this.body.addChild(new PIXI.Sprite(halo()));
    this.halo.anchor.set(0.5);
    this.halo.width = this.halo.height = r * 4.2;
    this.haloScale = this.halo.scale.x;
    this.halo.blendMode = PIXI.BLEND_MODES.ADD;

    this.disc ??= this.body.addChild(new PIXI.Graphics());
    this.disc.clear().beginFill(0x000000).drawCircle(0, 0, r).endFill();

    this.image ??= this.body.addChild(new PIXI.Sprite());
    this.image.anchor.set(0.5);
    this.imageMask ??= this.body.addChild(new PIXI.Graphics());
    this.imageMask.clear().beginFill(0xffffff).drawCircle(0, 0, r * 0.86).endFill();
    this.image.mask = this.imageMask;
    this.#loadImage(this.behavior.system.resourceData?.img);

    this.ring ??= this.body.addChild(new PIXI.Graphics());
    this.mark ??= this.body.addChild(new foundry.canvas.containers.PreciseText("!"));
    this.mark.anchor.set(0.5);
    this.pill ??= this.addChild(new PIXI.Graphics());
    this.label ??= this.addChild(new foundry.canvas.containers.PreciseText(""));
    this.label.anchor.set(0.5);

    this.removeAllListeners();
    this.on("pointerover", this.#onPointerOver)
      .on("pointerout", this.#onPointerOut)
      .on("pointerdown", this.#onPointerDown)
      .on("rightclick", this.#onRightClick);
    this.scale.set(1);
    this.hovered = false;
    this.reposition();
    this.refreshState();
    return this;
  }

  /**
   * Fit the resource's image into the disc once its texture has loaded.
   * @param {string} [src]
   */
  async #loadImage(src) {
    this.imageSrc = src;
    if ( !src ) {
      this.image.texture = PIXI.Texture.EMPTY;
      return;
    }
    const texture = await foundry.canvas.loadTexture(src);
    // A redraw or a scene change may have come first.
    if ( this.destroyed || (this.imageSrc !== src) || !texture ) return;
    this.image.texture = texture;
    // A webm loads paused and with sound; it plays on a loop, muted. Spots sharing a resource share
    // one video, so this only restarts what is already running.
    const video = texture.baseTexture.resource?.source;
    if ( video instanceof HTMLVideoElement ) game.video.play(video, { loop: true, volume: 0 });
    const fit = (this.radius * 1.72) / Math.max(texture.width, texture.height);
    this.image.scale.set(fit);
  }

  /** Sit at the centre of the region's bounds. */
  reposition() {
    const { x, y, width, height } = this.region.bounds;
    this.position.set(x + (width / 2), y + (height / 2));
  }

  /** @returns {boolean} whether this medallion is on screen */
  get isShown() {
    return this.visible && !!this.parent?.visible;
  }

  /** Decide who sees the medallion and how, then paint it. */
  refreshState() {
    const region = this.region;
    const spot = this.behavior.system;
    const resource = spot.resourceData;
    // The token a spot is attached to stands in it but never works it (checkHarvest refuses it).
    this.inside = canvas.tokens.controlled.some(t => (t.document !== region.attachment?.token) && standsIn(t, region));
    this.state = !resource ? "warning" : ((spot.left === 0) ? "depleted" : "full");
    // Whether a click strikes: a full spot, enabled, with one of this user's tokens standing in it.
    this.ready = (this.state === "full") && this.inside && !this.behavior.disabled;
    this.refreshVisibility();
    if ( game.user.isGM ) this.alpha = this.behavior.disabled ? DISABLED_ALPHA : (this.inside ? 1 : DIM_ALPHA);
    else this.alpha = 1;
    // A depleted spot doesn't answer players; the GM keeps it, to refill it.
    this.eventMode = ((this.state === "depleted") && !game.user.isGM) ? "none" : "static";
    this.cursor = (this.eventMode === "static") ? "pointer" : null;
    if ( this.imageSrc !== resource?.img ) this.#loadImage(resource?.img);
    this.paint();
  }

  /**
   * Show or hide the medallion for this client, without repainting it: a sight refresh runs this on
   * every medallion. A player sees it only from a token standing in the spot.
   */
  refreshVisibility() {
    const region = this.region;
    const seen = region.viewed && seesSpot(this);
    if ( game.user.isGM ) this.visible = seen;
    else this.visible = seen && this.inside && !!this.behavior.system.resourceData
      && !this.behavior.disabled && !region.hidden;
  }

  /** Draw the ring, the halo, the mark and the pill for the current (or held) state. */
  paint() {
    const spot = this.behavior.system;
    const resource = spot.resourceData;
    const p = readPalette();
    const r = this.radius;
    const s = canvas.dimensions.uiScale;
    const state = (resource && this.heldState) || this.state;
    const hovered = this.hovered;
    const width = r * 0.14;

    this.halo.visible = state === "full";
    this.halo.tint = p.glow;
    this.breathe(performance.now() / 1000);

    this.image.visible = state !== "warning";
    this.image.tint = this.imageTint ?? ((state === "depleted") ? this.greyTint : 0xffffff);

    const ringColor = (state === "warning") ? p.danger : (hovered ? p.trimHi : p.trim);
    this.ring.clear();
    if ( state === "depleted" ) this.#drawCrackedRing(r, width, ringColor);
    else {
      // The ring doubles as the spot's reserve: the trim runs clockwise from the top over the share of
      // strikes left, and the spent part shows as dark metal. A warning ring is always whole.
      const share = (state === "warning") ? 1 : Math.clamp(spot.left / (resource.strikes || 1), 0, 1);
      if ( share < 1 ) this.ring.lineStyle({ width, color: p.metal, alignment: 0.5 }).drawCircle(0, 0, r);
      const start = -Math.PI / 2;
      this.ring.lineStyle({ width, color: ringColor, alignment: 0.5 });
      if ( share < 1 ) this.ring.arc(0, 0, r, start, start + (2 * Math.PI * share));
      else this.ring.drawCircle(0, 0, r);
      this.ring.lineStyle({ width: width * 0.3, color: 0x000000, alpha: 0.6, alignment: 0.5 }).drawCircle(0, 0, r * 0.88);
    }

    this.mark.visible = state === "warning";
    this.mark.style = this.#textStyle(p.danger, 44, p.font);
    this.mark.scale.set(s);

    const text = (state === "depleted") ? game.i18n.localize("CANVASHARVEST.Spot.Depleted")
      : (state === "warning") ? "" : (resource.verb || game.i18n.localize(`CANVASHARVEST.Verb.${resource.animation}`));
    this.label.style = this.#textStyle((state === "depleted") ? p.textDim : p.trimHi, 20, p.font);
    this.label.text = text;
    this.label.scale.set(s);
    // The pill sits on the ring's lower edge, overlapping the disc like a banner.
    this.label.position.set(0, r);
    this.pill.clear();
    this.pill.visible = this.label.visible = !!text;
    // Only the disc takes a click: the pill under it lies over whatever token stands there, which
    // stays reachable for a select or a drag.
    this.hitArea = new PIXI.Circle(0, 0, r);
    // What the medallion covers, ring stroke and pill included, for keeping loot off it.
    const edge = r + (width / 2);
    this.footprint = new PIXI.Rectangle(-edge, -edge, 2 * edge, 2 * edge);
    if ( !text ) return;
    const padX = 10 * s;
    const w = this.label.width + (2 * padX);
    const h = this.label.height + (4 * s);
    this.pill.lineStyle({ width: 1.5 * s, color: p.trim, alpha: 0.9 })
      .beginFill(p.bg0, 0.94)
      .drawRoundedRect(-w / 2, this.label.y - (h / 2), w, h, h / 2)
      .endFill();
    this.footprint.enlarge(new PIXI.Rectangle(-w / 2, this.label.y - (h / 2), w, h));
  }

  /**
   * The halo at rest breathes on the theme's clock: the Wilds breeze or the Forge bellows. Photosensitive
   * mode keeps it still.
   * @param {number} now   seconds
   */
  breathe(now) {
    if ( !this.halo?.visible ) return;
    const k = canvas.photosensitiveMode ? 0.5 : themeClock(now);
    this.halo.alpha = (0.55 + (0.35 * k)) * (this.hovered ? 1.2 : 1);
    this.halo.scale.set(this.haloScale * (1 + (0.06 * k)));
  }

  /**
   * The ring with a jagged gap knocked out of it, as a spent vein looks.
   * @param {number} r
   * @param {number} width
   * @param {number} color
   */
  #drawCrackedRing(r, width, color) {
    const gapAt = -Math.PI / 3;
    const gap = 0.32;
    this.ring.lineStyle({ width, color, alignment: 0.5 })
      .arc(0, 0, r, gapAt + gap, gapAt + (2 * Math.PI) - gap);
    // A crack running from each broken end toward the centre.
    this.ring.lineStyle({ width: width * 0.4, color, alignment: 0.5 });
    for ( const [angle, side] of [[gapAt - gap, 1], [gapAt + gap, -1]] ) {
      const from = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      this.ring.moveTo(from.x, from.y);
      for ( const [depth, sway] of [[0.86, 0.12], [0.74, -0.04], [0.66, 0.1]] ) {
        const a = angle + (side * sway * 0.5);
        this.ring.lineTo(Math.cos(a) * r * depth, Math.sin(a) * r * depth);
      }
    }
  }

  /**
   * @param {number} color
   * @param {number} size
   * @param {string} font
   * @returns {PIXI.TextStyle}
   */
  #textStyle(color, size, font) {
    const style = CONFIG.canvasTextStyle.clone();
    style.fontFamily = font || style.fontFamily;
    style.fontSize = size;
    style.fill = color;
    return style;
  }

  #onPointerOver(event) {
    // Ignore pointer events that land on HTML UI above the canvas, as DoorControl does.
    if ( event.nativeEvent && (event.nativeEvent.target.id !== canvas.app.view.id) ) return;
    event.stopPropagation();
    this.hovered = true;
    this.scale.set(1.08);
    this.paint();
  }

  #onPointerOut(event) {
    if ( event.nativeEvent && (event.nativeEvent.target.id !== canvas.app.view.id) ) return;
    event.stopPropagation();
    this.hovered = false;
    this.scale.set(1);
    this.paint();
  }

  #onPointerDown(event) {
    if ( event.button !== 0 ) return;
    event.stopPropagation(); // Keeps the stage from running leftClickRelease on the controlled tokens
    const spot = this.behavior.system;
    // The GM refills a dry spot with a click, or one not yet dry with Shift. No notification: the
    // refill effect is the feedback.
    const strikes = spot.resourceData?.strikes ?? 0;
    if ( game.user.isGM && ((this.state === "depleted") || (event.shiftKey && (spot.left < strikes))) ) {
      this.behavior.update({ "system.remaining": strikes }, { [MODULE_ID]: { refill: true } });
    }
    else if ( this.ready ) requestHarvest(this.behavior);
  }

  /**
   * The GM right-clicks a spot to see its resource in the book. Taken on the click, not on the press:
   * a right drag that starts on the medallion pans the map, as anywhere else.
   */
  #onRightClick(event) {
    if ( !game.user.isGM ) return;
    if ( event.nativeEvent && (event.nativeEvent.target.id !== canvas.app.view.id) ) return;
    event.stopPropagation();
    const resource = this.behavior.system.resource;
    if ( resource ) api.openBook({ resource });
  }
}

/** The container of every HarvestControl, added to canvas.controls. */
let container = null;

/** HarvestControl instances keyed by behavior id. */
const controls = new Map();

/**
 * @param {Scene} scene
 * @returns {RegionBehavior[]} every Harvest Spot on the scene
 */
function spotsOf(scene) {
  return scene.regions.contents.flatMap(region => region.behaviors.filter(b => b.type === SPOT_TYPE));
}

/** @param {RegionBehavior} behavior */
function addControl(behavior) {
  removeControl(behavior.id);
  const control = new HarvestControl(behavior);
  controls.set(behavior.id, control);
  container.addChild(control);
  control.draw();
}

/** @param {string} id */
function removeControl(id) {
  const control = controls.get(id);
  if ( !control ) return;
  controls.delete(id);
  control.destroy({ children: true });
}

/**
 * The canvas area a spot's medallion covers, so harvested loot can be kept off it. Read from the
 * medallion as this client drew it; a GM viewing another scene has none drawn, and gets the grid
 * space at the spot's centre, which a medallion 0.7 of a space across stays inside.
 * @param {RegionBehavior} behavior
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function medallionArea(behavior) {
  const control = controls.get(behavior.id);
  if ( control?.footprint && (control.behavior === behavior) ) {
    const f = control.footprint;
    return { x: control.x + f.x, y: control.y + f.y, width: f.width, height: f.height };
  }
  const { x, y, width, height } = behavior.parent.bounds;
  const grid = behavior.parent.parent.grid;
  const corner = grid.getTopLeftPoint(grid.getOffset({ x: x + (width / 2), y: y + (height / 2) }));
  return { ...corner, width: grid.sizeX, height: grid.sizeY };
}

/** Re-decide every medallion's state: a token moved, the controlled set or the catalogue changed. */
export function refreshSpots() {
  if ( !container ) return;
  for ( const control of controls.values() ) control.refreshState();
}

/** Rebuild every medallion's look, after the theme changed. */
export function redrawSpots() {
  if ( !container ) return;
  for ( const control of controls.values() ) control.draw();
}

/** Let every medallion's halo breathe; one function, added once per canvas. */
function breatheAll() {
  const now = performance.now() / 1000;
  for ( const control of controls.values() ) if ( control.visible ) control.breathe(now);
}

function syncLayerState() {
  // On the Regions layer the medallions step aside, so the GM can select and edit the region.
  const off = !!canvas.regions?.active;
  container.visible = !off;
  container.eventMode = off ? "none" : "passive";
}

/**
 * Refresh once a token stops walking. Its regions changed when the move landed; the medallion waits
 * for the token to arrive, through every leg of a chained movement.
 * @param {Token} token
 */
async function refreshAfterArrival(token) {
  let promise;
  while ( (promise = token.movementAnimationPromise) ) {
    try {
      await promise;
    } catch {
      break;
    }
  }
  refreshSpots();
}

export function registerHarvestControls() {
  Hooks.on("canvasReady", () => {
    // ControlsLayer#_tearDown only clears its own containers, so ours survives a scene change and is
    // emptied here instead.
    for ( const id of [...controls.keys()] ) removeControl(id);
    container ??= new PIXI.Container();
    container.eventMode = "passive";
    if ( container.parent !== canvas.controls ) canvas.controls.addChild(container);
    for ( const behavior of spotsOf(canvas.scene) ) addControl(behavior);
    attachSpotFX(container);
    canvas.app.ticker.remove(breatheAll);
    canvas.app.ticker.add(breatheAll);
    syncLayerState();
  });

  const onScene = doc => !!container && canvas.ready && (doc.parent === canvas.scene);
  Hooks.on("createRegion", region => {
    if ( !onScene(region) ) return;
    for ( const behavior of region.behaviors ) if ( behavior.type === SPOT_TYPE ) addControl(behavior);
  });
  // Shape, levels, hidden: a redraw re-reads all of them.
  Hooks.on("updateRegion", region => {
    for ( const control of controls.values() ) if ( control.region === region ) control.draw();
  });
  Hooks.on("deleteRegion", region => {
    for ( const [id, control] of [...controls] ) if ( control.region === region ) removeControl(id);
  });
  Hooks.on("createRegionBehavior", behavior => {
    if ( (behavior.type === SPOT_TYPE) && onScene(behavior.parent) ) addControl(behavior);
  });
  // A strike or a refill rides on the update's options, so every client viewing the scene plays it.
  Hooks.on("updateRegionBehavior", (behavior, changes, options) => {
    const control = controls.get(behavior.id);
    if ( !control ) return;
    const effect = options[MODULE_ID];
    const resource = behavior.system.resourceData;
    const viewed = control.region.viewed;
    const wasDepleted = control.state === "depleted";
    // Keep the look the effect starts from; the effect itself moves to the new one.
    if ( effect?.strike && resource && viewed ) control.heldState = "full";
    else if ( effect?.refill && wasDepleted && viewed ) control.heldState = "depleted";
    control.draw();
    if ( !resource ) return;
    if ( effect?.strike ) {
      const token = foundry.utils.fromUuidSync(effect.strike, { strict: false }) ?? null;
      const depleted = !!effect.depleted;
      // One file with the three blows in it, timed to the motion; a depleting strike adds its cue on
      // the last blow. Each client plays its own copy at its own Environment volume, from the
      // medallion at the striker's elevation: the sound starts on the floor they stand on, whatever
      // Level this client views, and core decides who is in earshot across walls and floors.
      const origin = { x: control.x, y: control.y, elevation: token?.elevation ?? canvas.level.elevation.base };
      // A silenced resource still animates. Resources saved before the switch existed lack both fields.
      if ( resource.soundEnabled !== false ) {
        const spaces = resource.soundRadius ?? undefined;
        playCueAt(resource.animation, origin, { override: resource.sound, spaces });
        if ( depleted ) setTimeout(() => playCueAt("depleted", origin, { spaces }), 500);
      }
      if ( viewed ) playStrike(control, token?.object ?? null, { animation: resource.animation, depleted });
    }
    else if ( effect?.refill && wasDepleted && viewed ) playRefill(control);
  });
  Hooks.on("deleteRegionBehavior", behavior => removeControl(behavior.id));

  Hooks.on("controlToken", () => refreshSpots());
  // Core re-tests its doors here; a token's light, a wall, a status or darkvision may change what
  // reaches a medallion without any token moving.
  Hooks.on("sightRefresh", () => {
    if ( !container ) return;
    for ( const control of controls.values() ) control.refreshVisibility();
  });
  // Only the tokens this user controls decide what this user sees. Leaving shows at once; arriving
  // waits for the walk to end.
  Hooks.on("updateToken", tokenDoc => {
    const token = tokenDoc.object;
    if ( !container || !token?.controlled ) return;
    refreshSpots();
    refreshAfterArrival(token);
  });
  // A spot attached to a token follows it while it animates.
  Hooks.on("refreshToken", token => {
    const attached = token.document.attachments?.regions;
    if ( !attached?.size ) return;
    for ( const control of controls.values() ) if ( attached.has(control.region) ) control.reposition();
  });
  Hooks.on("activateCanvasLayer", () => {
    if ( container ) syncLayerState();
  });
}
