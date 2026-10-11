/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID } from "./constants.js";
import { getAllResources, getResource } from "./resources.js";

const { StringField, NumberField } = foundry.data.fields;

/**
 * The resource a spot draws from. Registered resources exist only after `ready`, but behaviors are
 * validated when the world's documents are built, before it, so the id can't be checked against
 * `choices` (StringField#_isValidChoice runs during validation). The select is filled when the
 * Region Behavior sheet renders instead. A resource that is gone (deleted, or its package off) stays
 * listed under its id, or saving the sheet for any other change would quietly empty the spot.
 */
class ResourceField extends StringField {
  /** @override */
  _toInput(config) {
    config.choices = Object.fromEntries(getAllResources().map(r => [r.id, r.name]));
    if ( config.value && !(config.value in config.choices) ) {
      config.choices[config.value] = game.i18n.localize("CANVASHARVEST.Spot.MissingResource", { id: config.value });
    }
    return super._toInput(config);
  }
}

/** A Region that tokens standing in can harvest, until its reserve of strikes runs out. */
export class SpotBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["CANVASHARVEST.Spot"];

  /** @override */
  static defineSchema() {
    return {
      resource: new ResourceField({ required: true, blank: true, initial: "" }),
      // Filled with the resource's strikes when the resource is set, then counted down. null
      // until a resource is set.
      remaining: new NumberField({ integer: true, min: 0, nullable: true, initial: null })
    };
  }

  /** @override */
  async _preCreate(data, options, user) {
    const strikes = this.resourceData?.strikes;
    if ( (this.remaining === null) && strikes ) this.parent.updateSource({ "system.remaining": strikes });
    return super._preCreate(data, options, user);
  }

  /** @override */
  async _preUpdate(changes, options, user) {
    // A new resource starts full, unless the GM typed a new number in the same save. The sheet
    // sends every field, so an unchanged number counts as not typed.
    const system = changes.system;
    if ( system && ("resource" in system) && (system.resource !== this.resource)
      && (!("remaining" in system) || (system.remaining === this.remaining)) ) {
      system.remaining = getResource(system.resource)?.strikes ?? null;
    }
    // Every client compares the strikes left before and after to fire the spot hooks, whoever wrote
    // the change: a strike, a refill, the refund of a strike that delivered nothing, the GM's sheet.
    // Options set here reach updateRegionBehavior on every client, and `changes` is already nested.
    const remaining = foundry.utils.getProperty(changes, "system.remaining");
    if ( (remaining !== undefined) && (remaining !== this.remaining) ) {
      options[MODULE_ID] ??= {};
      options[MODULE_ID].previous = this.left;
    }
    return super._preUpdate(changes, options, user);
  }

  /** @returns {Resource|null} the catalogue entry, or null when it was deleted or its package is off */
  get resourceData() {
    return getResource(this.resource);
  }

  /** @returns {number} strikes left, whatever the GM set; 0 for a spot without a resource */
  get left() {
    const resource = this.resourceData;
    if ( !resource ) return 0;
    return this.remaining ?? resource.strikes;
  }
}
