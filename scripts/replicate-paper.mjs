import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paperStudyFromMonthly } from '../public/js/backtest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().slice(0, 10);
const all = JSON.parse(readFileSync(`${root}local-data/french_mkt.json`, 'utf8')).months;

const SAMPLES = [
  { id: 'A', label: 'Sample A, every month to December 2015', last: '201512' },
  { id: 'B', label: 'Sample B, every month to April 2015', last: '201504' },
];

const pct = (x) => x * 100;
const annRmse = (x) => x * 12 * 100;
const seOf = (alphaFrac, t) => (alphaFrac * 100) / t;
const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

const T4 = [
  { name: 'Realized Variance', key: 'variance', p: { dw: 0.73, er: 9.47, a: 4.86, a1: 4.77, a10: 3.98, a14: 3.63, be: 56 } },
  { name: 'Realized Volatility', key: 'volatility', p: { dw: 0.38, er: 9.84, a: 3.85, a1: 3.8, a10: 3.39, a14: 3.21, be: 84 } },
  { name: 'No Leverage', key: 'variance_cap1', p: { dw: 0.16, er: 5.61, a: 2.12, a1: 2.1, a10: 1.93, a14: 1.85, be: 110 } },
  { name: '50% Leverage', key: 'variance_cap1_5', p: { dw: 0.16, er: 7.18, a: 3.1, a1: 3.08, a10: 2.91, a14: 2.83, be: 161 } },
];

const T5 = [
  { name: 'Realized Variance', key: 'variance', w: [0.93, 1.59, 2.64, 6.39], alpha: 4.86, se: 1.56, sharpe: 0.52, app: 0.34 },
  { name: 'Realized Volatility', key: 'volatility', w: [1.23, 1.61, 2.08, 3.36], alpha: 3.3, se: 1.02, sharpe: 0.53, app: 0.33 },
  { name: 'No Leverage', key: 'variance_cap1', w: [0.93, 1, 1, 1], alpha: 2.12, se: 0.71, sharpe: 0.52, app: 0.3 },
  { name: '50% Leverage', key: 'variance_cap1_5', w: [0.93, 1.5, 1.5, 1.5], alpha: 3.1, se: 0.98, sharpe: 0.53, app: 0.33 },
];

function buildRows(s) {
  const P = s.paper;
  const V = (k) => s.variants.find((x) => x.key === k);
  const rows = [];
  const add = (table, quantity, paper, dec, engine) => rows.push({ table, quantity, paper, dec, engine });
  const skip = (table, quantity) => rows.push({ table, quantity, paper: null, dec: 0, engine: null });

  add('I and II', 'Alpha (% per year)', 4.86, 2, pct(P.alphaAnnual));
  add('I and II', 'Alpha robust s.e. (% per year)', 1.56, 2, seOf(P.alphaAnnual, P.tAlphaRobust));
  add('I', 'Beta', 0.61, 2, P.beta);
  add('I', 'Beta robust s.e.', 0.05, 2, P.beta / P.tBetaRobust);
  add('I and II', 'Observations (N)', 1065, 0, s.n);
  add('I and II', 'R-squared', 0.37, 2, P.r2);
  add('I and II', 'RMSE (% per year)', 51.39, 2, annRmse(P.rmse));
  add('II', 'Original Sharpe ratio', 0.42, 2, P.sharpeOriginal);
  add('II', 'Vol-managed Sharpe ratio', 0.51, 2, P.sharpeManaged);
  add('II', 'Appraisal ratio', 0.33, 2, P.appraisalAnnual);

  for (const t of T4) {
    const v = V(t.key);
    const q = (x) => `IV ${t.name}: ${x}`;
    add('IV', q('|dw| (avg absolute weight change)'), t.p.dw, 2, v.avgAbsWeightChange);
    add('IV', q('E[R] (% per year)'), t.p.er, 2, pct(v.expectedReturnAnnual));
    add('IV', q('alpha (% per year)'), t.p.a, 2, pct(v.alphaAnnual));
    add('IV', q('alpha after 1bp cost (% per year)'), t.p.a1, 2, pct(v.alphaAfterCost['1']));
    add('IV', q('alpha after 10bp cost (% per year)'), t.p.a10, 2, pct(v.alphaAfterCost['10']));
    add('IV', q('alpha after 14bp cost (% per year)'), t.p.a14, 2, pct(v.alphaAfterCost['14']));
    add('IV', q('break-even cost (bp)'), t.p.be, 0, v.breakEvenBp);
  }
  skip('IV', 'Expected Variance (not implemented in this engine)');

  for (const t of T5) {
    const v = V(t.key);
    const q = (x) => `V ${t.name}: ${x}`;
    ['P50', 'P75', 'P90', 'P99'].forEach((lab, i) => {
      const k = lab.toLowerCase();
      add('V', q(`weight ${lab}`), t.w[i], 2, v.weights[k]);
    });
    add('V', q('alpha (% per year)'), t.alpha, 2, pct(v.alphaAnnual));
    add('V', q('alpha s.e. (% per year)'), t.se, 2, seOf(v.alphaAnnual, v.tAlphaRobust));
    add('V', q('Sharpe ratio'), t.sharpe, 2, v.sharpeManaged);
    add('V', q('appraisal ratio'), t.app, 2, v.appraisalAnnual);
  }
  skip('V', 'Expected Variance (not implemented in this engine)');
  return rows;
}

function judge(r) {
  if (r.engine == null) return { ...r, paperText: '-', engineText: 'not implemented', diffText: '-', verdict: 'not implemented' };
  const e = Number(r.engine.toFixed(r.dec));
  const diff = e - r.paper;
  const verdict = Math.abs(diff) <= 1.5 * 10 ** -r.dec + 1e-9 ? 'matches' : 'differs';
  return {
    ...r,
    engine: e,
    paperText: fmt(r.paper, r.dec),
    engineText: fmt(e, r.dec),
    diffText: `${diff >= 0 ? '+' : ''}${fmt(diff, r.dec)}`,
    verdict,
  };
}

function tableMd(rows) {
  const head = '| Quantity | Paper | This engine | Difference | Verdict |\n| --- | ---: | ---: | ---: | --- |';
  return [head, ...rows.map((r) => `| ${r.quantity} | ${r.paperText} | ${r.engineText} | ${r.diffText} | ${r.verdict} |`)].join('\n');
}

const results = [];
for (const sample of SAMPLES) {
  const months = all.filter((m) => m.ym <= sample.last);
  const excess = months.map((m) => m.excess);
  const rv = months.map((m) => m.rv);
  const keys = months.map((m) => m.ym);
  const study = paperStudyFromMonthly(excess, rv, { keys, rf: 0 });
  const rows = buildRows(study).map(judge);
  results.push({ ...sample, from: study.from, to: study.to, n: study.n, study, rows });
}

const published = { source: 'Moreira and Muir (2017), printed pages: Table I p.42, Table II p.43, Table IV p.45, Table V p.46' };
const section = (r, title) => {
  const groups = [
    ['I and II', 'Tables I and II, market factor'],
    ['IV', 'Table IV, weights, returns, costs and break-even'],
    ['V', 'Table V, Panel A, weights, alpha, Sharpe and appraisal'],
  ];
  const parts = [`## ${title}: ${r.from} to ${r.to}, ${r.n} managed months`];
  for (const [id, name] of groups) {
    const g = r.rows.filter((x) => (id === 'I and II' ? ['I and II', 'I', 'II'].includes(x.table) : x.table === id));
    parts.push(`### ${name}\n\n${tableMd(g)}`);
  }
  return parts.join('\n\n');
};

const summary = results.map((r) => {
  const compared = r.rows.filter((x) => x.verdict !== 'not implemented');
  const matches = compared.filter((x) => x.verdict === 'matches').length;
  const differs = compared.filter((x) => x.verdict === 'differs');
  const lines = differs.map((x) => `- ${x.quantity}: paper ${x.paperText}, this engine ${x.engineText}`);
  return `### ${r.label}\n\n${matches} of ${compared.length} compared quantities match.${lines.length ? `\n\nDiffers:\n\n${lines.join('\n')}` : ''}`;
});

const md = `# Paper replication, Moreira and Muir (2017), market factor, ${stamp}

Ken French's monthly Mkt-RF and the realized variance computed from the same series' daily Mkt-RF, run through the product's own code path (\`paperStudyFromMonthly\` in \`public/js/backtest.js\`). The French data is the paper's own data, used here only for validation; it is local and git-ignored, not hosted, and not part of the product. Published values are transcribed from the printed pages of the paper (${published.source}). Engine values are rounded to the paper's printed decimals before differencing. A row matches when the difference is within 1.5 units of the last printed digit. Nothing was tuned to make numbers match.

${results.map((r) => section(r, r.label)).join('\n\n')}

## Summary

${summary.join('\n\n')}

## Limits

- Data vintage: Ken French's files have been revised since 2015, so differences can come from revisions in the input, not from the engine.
- The paper prints the Realized Volatility alpha as 3.85 in Table IV and 3.30 in Table V, and swaps those two values for the expected-variance row. Both printed values are compared here, one per table.
- The engine has no expected-variance row. It is listed as not implemented and is not counted in the match totals.
- Equality is checked to printed precision only. The verdict says the engine's value agrees with the printed digits, not that the underlying values are identical.
- Sample B's end month (2015-04) is inferred from the paper's N = 1,065. N is compared as an integer.
- Weights printed as "1" in Table V are compared at two decimals, as 1.00.
- Costs and leverage caps follow the paper's Table IV variants. The paper's Table IV no-leverage row uses the cap at 1.0, and the 50% row uses the cap at 1.5.
`;

mkdirSync(`${root}logs`, { recursive: true });
writeFileSync(`${root}logs/paper-replication-${stamp}.md`, md);
writeFileSync(
  `${root}logs/paper-replication-${stamp}.json`,
  JSON.stringify(
    {
      stamp,
      published,
      samples: results.map((r) => ({ id: r.id, label: r.label, from: r.from, to: r.to, n: r.n, rows: r.rows, study: r.study })),
    },
    null,
    2,
  ),
);
console.log(md);
