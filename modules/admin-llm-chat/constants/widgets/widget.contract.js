'use strict';

/**
 * @typedef {object} WidgetDefinition
 * @property {string} type Stable widget id
 * @property {number} version Schema version
 * @property {string} title Human title for UI
 * @property {string} description LLM-facing when-to-use
 * @property {string} library Internal renderer hint (echarts, markup, vega)
 * @property {string} source Spec source: static_widget | vega_lite
 * @property {import('joi').Schema} dataSchema Joi validation for LLM-supplied data
 * @property {string[]} [aliases] User-request synonyms
 * @property {boolean} [exportable] Show CSV/Excel export
 * @property {boolean} enabled Feature flag default
 */

/** @param {WidgetDefinition} def */
function defineWidget(def) {
  return {
    exportable: false,
    enabled: true,
    source: 'static_widget',
    aliases: [],
    ...def,
  };
}

module.exports = { defineWidget };
