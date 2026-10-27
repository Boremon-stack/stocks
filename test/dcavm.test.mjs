import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, dcaVsVm } from '../public/js/backtest.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/user/${name}`, import.meta.url));
const NSE_CSV = fixture('NIFTY50_2020-2025_merged.csv');
const DEFAULT_DAILY = fixture('backtest_daily.csv');
const DEFAULT_SUMMARY = fixture('summary_metrics.csv');
const ALT_DAILY = fixture('alt/backtest_daily.csv');
const ALT_SUMMARY = fixture('alt/summary_metrics.csv');
const EXTRAS = fileURLToPath(new URL('./reference_dcavm_extras.json', import.meta.url));

const DAILY_COLUMNS = {
  Price: 'price',
  Daily_index_return: 'indexReturn',
  Prior_month_RV: 'priorMonthRv',
  VM_target_exposure: 'vmTarget',
  DCA_contribution: 'contribution',
  VM_contribution: 'contribution',
  DCA_equity: 'dcaEquity',
  VM_equity: 'vmEquity',
  DCA_cash: 'dcaCash',
  VM_cash: 'vmCash',
  DCA_shares: 'dcaShares',
  VM_shares: 'vmShares',
  DCA_transaction_cost: 'dcaCost',
  VM_transaction_cost: 'vmCost',
  DCA_return: 'dcaReturn',
  VM_return: 'vmReturn',
};

const SUMMARY_COLUMNS = {
  'Ending equity (INR)': 'endingEquity',
  'Total contributions (INR)': 'totalContributions',
  'Profit vs contributions (INR)': 'profit',
  'TWR cumulative return': 'twrCumulative',
  'TWR CAGR': 'twrCagr',
  'Annualized volatility': 'annVol',
  'Sharpe (risk-free=0)': 'sharpe',
  'Maximum drawdown': 'maxDrawdown',
};

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((name, i) => {
      const cell = cells[i];
      if (cell === undefined || cell === '') row[name] = null;
      else {
        const num = Number(cell);
        row[name] = Number.isNaN(num) ? cell : num;
      }
    });
    return row;
  });
}

function near(got, want) {
  return typeof got === 'number' && Math.abs(got - want) <= Math.max(1e-9, Math.abs(want) * 1e-9);
}

function assertNear(got, want, label) {
  assert.ok(near(got, want), `${label}: got ${got}, want ${want}`);
}

let defaultCache;
let altCache;
function defaultRun() {
  defaultCache ??= dcaVsVm(parseCsv(readFileSync(NSE_CSV, 'utf8')), { monthly: 10000, maxExposure: 1, costBps: 0 });
  return defaultCache;
}
function altRun() {
  altCache ??= dcaVsVm(parseCsv(readFileSync(NSE_CSV, 'utf8')), { monthly: 20000, maxExposure: 0.8, costBps: 5 });
  return altCache;
}

function compareDaily(result, csvRows) {
  const mismatches = [];
  csvRows.forEach((want, row) => {
    const got = result.daily[row];
    if (got.date !== want.Date) mismatches.push({ row, column: 'Date', got: got.date, want: want.Date });
    for (const [column, field] of Object.entries(DAILY_COLUMNS)) {
      const w = want[column];
      const g = got[field];
      if (w === null) {
        if (g !== null) mismatches.push({ row, column, got: g, want: w });
      } else if (!near(g, w)) {
        mismatches.push({ row, column, got: g, want: w });
      }
    }
  });
  return mismatches;
}

function compareSummary(metrics, csvRows) {
  const mismatches = [];
  const plans = { DCA: 'dca', VM: 'vm' };
  for (const row of csvRows) {
    const plan = metrics[plans[row.Strategy]];
    for (const [column, field] of Object.entries(SUMMARY_COLUMNS)) {
      if (!near(plan[field], row[column])) {
        mismatches.push({ strategy: row.Strategy, column, got: plan[field], want: row[column] });
      }
    }
  }
  return mismatches;
}

function deepCompare(got, want, path, out) {
  if (want === null) {
    if (got !== null) out.push({ path, got, want });
  } else if (typeof want === 'number') {
    if (!near(got, want)) out.push({ path, got, want });
  } else if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) {
      out.push({ path, got: Array.isArray(got) ? `length ${got.length}` : got, want: `length ${want.length}` });
      return;
    }
    want.forEach((item, i) => deepCompare(got[i], item, `${path}[${i}]`, out));
  } else if (typeof want === 'object') {
    for (const key of Object.keys(want)) deepCompare(got?.[key], want[key], `${path}.${key}`, out);
  } else if (got !== want) {
    out.push({ path, got, want });
  }
  return out;
}

test('(a) parseCsv reads the owner NSE file: 1,491 rows, 2020-01-01 to 2025-12-31', () => {
  const rows = parseCsv(readFileSync(NSE_CSV, 'utf8'));
  assert.equal(rows.length, 1491);
  assert.equal(rows[0].date, '2020-01-01');
  assert.equal(rows.at(-1).date, '2025-12-31');
});

test('(b) default run: daily rows match the owner backtest_daily.csv in every numeric column', () => {
  const result = defaultRun();
  assert.equal(result.daily.length, 1491);
  const mismatches = compareDaily(result, readCsv(DEFAULT_DAILY));
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('(b) alt run (monthly 20000, maxExposure 0.8, costBps 5): daily rows match the owner alt output', () => {
  const result = altRun();
  assert.equal(result.daily.length, 1491);
  const mismatches = compareDaily(result, readCsv(ALT_DAILY));
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('(c) default metrics match summary_metrics.csv for DCA and VM', () => {
  const mismatches = compareSummary(defaultRun().metrics, readCsv(DEFAULT_SUMMARY));
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('(c) alt metrics match the owner alt summary_metrics.csv for DCA and VM', () => {
  const mismatches = compareSummary(altRun().metrics, readCsv(ALT_SUMMARY));
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('(d) headline numbers, default run', () => {
  const { dca, vm } = defaultRun().metrics;
  assertNear(dca.endingEquity, 1102351.124905886, 'dca.endingEquity');
  assertNear(vm.endingEquity, 1047455.5837752449, 'vm.endingEquity');
  assertNear(dca.maxDrawdown, -0.3843985342533347, 'dca.maxDrawdown');
  assertNear(vm.maxDrawdown, -0.14140775327244648, 'vm.maxDrawdown');
  assertNear(dca.sharpe, 0.8057415841991944, 'dca.sharpe');
  assertNear(vm.sharpe, 1.1525132625090042, 'vm.sharpe');
});

test('(e) invariants, default run: equity identity, contribution days, targets, DCA cash', () => {
  const { daily } = defaultRun();
  for (const row of daily) {
    assert.ok(Math.abs(row.dcaEquity - (row.dcaShares * row.price + row.dcaCash)) <= 1e-6, `dca identity ${row.date}`);
    assert.ok(Math.abs(row.vmEquity - (row.vmShares * row.price + row.vmCash)) <= 1e-6, `vm identity ${row.date}`);
    assert.ok(Math.abs(row.dcaCash) <= 1e-9, `dca cash ${row.date}`);
    assert.ok(row.vmTarget >= 0 && row.vmTarget <= 1, `vm target range ${row.date}`);
  }

  const contributionDays = daily.filter((row) => row.contribution > 0).map((row) => row.date);
  const firstOfMonth = daily
    .filter((row, i) => i === 0 || row.date.slice(0, 7) !== daily[i - 1].date.slice(0, 7))
    .map((row) => row.date);
  assert.equal(contributionDays.length, 72);
  assert.deepEqual(contributionDays, firstOfMonth);
  assert.equal(daily.reduce((sum, row) => sum + row.contribution, 0), 720000);

  for (const row of daily) {
    if (row.date.startsWith('2020-01') || row.date.startsWith('2020-02')) {
      assert.equal(row.vmTarget, 0, `vm target zero ${row.date}`);
    }
  }
});

test('(f) extras match test/reference_dcavm_extras.json (pandas reference, default run)', () => {
  const want = JSON.parse(readFileSync(EXTRAS, 'utf8'));
  const result = defaultRun();
  const got = {
    dca: result.metrics.dca,
    vm: result.metrics.vm,
    control: result.control,
    timingEffect: result.timingEffect,
  };
  const mismatches = deepCompare(got, want, '', []);
  assert.deepEqual(mismatches.slice(0, 10), []);
});

function syntheticRows(days, priceFn) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    return { date, close: priceFn(i) };
  });
}

test('(g) flat price, costBps 0: DCA and VM ending equity equal total contributions', () => {
  const rows = syntheticRows(182, () => 100);
  const { metrics } = dcaVsVm(rows, { monthly: 10000, maxExposure: 1, costBps: 0 });
  const total = 6 * 10000;
  assertNear(metrics.dca.endingEquity, total, 'dca endingEquity');
  assertNear(metrics.vm.endingEquity, total, 'vm endingEquity');
});

test('(g) price doubles after the first contribution, maxExposure 1: VM stays in cash and equals contributions', () => {
  const rows = syntheticRows(182, (i) => (i === 0 ? 100 : 200));
  const result = dcaVsVm(rows, { monthly: 10000, maxExposure: 1, costBps: 0 });
  const firstTwoMonths = result.daily.filter((row) => row.date < '2020-03-01');
  assert.ok(firstTwoMonths.length > 0);
  for (const row of firstTwoMonths) assert.equal(row.vmTarget, 0, `target ${row.date}`);
  assertNear(result.metrics.vm.endingEquity, 6 * 10000, 'vm endingEquity');
});

test('(g) costBps 100 with one contribution: DCA fee is exactly 1% of the buy', () => {
  const rows = syntheticRows(30, () => 100);
  const result = dcaVsVm(rows, { monthly: 10000, maxExposure: 1, costBps: 100 });
  const first = result.daily[0];
  assert.equal(first.contribution, 10000);
  assertNear(first.dcaCost, 100, 'dca fee');
  assertNear(first.dcaShares, (10000 - 100) / 100, 'dca shares');
});

const BANK_CSV = fixture('NIFTYBANK_2020-2025_merged.csv');
const BANK_DAILY = fixture('bank/backtest_daily.csv');
const BANK_SUMMARY = fixture('bank/summary_metrics.csv');
const BANK_EXTRAS = fileURLToPath(new URL('./reference_dcavm_extras_bank.json', import.meta.url));

let bankCache;
function bankRun() {
  bankCache ??= dcaVsVm(parseCsv(readFileSync(BANK_CSV, 'utf8')), { monthly: 10000, maxExposure: 1, costBps: 0 });
  return bankCache;
}

test('Bank Nifty: parseCsv reads 1,491 rows from 2020-01-01 to 2025-12-31 in NSE format', () => {
  const rows = parseCsv(readFileSync(BANK_CSV, 'utf8'));
  assert.equal(rows.length, 1491);
  assert.equal(rows[0].date, '2020-01-01');
  assert.equal(rows.at(-1).date, '2025-12-31');
});

test('Bank Nifty: dcaVsVm daily rows equal the owner script output (every numeric column)', () => {
  const result = bankRun();
  assert.equal(result.daily.length, 1491);
  const mismatches = compareDaily(result, readCsv(BANK_DAILY));
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('Bank Nifty: summary metrics equal the owner script output', () => {
  const mismatches = compareSummary(bankRun().metrics, readCsv(BANK_SUMMARY));
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('Bank Nifty: extras equal the independent pandas reference', () => {
  const want = JSON.parse(readFileSync(BANK_EXTRAS, 'utf8'));
  const result = bankRun();
  const got = {
    dca: result.metrics.dca,
    vm: result.metrics.vm,
    control: result.control,
    timingEffect: result.timingEffect,
  };
  const mismatches = deepCompare(got, want, '', []);
  assert.deepEqual(mismatches.slice(0, 10), []);
});
