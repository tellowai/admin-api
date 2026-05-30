'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { getWidgetByType, getEnabledWidgets, isWidgetTypeEnabled } = require('../constants/widgets');
const logger = require('../../../config/lib/logger');

function renderWidget({ widget_type: widgetType, data }) {
  if (!CONSTANTS.TOOL_RENDER_WIDGET_ENABLED) {
    return {
      success: false,
      error: 'TOOL_DISABLED',
      message: 'render_widget is disabled',
      retryable: false,
    };
  }

  const def = getWidgetByType(widgetType);
  if (!def) {
    const enabled = getEnabledWidgets().map((w) => w.type).join(', ');
    return {
      success: false,
      error: 'UNKNOWN_WIDGET',
      message: `Unknown widget_type: ${widgetType}`,
      hint: enabled
        ? `Use one of: ${enabled}`
        : 'render_widget has no enabled widget types.',
      retryable: true,
    };
  }
  if (!isWidgetTypeEnabled(def)) {
    return {
      success: false,
      error: 'WIDGET_DISABLED',
      message: `Widget type "${widgetType}" is disabled on this environment.`,
      retryable: false,
    };
  }

  const { error, value } = def.dataSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map((d) => d.message).join('; ');
    logger.warn('admin_llm_chat widget_validation_failed', {
      widget: widgetType,
      details,
    });
    return {
      success: false,
      error: 'WIDGET_VALIDATION_FAILED',
      message: details,
      hint: `Fix data for widget "${widgetType}" and call render_widget again.`,
      retryable: true,
    };
  }

  const widgetSpec = {
    source: def.source || 'static_widget',
    widget: def.type,
    version: def.version,
    data: value,
    exportable: Boolean(def.exportable),
  };

  logger.info('admin_llm_chat widget_rendered', {
    widget: def.type,
    version: def.version,
    source: widgetSpec.source,
  });

  return {
    success: true,
    widgetSpec,
    message: `Rendered ${def.type}`,
  };
}

module.exports = { renderWidget };
