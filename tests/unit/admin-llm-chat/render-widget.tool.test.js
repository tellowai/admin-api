'use strict';

const { expect } = require('chai');
const { renderWidget } = require('../../../modules/admin-llm-chat/tools/render-widget.tool');

describe('render-widget.tool', () => {
  it('validates kpi_cards data', () => {
    const r = renderWidget({
      widget_type: 'kpi_cards',
      data: {
        title: 'Headline',
        cards: [{ label: 'Users', value: 42 }],
      },
    });
    expect(r.success).to.equal(true);
    expect(r.widgetSpec.widget).to.equal('kpi_cards');
    expect(r.widgetSpec.data.cards).to.have.length(1);
  });

  it('rejects unknown widget_type', () => {
    const r = renderWidget({
      widget_type: 'not_a_widget',
      data: {},
    });
    expect(r.success).to.equal(false);
    expect(r.error).to.equal('UNKNOWN_WIDGET');
  });

  it('rejects invalid data with WIDGET_VALIDATION_FAILED', () => {
    const r = renderWidget({
      widget_type: 'line_chart',
      data: { title: 'Missing series' },
    });
    expect(r.success).to.equal(false);
    expect(r.error).to.equal('WIDGET_VALIDATION_FAILED');
    expect(r.retryable).to.equal(true);
  });

  it('returns exportable flag for data_table', () => {
    const r = renderWidget({
      widget_type: 'data_table',
      data: {
        columns: [{ key: 'a', label: 'A' }],
        rows: [{ a: 1 }],
      },
    });
    expect(r.success).to.equal(true);
    expect(r.widgetSpec.exportable).to.equal(true);
  });
});
