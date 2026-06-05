'use strict';

const { expect } = require('chai');
const dedup = require('../../../modules/admin-llm-chat/utils/memory.dedup.util');

describe('memory.dedup.util', () => {
  const composite = {
    key: 'commerce_focus',
    value: 'Primary monetization focus is alacarte purchases; subscriptions exist but are secondary. ₹19 is usually image templates / AI images and should be treated as the core current alacarte SKU.',
  };

  const atomics = [
    { key: 'primary_monetization_focus', value: 'alacarte purchases' },
    { key: 'secondary_monetization_focus', value: 'subscriptions' },
    { key: 'core_alacarte_sku_price', value: '₹19' },
    { key: 'core_alacarte_sku_type', value: 'image template / AI image purchase' },
  ];

  it('treats composite and atomic monetization facts as redundant', () => {
    atomics.forEach((atomic) => {
      expect(dedup.isRedundantPair(composite, atomic)).to.equal(true);
    });
  });

  it('keeps only composite when batch contains composite + atomics', () => {
    const { items, retireKeys } = dedup.dedupeIncomingMemories([composite, ...atomics], []);
    expect(items).to.have.length(1);
    expect(items[0].key).to.equal('commerce_focus');
    expect(retireKeys).to.deep.equal([]);
  });

  it('skips incoming atomic when composite already exists', () => {
    const existing = [{ memory_key: 'commerce_focus', memory_value: composite.value }];
    const { items } = dedup.dedupeIncomingMemories(
      [{ key: 'primary_monetization_focus', value: 'alacarte purchases' }],
      existing,
    );
    expect(items).to.have.length(0);
  });

  it('retires existing atomics when new composite is stored', () => {
    const existing = atomics.map((a) => ({
      memory_key: a.key,
      memory_value: a.value,
    }));
    const { items, retireKeys } = dedup.dedupeIncomingMemories([composite], existing);
    expect(items).to.have.length(1);
    expect(retireKeys).to.include('primary_monetization_focus');
    expect(retireKeys).to.include('core_alacarte_sku_price');
  });

  it('allows unrelated facts', () => {
    const { items } = dedup.dedupeIncomingMemories([
      { key: 'preferred_currency', value: 'INR' },
      { key: 'default_date_range', value: 'last 28 days' },
    ], []);
    expect(items).to.have.length(2);
  });
});
