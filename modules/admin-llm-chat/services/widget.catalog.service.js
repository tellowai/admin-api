'use strict';

const { getEnabledWidgets, getWidgetByType } = require('../constants/widgets');

/** Compact catalog for system prompt (1 line per widget). */
function buildWidgetCatalogCompact() {
  return getEnabledWidgets()
    .map((w) => `- ${w.type}: ${w.description}`)
    .join('\n');
}

/** Tool description for render_widget. */
function buildRenderWidgetToolDescription() {
  const types = getEnabledWidgets().map((w) => w.type).join(', ');
  return `Render a rich UI widget in the chat (this is the primary way to show data). Types: ${types}. `
    + 'Call after query/analysis when you have numbers to show — default to a chart (line_chart, bar_chart, pie_chart, or kpi_cards). '
    + 'Use data_table only for row-level lists, many columns, or export/download. '
    + 'Required when the user asks for a chart, graph, plot, trend, or visual. '
    + 'Provide widget_type and data; never paste chart/table JSON in text.';
}

/**
 * OpenAI/Anthropic parameters for render_widget.
 * Flat object only — providers reject oneOf/anyOf at the tool schema root.
 * Per-widget shapes are enforced server-side (Joi) and described in the prompt catalog.
 */
function buildRenderWidgetParameters() {
  const enabled = getEnabledWidgets();
  if (!enabled.length) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
  }
  const types = enabled.map((w) => w.type);
  return {
    type: 'object',
    properties: {
      widget_type: {
        type: 'string',
        enum: types,
        description: `Widget type. Must be one of: ${types.join(', ')}.`,
      },
      data: {
        type: 'object',
        description:
          'Payload for widget_type (validated server-side). Field shapes are in the widget catalog in the system prompt.',
      },
    },
    required: ['widget_type', 'data'],
    additionalProperties: false,
  };
}

function buildWidgetPromptSection() {
  const catalog = buildWidgetCatalogCompact();
  if (!catalog) return '';
  return [
    'Rich UI (render_widget) — default for data answers:',
    catalog,
    'Visualization policy:',
    '- After tools return numeric or time-series data, call render_widget in the same turn (before your final text). Do not wait for the final answer-only round.',
    '- Default: show data visually. Most analytics answers should include at least one widget (chart or KPI cards), not prose-only numbers.',
    '- Chart pick: line_chart for trends over time; bar_chart for category comparisons; pie_chart for share/mix; kpi_cards for 2–4 headline metrics; data_table only when the user needs row-level detail, a long list, or export of raw rows.',
    '- Do not show both data_table and a chart for the same dataset unless the user asked for both.',
    '- If the user explicitly asks for a chart, graph, plot, trend, visual, or names a chart type (line, bar, pie) — you MUST call render_widget with the matching type; never substitute markdown or a table only.',
    '- Use markdown only for short non-data replies (greetings, scope refusals, clarifying questions, or when no query data exists).',
    '- NEVER paste raw JSON or ```json for widgets — always render_widget. Series use { name, values } (not "data").',
    '- Export/download: use data_table or an exportable chart; do not claim a file was attached.',
    '- Only use widget types from the list above.',
  ].join('\n');
}

module.exports = {
  buildWidgetCatalogCompact,
  buildRenderWidgetToolDescription,
  buildRenderWidgetParameters,
  buildWidgetPromptSection,
  getWidgetByType,
};
