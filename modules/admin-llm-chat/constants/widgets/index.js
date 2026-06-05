'use strict';

const CONSTANTS = require('../admin-llm-chat.constants');
const kpiCards = require('./kpi-cards.widget');
const dataTable = require('./data-table.widget');
const lineChart = require('./line-chart.widget');
const barChart = require('./bar-chart.widget');
const pieChart = require('./pie-chart.widget');
const callout = require('./callout.widget');
const vegaLiteChart = require('./vega-lite-chart.widget');

const ALL_WIDGETS = [
  kpiCards,
  dataTable,
  lineChart,
  barChart,
  pieChart,
  callout,
  vegaLiteChart,
];

const WIDGET_BY_TYPE = Object.fromEntries(ALL_WIDGETS.map((w) => [w.type, w]));

function isWidgetTypeEnabled(def) {
  if (!def.enabled) return false;
  if (!CONSTANTS.TOOL_RENDER_WIDGET_ENABLED) return false;
  const flag = CONSTANTS.WIDGET_TYPE_FLAGS?.[def.type];
  if (flag === false) return false;
  if (flag === true) return true;
  return true;
}

function getEnabledWidgets() {
  return ALL_WIDGETS.filter(isWidgetTypeEnabled);
}

function getWidgetByType(type) {
  return WIDGET_BY_TYPE[type] || null;
}

/** Resolve user-requested widget name to registry type (exact or alias). */
function resolveWidgetType(requested) {
  const q = String(requested || '').trim().toLowerCase();
  if (!q) return null;
  const enabled = getEnabledWidgets();
  const exact = enabled.find((w) => w.type === q || w.type.replace(/_/g, ' ') === q);
  if (exact) return exact.type;
  const aliasHit = enabled.find((w) => (w.aliases || []).some(
    (a) => a.toLowerCase() === q || q.includes(a.toLowerCase()),
  ));
  return aliasHit?.type || null;
}

module.exports = {
  ALL_WIDGETS,
  getEnabledWidgets,
  getWidgetByType,
  resolveWidgetType,
  isWidgetTypeEnabled,
};
