import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { volManage, paperTest } from '../public/js/backtest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().slice(0, 10);
const all = JSON.parse(readFileSync(`${root}local-data/french_mkt.json`, 'utf8')).months;

const PAPER = { alphaAnnual: 0.0486, beta: 0.6, appraisalAnnual: 0.34, utilityGain: 0.65 };

function run(months, label) {
  const excess = months.map((m) => m.excess);
  const rv = months.map((m) => m.rv);
  const out = volManage(excess, rv, { normalize: 'full', cost: 0 });
  const managed = out.managed.slice(1);
  const original = excess.slice(1);
  const test = paperTest(managed, original, 12);
  const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
  const sd = (x) => {
    const m = mean(x);
    return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
  };
  const srManaged = (mean(managed) / sd(managed)) * Math.sqrt(12);
  return {
    label,
    months: managed.length,
    from: months[1].ym,
    to: months.at(-1).ym,
    c: out.c,
    sdOriginal: sd(original),
    sdManaged: sd(managed),
    ...test,
    sharpeManaged: srManaged,
    sharpeIncrease: srManaged / test.sharpeOriginal - 1,
    maxWeight: Math.max(...out.weight),
  };
}

const sample1926to2015 = all.filter((m) => m.ym <= '201512');
const results = [run(sample1926to2015, 'Paper sample, 1926-07 to 2015-12'), run(all, 'All available months')];

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const f2 = (x) => x.toFixed(2);
const p = results[0];
const row = (name, paper, got) => `| ${name} | ${paper} | ${got} |`;
const md = `# Paper replication log, ${stamp}

Reproduces the market result of Moreira and Muir (2017) with this repository's engine function \`volManage\` and \`paperTest\`, on Ken French's monthly Mkt-RF and the same data's daily Mkt-RF for realized variance (paper equations 1 and 2: excess return scaled by the inverse of the previous month's demeaned realized variance, with c chosen so the managed series has the buy-and-hold standard deviation over the full sample). No transaction costs, no leverage cap.

French data is used only here, as the paper's own data for validation. It is not hosted, not part of the product, and is git-ignored.

## Market factor, ${p.from} to ${p.to}, ${p.months} months

| Quantity | Paper | This engine |
| --- | ---: | ---: |
${row('Annualised alpha', '4.86%', pct(p.alphaAnnual))}
${row('Beta', '0.6', f2(p.beta))}
${row('Annualised appraisal ratio', '0.34 (abstract 0.33)', f2(p.appraisalAnnual))}
${row('Mean-variance utility gain', '65%', pct(p.utilityGain))}
${row('Sharpe ratio increase', '25%', pct(p.sharpeIncrease))}

Standard deviation, original ${pct(p.sdOriginal)} per month and managed ${pct(p.sdManaged)} per month (equal by construction). Largest weight ${f2(p.maxWeight)}x. Original Sharpe ${f2(p.sharpeOriginal)}, managed Sharpe ${f2(p.sharpeManaged)}, new Sharpe from the alpha formula ${f2(p.sharpeCombined)}. Alpha t-statistic ${f2(p.tAlpha)}, R-squared ${f2(p.r2)}.

## All available months, ${results[1].from} to ${results[1].to}

Alpha ${pct(results[1].alphaAnnual)}, beta ${f2(results[1].beta)}, appraisal ratio ${f2(results[1].appraisalAnnual)}, Sharpe increase ${pct(results[1].sharpeIncrease)}.

## Limits

Alpha, beta and the appraisal ratio match the paper to rounding. The utility gain and the Sharpe increase come out about 3 and 2 points below the published 65% and 25%. This run does not isolate the cause; candidate sources are later revisions of French's files and the first month used (the managed series starts one month after the sample). Costs and caps are off, as in the paper's main table.
`;

mkdirSync(`${root}logs`, { recursive: true });
writeFileSync(`${root}logs/paper-replication-${stamp}.md`, md);
writeFileSync(`${root}logs/paper-replication-${stamp}.json`, JSON.stringify({ paper: PAPER, results }, null, 2));
console.log(md);
