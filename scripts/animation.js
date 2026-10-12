/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { BELLOWS_PERIOD, BREEZE_PERIOD, MODULE_ID, STRIKE_MS } from "./constants.js";
import { seesSpot } from "./harvest-control.js";
import { getTheme, readPalette } from "./helpers.js";

const CanvasAnimation = () => foundry.canvas.animation.CanvasAnimation;

/** Milliseconds between the three blows of a strike. */
const BEAT_MS = 250;

/**
 * What the things a strike knocks loose are made of. These are materials, not the theme's light, so
 * they keep their colour in both themes; sparks, motes and glints take theirs from the palette.
 */
const MATERIALS = {
  stone: [0x5a554e, 0x7a736a, 0x3e3a35],
  wood: [0x8a5a2b, 0xb07a3e, 0x6b4423],
  leaf: [0x6f9e3a, 0x9ec25a, 0x4f7a2a, 0xc8a24a],
  fleck: [0x2e241c, 0x4a3a2c],
  shaving: [0xd8c8a8, 0xc9b48e],
  dust: [0x9a8a70, 0x8a7c66]
};

const rand = (a, b) => a + (Math.random() * (b - a));
const pick = list => list[Math.floor(Math.random() * list.length)];
const smooth = t => t * t * (3 - (2 * t));
const DEG = Math.PI / 180;

/**
 * A pulse on a repeating clock, 0 to 1: rest, a rise from 15 % to 45 % of the period, a fall by 80 %.
 * The book's CSS keyframes run the same curve, phased from the same clock.
 * @param {number} now      seconds
 * @param {number} period   seconds
 * @returns {number}
 */
function pulse(now, period) {
  const p = (now % period) / period;
  if ( p < 0.15 ) return 0;
  if ( p < 0.45 ) return smooth((p - 0.15) / 0.3);
  if ( p < 0.8 ) return 1 - smooth((p - 0.45) / 0.35);
  return 0;
}

/**
 * How hard the breeze blows, 0 to 1, on the Wilds clock.
 * @param {number} now   seconds
 * @returns {number}
 */
export function breeze(now) {
  return pulse(now, BREEZE_PERIOD);
}

/**
 * How hard the bellows blow, 0 to 1, on the Forge clock (Grid Crafter's).
 * @param {number} now   seconds
 * @returns {number}
 */
export function bellows(now) {
  return pulse(now, BELLOWS_PERIOD);
}

/**
 * The active theme's clock.
 * @param {number} now   seconds
 * @returns {number}
 */
export function themeClock(now) {
  return (getTheme() === "forge") ? bellows(now) : breeze(now);
}

/* -------------------------------------------- */
/*  Textures                                    */
/* -------------------------------------------- */

const textures = new Map();

/**
 * A texture drawn once and reused: a soft glow on a 2D canvas, or a white shape rendered from PIXI
 * Graphics. Every particle is a sprite of one of these, tinted, so a frame moves images and never
 * builds a gradient or a path.
 * @param {"glow"|"chip"|"splinter"|"leaf"|"glint"} kind
 * @returns {PIXI.Texture}
 */
function texture(kind) {
  const cached = textures.get(kind);
  if ( cached && !cached.baseTexture?.destroyed ) return cached;
  let tex;
  if ( kind === "glow" ) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255, 255, 255, 1)");
    g.addColorStop(0.2, "rgba(255, 255, 255, 0.85)");
    g.addColorStop(0.5, "rgba(255, 255, 255, 0.3)");
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex = PIXI.Texture.from(c);
  }
  else {
    const g = new PIXI.Graphics();
    if ( kind === "chip" ) g.beginFill(0xffffff).drawPolygon([0, -8, 7, -3, 6, 6, -2, 8, -8, 2]).endFill();
    else if ( kind === "splinter" ) g.beginFill(0xffffff).drawPolygon([-12, -1, 10, -2.5, 12, 0, 10, 2, -12, 1.5]).endFill();
    else if ( kind === "leaf" ) {
      g.beginFill(0xffffff).drawPolygon([-10, 0, -6, -4.5, 0, -5.5, 6, -3.5, 10, 0, 6, 3.5, 0, 5.5, -6, 4.5]).endFill();
      g.lineStyle(1, 0x000000, 0.35).moveTo(-9, 0).lineTo(9, 0);
    }
    else if ( kind === "glint" ) {
      g.lineStyle(4, 0xffffff, 1).arc(0, 0, 40, -0.9, 0.9);
      g.lineStyle(9, 0xffffff, 0.25).arc(0, 0, 40, -0.7, 0.7);
    }
    tex = canvas.app.renderer.generateTexture(g);
    g.destroy();
  }
  textures.set(kind, tex);
  return tex;
}

/* -------------------------------------------- */
/*  Particles                                   */
/* -------------------------------------------- */

/**
 * Pre-rendered glow sprites and tumbling shards over the canvas, one instance per scene. The only
 * place a canvas particle is drawn.
 */
export class SpotFX extends PIXI.Container {
  constructor() {
    super();
    this.eventMode = "none";
    /** @type {object[]} */
    this.particles = [];
    /** Particles spawned since the scene was drawn, for checks. */
    this.spawned = 0;
  }

  /**
   * @param {object} p
   * @param {PIXI.Texture} p.texture
   * @param {number} p.tint
   * @param {boolean} [p.additive]
   */
  #spawn({ texture: tex, tint, additive = false, size, ...motion }) {
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.tint = tint;
    sprite.blendMode = additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
    const base = size / Math.max(tex.width, tex.height);
    sprite.scale.set(base);
    sprite.position.set(motion.x, motion.y);
    sprite.rotation = motion.rotation ?? rand(0, Math.PI * 2);
    this.addChild(sprite);
    this.particles.push({ sprite, base, age: 0, vx: 0, vy: 0, gravity: 0, drag: 1, spin: 0, grow: 0, alpha: 1,
      wobble: 0, streak: false, target: null, ...motion });
    this.spawned++;
  }

  /**
   * Throw particles of one kind from a point.
   * @param {{x: number, y: number}} point
   * @param {object} options
   * @param {"sparks"|"chips"|"splinters"|"leaves"|"motes"|"scraps"|"glint"|"dust"} options.kind
   * @param {number} options.count
   * @param {number} [options.speed=1]     multiplier on the kind's own speed
   * @param {number} [options.radius=0]   the medallion's radius, for kinds that start around it
   * @param {number} [options.side=0]     -1 or 1: throw toward one side (splinters)
   * @param {boolean} [options.rise]      leaves that rise (gather) instead of falling (chop)
   * @param {boolean} [options.converge]  motes drawn in to the point (refill) instead of rising from it
   * @param {number} [options.angle=0]    the glint's direction, radians
   */
  burst(point, { kind, count, speed = 1, radius = 0, side = 0, rise = false, converge = false, angle = 0 }) {
    const palette = readPalette();
    const u = canvas.dimensions.uiScale;
    // At most a quarter under photosensitive mode, never none.
    if ( canvas.photosensitiveMode && (count > 1) ) count = Math.max(1, Math.floor(count / 4));
    for ( let i = 0; i < count; i++ ) {
      const { x, y } = point;
      switch ( kind ) {
        case "sparks": {
          const a = rand(-160, -20) * DEG;
          const v = rand(220, 420) * u * speed;
          this.#spawn({ texture: texture("glow"), tint: pick([palette.glow2, palette.trimHi, 0xffffff]), additive: true,
            size: 6 * u, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 900 * u, drag: 0.99, life: rand(0.35, 0.6), streak: true });
          break;
        }
        case "chips": {
          const a = rand(-150, -30) * DEG;
          const v = rand(150, 260) * u * speed;
          this.#spawn({ texture: texture("chip"), tint: pick(MATERIALS.stone), size: rand(7, 11) * u, x, y,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 1100 * u, spin: rand(-12, 12), life: rand(0.6, 0.9) });
          break;
        }
        case "splinters": {
          const dir = side || pick([-1, 1]);
          const a = (dir > 0 ? rand(-60, 10) : rand(170, 240)) * DEG;
          const v = rand(180, 320) * u * speed;
          this.#spawn({ texture: texture("splinter"), tint: pick(MATERIALS.wood), size: rand(10, 16) * u, x, y,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 900 * u, spin: rand(-15, 15), life: rand(0.6, 0.9) });
          break;
        }
        case "leaves": {
          const spread = Math.max(radius, 10 * u);
          const sx = x + rand(-spread, spread);
          this.#spawn({ texture: texture("leaf"), tint: pick(MATERIALS.leaf), size: rand(9, 13) * u, x: sx, y: y + rand(-6, 6) * u,
            vx: rand(-25, 25) * u, vy: (rise ? rand(-140, -80) : rand(20, 50)) * u * speed, gravity: (rise ? 120 : 60) * u,
            drag: 0.985, spin: rand(-3, 3), wobble: rand(2, 4), life: rand(1.2, 1.8) });
          break;
        }
        case "motes": {
          if ( converge ) {
            const a = rand(0, Math.PI * 2);
            const d = radius * rand(2, 3);
            this.#spawn({ texture: texture("glow"), tint: pick([palette.glow, palette.glow2]), additive: true, size: rand(5, 9) * u,
              x: x + (Math.cos(a) * d), y: y + (Math.sin(a) * d), target: { x, y }, life: rand(0.4, 0.5) });
          }
          else {
            this.#spawn({ texture: texture("glow"), tint: pick([palette.glow, palette.glow2]), additive: true, size: rand(4, 8) * u,
              x: x + rand(-radius, radius) * 0.6, y: y + rand(-radius, radius) * 0.3, vx: rand(-15, 15) * u, vy: rand(-90, -40) * u * speed,
              wobble: rand(1, 3), life: rand(1, 1.6) });
          }
          break;
        }
        case "scraps": {
          const pale = i % 2;
          const a = rand(-170, -10) * DEG;
          const v = rand(120, 240) * u * speed;
          this.#spawn({ texture: texture("chip"), tint: pick(pale ? MATERIALS.shaving : MATERIALS.fleck), size: rand(3, 6) * u, x, y,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 900 * u, spin: rand(-14, 14), life: rand(0.5, 0.8) });
          break;
        }
        case "glint": {
          this.#spawn({ texture: texture("glint"), tint: pick([palette.trimHi, 0xffffff]), additive: true, size: radius * 1.8, x, y,
            rotation: angle, spin: 2.4, life: 0.25 });
          break;
        }
        case "dust": {
          const a = (i / count) * Math.PI * 2;
          const v = rand(60, 110) * u * speed;
          this.#spawn({ texture: texture("glow"), tint: pick(MATERIALS.dust), size: rand(14, 22) * u,
            x: x + (Math.cos(a) * radius * 0.5), y: y + (Math.sin(a) * radius * 0.5),
            vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.96, grow: 1.4, alpha: 0.55, life: rand(0.8, 1.1) });
          break;
        }
      }
    }
  }

  /**
   * Move every particle one frame.
   * @param {number} dt   seconds
   */
  update(dt) {
    const alive = [];
    for ( const p of this.particles ) {
      p.age += dt;
      if ( (p.age >= p.life) || p.sprite.destroyed ) {
        p.sprite.destroy();
        continue;
      }
      alive.push(p);
      const s = p.sprite;
      const t = p.age / p.life;
      if ( p.target ) {
        // Drawn in to the medallion, faster as they near it.
        const k = Math.min(1, dt / Math.max(0.01, p.life - p.age + dt) * 1.4);
        s.x += (p.target.x - s.x) * k;
        s.y += (p.target.y - s.y) * k;
      }
      else {
        p.vy += p.gravity * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        if ( p.wobble ) p.vx += Math.sin((p.age * p.wobble * 3) + p.sprite.y) * 40 * dt;
        s.x += p.vx * dt;
        s.y += p.vy * dt;
      }
      if ( p.streak ) {
        // Sparks stretch along their velocity, which reads as speed.
        s.rotation = Math.atan2(p.vy, p.vx);
        s.scale.set(p.base * (1 + Math.min(3, Math.hypot(p.vx, p.vy) / 120)), p.base * 0.6);
      }
      else {
        s.rotation += p.spin * dt;
        if ( p.grow ) s.scale.set(p.base * (1 + (p.grow * t)));
      }
      s.alpha = p.alpha * ((t < 0.1) ? t / 0.1 : 1 - ((t - 0.1) / 0.9));
    }
    this.particles = alive;
  }

  /** @override */
  destroy(options) {
    this.particles = [];
    super.destroy({ children: true, ...options });
  }
}

/** The SpotFX of the scene on screen. */
let fx = null;

/** Advance the particles; one function, added once per canvas. */
function tick() {
  if ( !fx || fx.destroyed ) return;
  fx.update(Math.min(0.05, canvas.app.ticker.deltaMS / 1000));
}

/**
 * Put a fresh SpotFX above the medallions, after the scene was drawn.
 * @param {PIXI.Container} medallions   the medallions' container in canvas.controls
 */
export function attachSpotFX(medallions) {
  fx?.destroy();
  fx = new SpotFX();
  medallions.parent.addChildAt(fx, medallions.parent.getChildIndex(medallions) + 1);
  // canvas.app outlives scene changes, so the listener is re-added rather than stacked.
  canvas.app.ticker.remove(tick);
  canvas.app.ticker.add(tick);
}

/** @returns {SpotFX|null} */
export function getSpotFX() {
  return (fx && !fx.destroyed) ? fx : null;
}

/* -------------------------------------------- */
/*  Sequences                                   */
/* -------------------------------------------- */

/**
 * Pose the medallion's body at a moment of one blow.
 * @param {PIXI.Container} body
 * @param {string} animation
 * @param {number} local   0 to 1 through the blow
 * @param {number} ms      milliseconds since the strike began
 * @param {boolean} calm   photosensitive mode: no shake
 */
function pose(body, animation, local, ms, calm) {
  const u = canvas.dimensions.uiScale;
  body.position.set(0, 0);
  body.rotation = 0;
  switch ( animation ) {
    // A pick: wind back, snap through the blow, settle. The hit lands at 55 % of the beat.
    case "strike":
    case "chop": {
      const [back, through] = (animation === "strike") ? [-35, 15] : [40, -10];
      if ( local < 0.4 ) body.rotation = back * DEG * smooth(local / 0.4);
      else if ( local < 0.55 ) body.rotation = (back + ((through - back) * ((local - 0.4) / 0.15))) * DEG;
      else body.rotation = through * DEG * (1 - smooth((local - 0.55) / 0.45));
      if ( !calm && (animation === "strike") && (local > 0.55) && (local < 0.75) ) {
        body.position.set(rand(-3, 3) * u, rand(-3, 3) * u);
      }
      break;
    }
    // A rustle: a fast small jitter for the first 200 ms of each pull.
    case "gather":
      if ( local < 0.8 ) body.rotation = 6 * DEG * Math.sin((ms / 1000) * 2 * Math.PI * 30);
      break;
    // A saw: back and forth along its own diagonal, twice per cut.
    case "carve": {
      const d = 5 * u * Math.sin(local * 2 * Math.PI * 2);
      body.position.set(d * Math.SQRT1_2, d * Math.SQRT1_2);
      break;
    }
  }
}

/**
 * The particles of one blow.
 * @param {SpotFX} spotFX
 * @param {HarvestControl} control
 * @param {string} animation
 * @param {number} beat   0, 1 or 2
 */
function blow(spotFX, control, animation, beat) {
  const r = control.radius;
  const { x, y } = control.position;
  const low = { x, y: y + (r * 0.8) };
  switch ( animation ) {
    case "strike":
      spotFX.burst(low, { kind: "sparks", count: 16 });
      spotFX.burst(low, { kind: "chips", count: 6 });
      break;
    case "chop": {
      const side = (beat % 2) ? -1 : 1;
      spotFX.burst({ x: x + (side * r * 0.7), y }, { kind: "splinters", count: 10, side });
      break;
    }
    case "gather":
      spotFX.burst({ x, y: y + (r * 0.4) }, { kind: "leaves", count: 6, radius: r, rise: true });
      spotFX.burst({ x, y }, { kind: "motes", count: 8, radius: r });
      break;
    case "carve":
      spotFX.burst({ x, y }, { kind: "glint", count: 1, radius: r, angle: (-45 + (beat * 30)) * DEG });
      spotFX.burst(low, { kind: "scraps", count: 8 });
      break;
  }
}

/**
 * Lean or lunge the striking token toward the spot and back, on its mesh only, restored by core's
 * own refresh: the token's document never moves.
 * @param {Token} token
 * @param {{x: number, y: number}} centre
 * @param {string} animation
 * @returns {Promise<void>}
 */
async function moveToken(token, centre, animation) {
  const mesh = token.mesh;
  if ( !mesh || mesh.destroyed ) return;
  const from = token.center;
  const dx = centre.x - from.x;
  const dy = centre.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // A share of the token's own size: a share of a grid space is nothing for a token several spaces wide.
  const reach = ((animation === "strike") || (animation === "chop") ? 0.12 : 0.06) * Math.max(token.w, token.h);
  const lunge = (animation === "strike") || (animation === "chop");
  try {
    await CanvasAnimation().animate([], {
      name: `${token.objectId}.${MODULE_ID}.strike`,
      context: token,
      duration: STRIKE_MS,
      ontick: (dt, animation) => {
        if ( mesh.destroyed ) return;
        const t = animation.time;
        const k = lunge ? Math.sin(Math.PI * Math.min(1, (t % BEAT_MS) / BEAT_MS)) : Math.sin(Math.PI * Math.min(1, t / STRIKE_MS));
        mesh.position.set(token.center.x + ((dx / length) * reach * k), token.center.y + ((dy / length) * reach * k));
      }
    });
  } finally {
    if ( !token.destroyed ) token.renderFlags.set({ refreshPosition: true, refreshMesh: true });
  }
}

/**
 * Fade the medallion's image between two tints.
 * @param {HarvestControl} control
 * @param {number} from
 * @param {number} to
 * @param {number} duration   ms
 */
async function fadeTint(control, from, to, duration) {
  const a = foundry.utils.Color.from(from);
  const b = foundry.utils.Color.from(to);
  await CanvasAnimation().animate([], {
    name: `${MODULE_ID}.${control.behavior.id}.tint`,
    context: control,
    duration,
    ontick: (dt, animation) => {
      if ( control.destroyed ) return;
      control.imageTint = a.mix(b, Math.min(1, animation.time / duration));
      control.paint();
    }
  });
}

/**
 * A strike on this client: the medallion swings, the token lunges, and each of the three blows throws
 * its particles. A strike that empties the spot ends in a puff of dust while the ring cracks and the
 * image greys.
 * @param {HarvestControl} control
 * @param {Token|null} token   the striking token, when this client has it drawn
 * @param {{animation: string, depleted?: boolean}} options
 */
export async function playStrike(control, token, { animation, depleted = false }) {
  const calm = canvas.photosensitiveMode;
  const spotFX = seesSpot(control) ? getSpotFX() : null;
  const body = control.body;
  const fired = new Set();
  const lunge = (token && !calm) ? moveToken(token, { x: control.x, y: control.y }, animation) : null;
  try {
    await CanvasAnimation().animate([], {
      name: `${MODULE_ID}.${control.behavior.id}.strike`,
      context: control,
      duration: STRIKE_MS,
      ontick: (dt, anim) => {
        if ( body.destroyed ) return;
        const ms = anim.time;
        const beat = Math.min(2, Math.floor(ms / BEAT_MS));
        // Each blow throws when it lands, so a slow frame never skips one.
        for ( let b = 0; b <= beat; b++ ) {
          if ( fired.has(b) || (ms < (b * BEAT_MS) + (0.55 * BEAT_MS)) ) continue;
          fired.add(b);
          if ( spotFX ) blow(spotFX, control, animation, b);
        }
        pose(body, animation, Math.min(1, (ms - (beat * BEAT_MS)) / BEAT_MS), ms, calm);
      }
    });
  } finally {
    if ( !body.destroyed ) {
      body.rotation = 0;
      body.position.set(0, 0);
    }
  }
  await lunge;
  if ( control.destroyed ) return;
  if ( spotFX && (animation === "chop") ) {
    spotFX.burst({ x: control.x, y: control.y - (control.radius * 1.6) }, { kind: "leaves", count: 8, radius: control.radius });
  }
  control.heldState = null;
  if ( !depleted ) return control.paint();
  if ( spotFX ) spotFX.burst(control.position, { kind: "dust", count: 14, radius: control.radius });
  // The ring cracks at once; the image greys over 300 ms.
  await fadeTint(control, 0xffffff, control.greyTint, 300);
  control.imageTint = null;
  control.paint();
}

/**
 * A refill on this client: motes are drawn in to the medallion, then the crack heals and the image
 * regains its colour.
 * @param {HarvestControl} control
 */
export async function playRefill(control) {
  const spotFX = seesSpot(control) ? getSpotFX() : null;
  spotFX?.burst(control.position, { kind: "motes", count: 24, radius: control.radius, converge: true });
  await new Promise(resolve => setTimeout(resolve, 500));
  if ( control.destroyed ) return;
  control.heldState = null;
  await fadeTint(control, control.greyTint, 0xffffff, 300);
  control.imageTint = null;
  control.paint();
}
