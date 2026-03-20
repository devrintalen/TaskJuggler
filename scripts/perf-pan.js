#!/usr/bin/env node
/**
 * perf-pan.js — Focused pan-performance test for tjgantt.js
 *
 * Usage:
 *   node scripts/perf-pan.js [path/to/Report.html] [--ppd <value>] [--trace]
 *
 * Loads the given report (default: ResourceGraph.html) at a 1914×877 viewport,
 * sets the zoom level to the specified ppd (default: 21.646 — week LOD),
 * then runs left/right pan sweeps and reports frame-time and per-function stats.
 *
 * Pass --trace to also save a chrome-trace JSON for use in DevTools.
 */

'use strict';

const puppeteer = require('../node_modules/puppeteer');
const path      = require('path');
const fs        = require('fs');

const args     = process.argv.slice(2);
const doTrace  = args.includes('--trace');

const ppdIdx   = args.indexOf('--ppd');
const targetPpd = ppdIdx >= 0 ? parseFloat(args[ppdIdx + 1]) : 21.646;

const htmlArg  = args.find(a => !a.startsWith('--') && (ppdIdx < 0 || args.indexOf(a) !== ppdIdx + 1))
               || 'ResourceGraph.html';
const htmlFile = path.resolve(htmlArg);
const traceOut = htmlFile.replace(/\.html$/i, '') + '-pan-trace.json';

if (!fs.existsSync(htmlFile)) {
  console.error('File not found:', htmlFile);
  process.exit(1);
}

/* ── Statistics helpers ── */
function stats(arr) {
  if (!arr.length) { return { n: 0, avg: 0, p95: 0, max: 0 }; }
  const sorted = arr.slice().sort((a, b) => a - b);
  const sum    = arr.reduce((a, b) => a + b, 0);
  return {
    n:   arr.length,
    avg: sum / arr.length,
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1]
  };
}

function fmt(ms) { return ms.toFixed(2) + 'ms'; }

function printTable(title, rows) {
  console.log('\n' + title);
  const colW = [22, 7, 10, 10, 10];
  const headers = ['Function', 'Calls', 'Avg', 'P95', 'Max'];
  const line = headers.map((h, i) => h.padEnd(colW[i])).join('  ');
  console.log('  ' + line);
  console.log('  ' + '-'.repeat(line.length));
  rows.forEach(r => {
    const cells = [
      r[0].padEnd(colW[0]),
      String(r[1]).padEnd(colW[1]),
      fmt(r[2]).padEnd(colW[2]),
      fmt(r[3]).padEnd(colW[3]),
      fmt(r[4]).padEnd(colW[4])
    ];
    console.log('  ' + cells.join('  '));
  });
}

async function runPanSweep(page, label, dx, ticks, intervalMs) {
  console.log(`  Running ${label} (${ticks} ticks @ ~${intervalMs}ms apart)...`);
  const t0 = Date.now();
  await page.evaluate(
    ({ ticks, intervalMs, dx }) => new Promise(resolve => {
      let i = 0;
      const step = () => {
        if (i >= ticks) { resolve(); return; }
        window.tjGanttPan(dx);
        i++;
        setTimeout(step, intervalMs);
      };
      step();
    }),
    { ticks, intervalMs, dx }
  );
  console.log(`    done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

(async () => {
  console.log('='.repeat(60));
  console.log('tjgantt.js Pan Performance Test');
  console.log('File:', htmlFile);
  console.log('Target PPD:', targetPpd);
  console.log('Viewport: 1914×877');
  console.log('='.repeat(60));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1914, height: 877 });

    /* Enable perf mode before anything loads. */
    await page.evaluateOnNewDocument(() => { window.tjGanttPerf = true; });

    if (doTrace) {
      await page.tracing.start({
        path: traceOut,
        categories: ['devtools.timeline', 'v8']
      });
    }

    await page.goto('file://' + htmlFile, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#tj-gantt-container svg', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 600));  // let initial render complete

    /* Set exact zoom level. */
    console.log(`\nSetting zoom to ${targetPpd} ppd...`);
    const setPpdResult = await page.evaluate((ppd) => {
      if (typeof window.tjGanttSetPpd !== 'function') {
        return { ok: false, error: 'tjGanttSetPpd not available' };
      }
      window.tjGanttSetPpd(ppd);
      return { ok: true };
    }, targetPpd);

    if (!setPpdResult.ok) {
      console.error('ERROR:', setPpdResult.error);
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 300));  // let zoom render settle

    /* ── Pan sweep: 120 left + 120 right at the target zoom, 5 passes ── */
    await runPanSweep(page, 'pan sweep (left)',  -200, 120, 16);
    await runPanSweep(page, 'pan sweep (right)',  200, 120, 16);
    await runPanSweep(page, 'pan sweep (left)',  -200, 120, 16);
    await runPanSweep(page, 'pan sweep (right)',  200, 120, 16);
    await runPanSweep(page, 'pan sweep (left)',  -200, 120, 16);
    await runPanSweep(page, 'pan sweep (right)',  200, 120, 16);
    await runPanSweep(page, 'pan sweep (left)',  -200, 120, 16);
    await runPanSweep(page, 'pan sweep (right)',  200, 120, 16);
    await runPanSweep(page, 'pan sweep (left)',  -200, 120, 16);
    await runPanSweep(page, 'pan sweep (right)',  200, 120, 16);

    /* Wait for any in-flight RAFs to settle. */
    await new Promise(r => setTimeout(r, 400));

    if (doTrace) {
      await page.tracing.stop();
      console.log('\nChrome trace saved to:', traceOut);
    }

    /* ── Collect results ── */
    const report = await page.evaluate(() => window.tjGanttPerfReport());
    if (!report) {
      console.error('\nERROR: window.tjGanttPerfReport not found — is tjGanttPerf instrumentation active?');
      process.exit(1);
    }

    /* Frame timing */
    const frames  = (report.frames || []).filter(t => t > 0);
    const fStats  = stats(frames);
    const dropped = frames.filter(t => t > 16.7).length;

    console.log('\n── Frame timing (' + frames.length + ' frames) ──');
    console.log('  Avg frame time : ' + fmt(fStats.avg) + ' (' + (1000 / fStats.avg).toFixed(0) + ' fps)');
    console.log('  P95 frame time : ' + fmt(fStats.p95));
    console.log('  Worst frame    : ' + fmt(fStats.max));
    console.log('  Dropped (>16.7ms): ' + dropped + '/' + frames.length +
                ' (' + (100 * dropped / Math.max(1, frames.length)).toFixed(1) + '%)');

    /* Per-function timing */
    const fnData = report.fns || {};
    const fnRows = Object.keys(fnData)
      .map(name => {
        const s = stats(fnData[name]);
        return [name, s.n, s.avg, s.p95, s.max];
      })
      .sort((a, b) => b[3] - a[3]);  // sort by p95 descending

    printTable('── Per-function timing (sorted by P95) ──', fnRows);

    console.log('\n' + '='.repeat(60));

  } finally {
    await browser.close();
  }
})();
