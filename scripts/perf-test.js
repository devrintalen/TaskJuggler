#!/usr/bin/env node
/**
 * perf-test.js — Performance benchmark for tjgantt.js
 *
 * Usage:
 *   node scripts/perf-test.js [path/to/Report.html] [--trace]
 *
 * Runs two sweeps against the given report (default: Development.html):
 *   1. Zoom sweep — 150 ticks in then 150 out, one per frame (~16ms apart),
 *      covering all LOD levels (day ↔ year).
 *   2. Pan sweep — 150 leftward drags then 150 back at a mid-range zoom.
 *
 * Outputs a summary table of per-function call counts and timing (avg/p95/max)
 * plus overall frame-time statistics (avg, p95, drop rate).
 *
 * Pass --trace to also save a chrome-trace JSON for use in DevTools.
 */

'use strict';

const puppeteer = require('../node_modules/puppeteer');
const path      = require('path');
const fs        = require('fs');

const args     = process.argv.slice(2);
const doTrace  = args.includes('--trace');
const htmlArg  = args.find(a => !a.startsWith('--')) || 'Development.html';
const htmlFile = path.resolve(htmlArg);
const traceOut = htmlFile.replace(/\.html$/i, '') + '-trace.json';

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

/* ── Main ── */
async function runZoomSweep(page, label, deltaY, ticks, cx, cy, intervalMs) {
  console.log(`  Running ${label} (${ticks} ticks @ ~${intervalMs}ms apart)...`);
  const t0 = Date.now();
  await page.evaluate(
    ({ ticks, intervalMs, deltaY, cx, cy }) => new Promise(resolve => {
      const svg = document.querySelector('#tj-gantt-container svg');
      let i = 0;
      const step = () => {
        if (i >= ticks) { resolve(); return; }
        if (svg) {
          svg.dispatchEvent(new WheelEvent('wheel', {
            deltaY, clientX: cx, clientY: cy, bubbles: true, cancelable: true
          }));
        }
        i++;
        setTimeout(step, intervalMs);
      };
      step();
    }),
    { ticks, intervalMs, deltaY, cx, cy }
  );
  console.log(`    done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function runPanSweep(page, label, dx, ticks, cy, intervalMs) {
  console.log(`  Running ${label} (${ticks} ticks @ ~${intervalMs}ms apart)...`);
  const t0 = Date.now();
  await page.evaluate(
    ({ ticks, intervalMs, dx, cy }) => new Promise(resolve => {
      const svg = document.querySelector('#tj-gantt-container svg');
      let i = 0;
      const step = () => {
        if (i >= ticks) { resolve(); return; }
        if (svg) {
          const rect = svg.getBoundingClientRect();
          const x0   = rect.left + rect.width / 2;
          svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0,      clientY: cy, bubbles: true, isPrimary: true }));
          svg.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + dx, clientY: cy, bubbles: true, isPrimary: true }));
          svg.dispatchEvent(new PointerEvent('pointerup',   { clientX: x0 + dx, clientY: cy, bubbles: true, isPrimary: true }));
        }
        i++;
        setTimeout(step, intervalMs);
      };
      step();
    }),
    { ticks, intervalMs, dx, cy }
  );
  console.log(`    done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

(async () => {
  console.log('='.repeat(60));
  console.log('tjgantt.js Performance Benchmark');
  console.log('File:', htmlFile);
  console.log('='.repeat(60));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

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

    /* ── Zoom sweep: 150 in + 150 out, one per ~16ms frame ── */
    const cx = 700, cy = 200;
    await runZoomSweep(page, 'zoom sweep (in)',  -50, 150, cx, cy, 16);
    await runZoomSweep(page, 'zoom sweep (out)',  50, 150, cx, cy, 16);

    /* ── Pan sweep: 60 left + 60 right at current zoom ── */
    await runPanSweep(page, 'pan sweep (left)',  -80, 60, cy, 16);
    await runPanSweep(page, 'pan sweep (right)',  80, 60, cy, 16);

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
    const frames = (report.frames || []).filter(t => t > 0);
    const fStats = stats(frames);
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
