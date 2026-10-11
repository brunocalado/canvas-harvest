/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { bellows, breeze } from "./animation.js";
import { readPalette } from "./helpers.js";

const SPRITE_SIZE = 64;
const spriteCache = new Map();

/**
 * A soft radial glow of one colour, drawn once and reused, so a frame draws images instead of
 * building gradients.
 * @param {string} color   a CSS colour
 * @returns {HTMLCanvasElement}
 */
function sprite(color) {
  let s = spriteCache.get(color);
  if ( s ) return s;
  s = document.createElement("canvas");
  s.width = s.height = SPRITE_SIZE;
  const ctx = s.getContext("2d");
  const half = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.18, color);
  g.addColorStop(0.45, `${color}66`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  spriteCache.set(color, s);
  return s;
}

const rand = (a, b) => a + (Math.random() * (b - a));
const pick = list => list[Math.floor(Math.random() * list.length)];

/**
 * The particles behind a window's content: pollen drifting on the breeze in the Wilds, embers
 * rising with the bellows in the Forge. Drawn on a 2D canvas the window owns.
 */
export class AmbientFX {
  /** @param {string} theme */
  constructor(theme) {
    this.theme = theme;
    this.particles = [];
    this.canvas = null;
    this.ctx = null;
    this.frame = null;
    this.last = 0;
  }

  /** The frame callback, bound once so every frame can re-schedule it. */
  #loop = now => this.#tick(now);

  /**
   * Bind to a (possibly new) canvas element. A re-render replaces the element; particles survive it.
   * @param {HTMLCanvasElement} canvas
   * @param {string} theme
   */
  attach(canvas, theme) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.theme = theme;
    const palette = readPalette(theme);
    this.colors = [palette.glow.css, palette.glow2.css];
    this.resize();
    if ( !this.frame ) this.frame = requestAnimationFrame(this.#loop);
  }

  resize() {
    if ( !this.canvas ) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  stop() {
    if ( this.frame ) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.particles = [];
  }

  /**
   * New particles for this frame. A gust of the breeze or a pump of the bellows brings more, faster.
   * @param {number} dt    seconds
   * @param {number} now   seconds, on the clock the CSS animations share
   */
  #ambient(dt, now) {
    const forge = this.theme === "forge";
    const surge = forge ? bellows(now) : breeze(now);
    const rate = (forge ? 12 : 7) * (1 + (2 * surge));
    const n = Math.floor(rate * dt) + ((Math.random() < ((rate * dt) % 1)) ? 1 : 0);
    for ( let i = 0; i < n; i++ ) {
      if ( forge ) {
        this.particles.push({ x: rand(this.width * 0.1, this.width * 0.9), y: this.height + 4, vx: rand(-12, 12),
          vy: rand(-80, -35) * (1 + (0.7 * surge)), size: rand(2, 4), life: rand(2.2, 4), age: 0,
          color: pick(this.colors), wobble: rand(1, 3), twinkle: rand(6, 12), alpha: 0.8 });
      }
      else {
        this.particles.push({ x: rand(-20, this.width), y: rand(0, this.height), vx: rand(4, 14), vy: rand(-8, 6),
          size: rand(1.5, 3.5), life: rand(3, 5), age: 0, color: pick(this.colors), wobble: rand(0.5, 1.5),
          twinkle: rand(2, 5), alpha: 0.55 });
      }
    }
    // The breeze pushes the pollen sideways, everywhere at once.
    if ( !forge ) for ( const p of this.particles ) p.vx += 30 * surge * dt;
  }

  #tick(now) {
    this.frame = requestAnimationFrame(this.#loop);
    if ( !this.canvas?.isConnected ) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    if ( (this.canvas.clientWidth !== Math.round(this.width)) || (this.canvas.clientHeight !== Math.round(this.height)) ) {
      this.resize();
    }
    this.#ambient(dt, now / 1000);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "lighter";
    const alive = [];
    for ( const p of this.particles ) {
      p.age += dt;
      if ( p.age >= p.life ) continue;
      alive.push(p);
      p.vx += Math.sin((p.age * p.wobble * 3) + p.y) * 12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      const alpha = p.alpha * (t < 0.15 ? t / 0.15 : 1 - ((t - 0.15) / 0.85)) * (0.6 + (0.4 * Math.sin(p.age * p.twinkle)));
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.drawImage(sprite(p.color), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    this.particles = alive;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
