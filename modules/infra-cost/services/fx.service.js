'use strict';

/** Multiply native amount by rate to convert → EUR */
const DEFAULT_FX_TO_EUR = Object.freeze({
  EUR: 1,
  USD: 0.92,
  INR: 1 / 90
});

const DEFAULT_EUR_TO_INR = 90;

function normalizeCurrency(code) {
  return String(code || 'EUR')
    .trim()
    .toUpperCase();
}

function getEurToInrRate(override) {
  const n = parseFloat(override ?? process.env.CLOUD_INFRA_FX_EUR_TO_INR);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EUR_TO_INR;
}

/**
 * Convert native amount to reporting currency (default EUR) using static FX table.
 */
function convertToReporting(amount, currency, reportingCurrency = 'EUR', fxTable = DEFAULT_FX_TO_EUR) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const from = normalizeCurrency(currency);
  const to = normalizeCurrency(reportingCurrency);
  if (from === to) return value;

  const fx = { ...DEFAULT_FX_TO_EUR, ...fxTable };
  const rateToEur = fx[from];
  const rateToTarget = fx[to];
  if (!Number.isFinite(rateToEur) || !Number.isFinite(rateToTarget) || rateToTarget === 0) {
    return null;
  }
  const inEur = value * rateToEur;
  return inEur / rateToTarget;
}

function eurToInr(amountEur, eurToInrRate = DEFAULT_EUR_TO_INR) {
  const value = Number(amountEur);
  const rate = getEurToInrRate(eurToInrRate);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * rate * 100) / 100;
}

function inrToEur(amountInr, eurToInrRate = DEFAULT_EUR_TO_INR) {
  const value = Number(amountInr);
  const rate = getEurToInrRate(eurToInrRate);
  if (!Number.isFinite(value) || rate === 0) return null;
  return Math.round((value / rate) * 10000) / 10000;
}

module.exports = {
  DEFAULT_FX_TO_EUR,
  DEFAULT_EUR_TO_INR,
  getEurToInrRate,
  convertToReporting,
  eurToInr,
  inrToEur,
  normalizeCurrency
};
