'use strict';

const { expect } = require('chai');
const {
  buildRenderWidgetParameters,
  buildWidgetPromptSection,
} = require('../../../modules/admin-llm-chat/services/widget.catalog.service');

describe('widget.catalog.service', () => {
  it('buildRenderWidgetParameters is a flat object schema (no top-level oneOf)', () => {
    const params = buildRenderWidgetParameters();
    expect(params.type).to.equal('object');
    expect(params).to.not.have.property('oneOf');
    expect(params).to.not.have.property('anyOf');
    expect(params.properties.widget_type.enum).to.be.an('array').with.length.greaterThan(0);
    expect(params.properties.widget_type.enum).to.include('kpi_cards');
    expect(params.properties.widget_type.enum).to.include('data_table');
    expect(params.properties.data.type).to.equal('object');
  });

  it('buildWidgetPromptSection lists enabled widgets and chart-first policy', () => {
    const section = buildWidgetPromptSection();
    expect(section).to.include('render_widget');
    expect(section).to.include('kpi_cards');
    expect(section).to.include('export');
    expect(section).to.include('MUST call render_widget');
    expect(section).to.include('Default: show data visually');
  });
});
