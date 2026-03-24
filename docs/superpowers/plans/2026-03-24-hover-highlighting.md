# Hover Highlighting for JS Gantt Chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover highlighting to `tjchart.js` — row hover brightens the stripe in both panels; bar hover additionally highlights the full transitive predecessor chain (bars + arrows) in distinct colors.

**Architecture:** Two new SVG overlay groups (`gRowHighlight`, `gBarHighlight`) sit above `gStripes` and `gArrows` respectively. Hover state is tracked in two module-level variables; two update functions clear and redraw only the overlay groups on each hover event, leaving the main render untouched. The pan fast path includes `gBarHighlight` in its translate; `_lastXScale` ensures overlay bars are always drawn in full-render coordinates so the group transform does the right thing.

**Tech Stack:** Vanilla JS (ES5), D3.js v7, SVG. No JS test framework — verification is manual (generate an htmljs report and inspect in browser). Ruby/RSpec covers Ruby-side behavior; no Ruby changes in this feature.

**Run the dev binary as:** `ruby ~/repos/TaskJuggler/bin/tj3 <args>`  (not the system `tj3` on PATH)

---

## Files

| File | Action |
|------|--------|
| `data/js/tjchart.js` | All changes; single IIFE, ~1345 lines at start |
| `test/TestSuite/HTML-Reports/depArrows.tjp` | Existing test project with dependencies — add `htmljs` format for manual browser testing |

---

## Task 1: Add a test fixture with `htmljs` format

`depArrows.tjp` already has tasks with `depends` chains — ideal for testing the ancestor highlight. Add `htmljs` as a second format so we can open the result in a browser throughout development.

**Files:**
- Modify: `test/TestSuite/HTML-Reports/depArrows.tjp:68-69`

- [ ] **Step 1.1: Add `htmljs` to the depArrows report formats**

Open `test/TestSuite/HTML-Reports/depArrows.tjp`. Find:
```
taskreport "depArrows" {
  formats html
```
Change to:
```
taskreport "depArrows" {
  formats html, htmljs
```

- [ ] **Step 1.2: Generate and open the htmljs report**

```bash
cd /tmp && ruby ~/repos/TaskJuggler/bin/tj3 ~/repos/TaskJuggler/test/TestSuite/HTML-Reports/depArrows.tjp
```

Expected: `depArrows.html` and `depArrows.htmljs` created in `/tmp/`.
Open `depArrows.htmljs` in a browser. The chart should display normally with no JS errors in the console.

- [ ] **Step 1.3: Commit**

```bash
cd ~/repos/TaskJuggler
git add test/TestSuite/HTML-Reports/depArrows.tjp
git commit -m "Test: Add htmljs format to depArrows fixture for hover-highlight dev"
```

---

## Task 2: Add the highlighted arrowhead marker to SVG `<defs>`

The highlighted arrows need their own orange arrowhead marker (`#tjArrowHL`). Adding it now means the marker is available as soon as we start drawing highlighted arrows.

**Files:**
- Modify: `data/js/tjchart.js:480-494` (the `<defs>` / `#tjArrow` marker block)

- [ ] **Step 2.1: Add `#tjArrowHL` marker after the existing `#tjArrow` marker**

Find this block (around line 480):
```js
  var defs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(defs);
  var marker = document.createElementNS(svgNS, 'marker');
  marker.setAttribute('id', 'tjArrow');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '5');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  var arrowPoly = document.createElementNS(svgNS, 'polygon');
  arrowPoly.setAttribute('points', '0,0 6,3 0,6');
  arrowPoly.setAttribute('fill', C.depline);
  marker.appendChild(arrowPoly);
  defs.appendChild(marker);
```

After `defs.appendChild(marker);`, add:
```js
  var markerHL = document.createElementNS(svgNS, 'marker');
  markerHL.setAttribute('id', 'tjArrowHL');
  markerHL.setAttribute('markerWidth', '6');
  markerHL.setAttribute('markerHeight', '6');
  markerHL.setAttribute('refX', '5');
  markerHL.setAttribute('refY', '3');
  markerHL.setAttribute('orient', 'auto');
  var arrowPolyHL = document.createElementNS(svgNS, 'polygon');
  arrowPolyHL.setAttribute('points', '0,0 6,3 0,6');
  arrowPolyHL.setAttribute('fill', '#e07800');
  markerHL.appendChild(arrowPolyHL);
  defs.appendChild(markerHL);
```

- [ ] **Step 2.2: Verify in browser**

Regenerate: `cd /tmp && ruby ~/repos/TaskJuggler/bin/tj3 ~/repos/TaskJuggler/test/TestSuite/HTML-Reports/depArrows.tjp`

Open `depArrows.htmljs`. Open DevTools → Elements, find the `<defs>` block inside the SVG. Confirm both `#tjArrow` and `#tjArrowHL` markers are present. Chart should look identical to before.

- [ ] **Step 2.3: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Add #tjArrowHL SVG marker for highlighted dependency arrows"
```

---

## Task 3: Insert new SVG layer groups

Two new `<g>` groups must be inserted into the layer stack at specific positions. Do this in the group-creation block around line 515.

**Files:**
- Modify: `data/js/tjchart.js:514-524` (layer group declarations)
- Modify: `data/js/tjchart.js:1285-1315` (pan fast path + full render in `render()`)

- [ ] **Step 3.1: Add `gRowHighlight` and `gBarHighlight` to the layer group declarations**

Find this block (around line 514):
```js
  var gBody    = makeG('tj-body');
  var gStripes = makeG('tj-stripes', gBody);
  var gTimeOff = makeG('tj-timeoff', gBody);
  var gBars    = makeG('tj-bars',    gBody);
  var gArrows  = makeG('tj-arrows',  gBody);
  var gNow     = makeG('tj-now',     gBody);
  var gGrid    = makeG('tj-grid',    gBody);
```

Replace with:
```js
  var gBody         = makeG('tj-body');
  var gStripes      = makeG('tj-stripes',       gBody);
  var gRowHighlight = makeG('tj-row-highlight', gBody);
  var gTimeOff      = makeG('tj-timeoff',       gBody);
  var gBars         = makeG('tj-bars',          gBody);
  var gArrows       = makeG('tj-arrows',        gBody);
  var gBarHighlight = makeG('tj-bar-highlight', gBody);
  var gNow          = makeG('tj-now',           gBody);
  var gGrid         = makeG('tj-grid',          gBody);
```

- [ ] **Step 3.2: Add `gBarHighlight` to the pan fast path translate block**

Find the pan fast path block (around line 1289):
```js
        var xlate = 'translate(' + dx + ',0)';
        gBars.setAttribute('transform',    xlate);
        gGrid.setAttribute('transform',    xlate);
        gNow.setAttribute('transform',     xlate);
        gTimeOff.setAttribute('transform', xlate);
        gArrows.setAttribute('transform',  xlate);
```

Replace with:
```js
        var xlate = 'translate(' + dx + ',0)';
        gBars.setAttribute('transform',         xlate);
        gBarHighlight.setAttribute('transform', xlate);
        gGrid.setAttribute('transform',         xlate);
        gNow.setAttribute('transform',          xlate);
        gTimeOff.setAttribute('transform',      xlate);
        gArrows.setAttribute('transform',       xlate);
```

- [ ] **Step 3.3: Add `gBarHighlight` to the full-render transform reset block**

Find (around line 1301):
```js
    _panBaseT = { x: t.x, k: t.k };
    gBars.removeAttribute('transform');
    gGrid.removeAttribute('transform');
    gNow.removeAttribute('transform');
    gTimeOff.removeAttribute('transform');
    gArrows.removeAttribute('transform');
```

Replace with:
```js
    _panBaseT = { x: t.x, k: t.k };
    gBars.removeAttribute('transform');
    gBarHighlight.removeAttribute('transform');
    gGrid.removeAttribute('transform');
    gNow.removeAttribute('transform');
    gTimeOff.removeAttribute('transform');
    gArrows.removeAttribute('transform');
```

- [ ] **Step 3.4: Verify in browser**

Regenerate and open `depArrows.htmljs`. Chart should look and behave exactly as before. In DevTools → Elements confirm the layer order under `<g class="tj-body">` is:
`tj-stripes` → `tj-row-highlight` → `tj-timeoff` → `tj-bars` → `tj-arrows` → `tj-bar-highlight` → `tj-now` → `tj-grid`

- [ ] **Step 3.5: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Add gRowHighlight and gBarHighlight SVG layer groups"
```

---

## Task 4: Add hover state variables and `getAncestors()`

Add the module-level state and the ancestor BFS function. These have no visible effect yet.

**Files:**
- Modify: `data/js/tjchart.js` — insert near line 293, after `var _panBaseT = null;`

- [ ] **Step 4.1: Add hover state variables and `_lastXScale`**

Find (around line 293):
```js
  var _panBaseT = null; // zoom transform {x,k} saved at last full render (pan fast-path)
```

After that line, add:
```js
  /* ── Hover highlight state ── */
  var hoveredRowIdx = -1;   // index into rows[] (-1 = none)
  var hoveredBarId  = null; // row.id of the task bar under the cursor (null = none)
  var _lastXScale   = null; // xScale captured at last full render; used by updateBarHighlight
```

- [ ] **Step 4.2: Add `rowHoverColor()` and `getAncestors()` functions**

Add these two functions near the other small helpers (e.g. after `rowBgColor`, around line 270). Insert after the closing `}` of `rowBgColor`:

```js
  /* Return the highlight background colour for a hovered row. */
  function rowHoverColor(row) {
    var rt = row.rowType;
    if (rt === 'nested-task' || rt === 'task' || rt === undefined) {
      return '#b8d0ff';
    }
    return '#ffd4b0';
  }

  /* Return a Set of all transitive predecessor task ids for the given rowId,
   * following row.depends links in the primary scenario (sc0).
   * Result is cached permanently (tjGanttData is static for the page lifetime). */
  var _ancestorCache = {};
  function getAncestors(rowId) {
    if (_ancestorCache[rowId]) { return _ancestorCache[rowId]; }
    var result = new Set();
    var queue  = [rowId];
    while (queue.length) {
      var id   = queue.shift();
      var info = taskRowById[id];
      if (!info) { continue; }
      (info.row.depends || []).forEach(function (dep) {
        if ((dep.scenario || sc0) === sc0 && !result.has(dep.id)) {
          result.add(dep.id);
          queue.push(dep.id);
        }
      });
    }
    return (_ancestorCache[rowId] = result);
  }
```

- [ ] **Step 4.3: Verify no JS errors**

Regenerate and open `depArrows.htmljs`. Chart should still look and behave normally. No console errors.

- [ ] **Step 4.4: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Add hover state variables, rowHoverColor(), and getAncestors()"
```

---

## Task 5: Populate `rowTrs` / `rowBgs` in the table build loop

The row-highlight update function needs a reference to each row's primary `<tr>` and its original background color. Populate these arrays during the existing `rows.forEach` table-build loop.

**Files:**
- Modify: `data/js/tjchart.js:335-354` (table build loop)

- [ ] **Step 5.1: Declare `rowTrs` and `rowBgs` before the table build loop**

Find the comment `/* Data rows */` (around line 331) which precedes `var tbody = ...`. Just before the `rows.forEach` call at line 335, add:

```js
  var rowTrs = [];   /* rowTrs[i] = primary <tr> (scenarioTrs[0]) for row i */
  var rowBgs = [];   /* rowBgs[i] = original rowBgColor string for row i     */
```

- [ ] **Step 5.2: Record each row's primary `<tr>` and background color**

Inside the `rows.forEach(function (row, i) {` loop, immediately after the `scenarioTrs` array is built (after the `for (var s = 1 ...)` loop that pushes additional TRs, around line 353), add:

```js
    rowTrs.push(scenarioTrs[0]);
    rowBgs.push(bg);
```

The surrounding context looks like:
```js
    var scenarioTrs = [tr];
    for (var s = 1; s < span; s++) {
      var tr2 = document.createElement('tr');
      tr2.style.cssText = 'background:' + bg + ';height:' + ROW_H + 'px;';
      scenarioTrs.push(tr2);
    }
    // ← INSERT HERE
    rowTrs.push(scenarioTrs[0]);
    rowBgs.push(bg);
```

- [ ] **Step 5.3: Verify no JS errors**

Regenerate and open `depArrows.htmljs`. Chart looks and behaves normally. No console errors.

- [ ] **Step 5.4: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Populate rowTrs/rowBgs arrays for hover row tracking"
```

---

## Task 6: Extract `routeArrow()` helper from `renderArrows()`

`updateBarHighlight()` needs to redraw arrows using the same routing logic as `renderArrows()`. Extract that logic into a shared helper now, and update `renderArrows()` to call it. No behavior change.

**Files:**
- Modify: `data/js/tjchart.js:1213-1264` (`renderArrows` function)

- [ ] **Step 6.1: Extract `routeArrow()` just before `renderArrows()`**

Find the `renderArrows` function (around line 1213). Just before it, add:

```js
  /* Compute the SVG path string for a dependency arrow from (sx,sy) to (ex,ey).
   * Uses a three-segment H/V/H path when there is horizontal room, otherwise a
   * stepped detour that routes around overlapping bars.
   * Returns a path data string suitable for the 'd' attribute of an SVG <path>. */
  function routeArrow(sx, sy, ex, ey) {
    var x1 = sx + MIN_START_GAP;
    var x2 = ex - MIN_END_GAP;
    if (x1 < x2) {
      var xSeg = x1 + (x2 - x1) / 2;
      return 'M'+sx+','+sy+' H'+xSeg+' V'+ey+' H'+ex;
    } else {
      var deltaY = sy < ey ? 1 : -1;
      var ySeg   = sy + 8 * deltaY;
      var pts    = [[sx, sy], [x1, sy]];
      if (x1 !== x2) {
        pts.push([x1, ySeg], [x2, ySeg]);
      }
      pts.push([x2, ey], [ex, ey]);
      return pts.map(function (p, pi) {
        return (pi === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ');
    }
  }
```

- [ ] **Step 6.2: Update `renderArrows()` to use `routeArrow()`**

Inside `renderArrows()`, replace the path-building block:
```js
        var x1 = sx + MIN_START_GAP;
        var x2 = ex - MIN_END_GAP;
        var pathStr;
        if (x1 < x2) {
          var xSeg = x1 + (x2 - x1) / 2;
          pathStr = 'M'+sx+','+sy+' H'+xSeg+' V'+ey+' H'+ex;
        } else {
          var deltaY = sy < ey ? 1 : -1;
          var ySeg   = sy + 8 * deltaY;
          var pts    = [[sx, sy], [x1, sy]];
          if (x1 !== x2) {
            pts.push([x1, ySeg], [x2, ySeg]);
          }
          pts.push([x2, ey], [ex, ey]);
          pathStr = pts.map(function (p, pi) {
            return (pi === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
          }).join(' ');
        }

        svgEl('path', gArrows, {
          d: pathStr, fill: 'none', stroke: C.depline,
          'stroke-width': 1, 'marker-end': 'url(#tjArrow)'
        });
```

With:
```js
        var pathStr = routeArrow(sx, sy, ex, ey);
        svgEl('path', gArrows, {
          d: pathStr, fill: 'none', stroke: C.depline,
          'stroke-width': 1, 'marker-end': 'url(#tjArrow)'
        });
```

- [ ] **Step 6.3: Verify arrows still render correctly**

Regenerate and open `depArrows.htmljs`. Pan and zoom around. All dependency arrows should look exactly as before. No console errors.

- [ ] **Step 6.4: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Refactor: Extract routeArrow() helper from renderArrows()"
```

---

## Task 7: Stamp `_rowId` on task bar groups in `renderBars()`

Bar-hover event delegation needs to know which row a `<g class="tj-task">` belongs to. Stamp `g._rowId = row.id` immediately after each `makeG('tj-task', gBars)` call.

**Files:**
- Modify: `data/js/tjchart.js:965` (inside `renderBars`)

- [ ] **Step 7.1: Stamp `_rowId` on each task `<g>`**

Inside `renderBars()`, find:
```js
          var g = makeG('tj-task', gBars);
          if (sc.milestone) {
```

Replace with:
```js
          var g = makeG('tj-task', gBars);
          g._rowId = row.id;
          if (sc.milestone) {
```

- [ ] **Step 7.2: Verify no JS errors and chart unchanged**

Regenerate and open `depArrows.htmljs`. Chart looks normal. In DevTools console, run:
```js
document.querySelectorAll('.tj-task').forEach(function(g) { console.log(g._rowId); });
```
Expected: a list of task IDs (e.g. `"as3"`, `"at"`, etc.) printed for each bar group.

- [ ] **Step 7.3: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Stamp _rowId on task bar <g> elements for hover delegation"
```

---

## Task 8: Implement `updateRowHighlight()` and row-level events

This task makes row highlighting visible: hovering any part of a row (left panel or SVG body) brightens its stripe in both panels.

**Files:**
- Modify: `data/js/tjchart.js` — add function + events after the `rowTrs`/`rowBgs` population, and after the `rightBody` scroll sync listeners

- [ ] **Step 8.1: Add `updateRowHighlight()` function**

Add this function after `getAncestors()` (or after any nearby helper block, before the render helpers section):

```js
  /* Update the row hover highlight in both the left panel and SVG.
   * Reverts the previous highlighted <tr>, sets the new one, and redraws
   * gRowHighlight with a single full-width rect at the hovered row's Y. */
  function updateRowHighlight() {
    /* Revert any previously highlighted <tr> */
    if (updateRowHighlight._prev >= 0) {
      rowTrs[updateRowHighlight._prev].style.backgroundColor = rowBgs[updateRowHighlight._prev];
    }
    updateRowHighlight._prev = hoveredRowIdx;

    /* Apply new highlight to left-panel <tr> */
    if (hoveredRowIdx >= 0) {
      rowTrs[hoveredRowIdx].style.backgroundColor = rowHoverColor(rows[hoveredRowIdx]);
    }

    /* Redraw gRowHighlight */
    clearG(gRowHighlight);
    if (hoveredRowIdx >= 0) {
      var row = rows[hoveredRowIdx];
      svgEl('rect', gRowHighlight, {
        x: 0, y: yOffsets[hoveredRowIdx],
        width: getChartWidth(), height: rowVisualHeight(row),
        fill: rowHoverColor(row)
      });
    }
  }
  updateRowHighlight._prev = -1;
```

- [ ] **Step 8.2: Add `mouseenter`/`mouseleave` to each left-panel `<tr>`**

At the end of the `rows.forEach` table-build loop, just before (or just after) `scenarioTrs.forEach(function (t) { tbody.appendChild(t); });`, add:

```js
    /* Row hover: highlight on mouseenter, clear on mouseleave */
    (function (idx) {
      scenarioTrs[0].addEventListener('mouseenter', function () {
        hoveredRowIdx = idx;
        updateRowHighlight();
      });
      scenarioTrs[0].addEventListener('mouseleave', function () {
        hoveredRowIdx = -1;
        updateRowHighlight();
      });
    }(i));
```

- [ ] **Step 8.3: Add `mousemove`/`mouseleave` on `rightBody` for SVG row hover**

After the existing vertical scroll sync listeners (around line 582), add:

```js
  /* Row highlight from SVG body hover */
  rightBody.addEventListener('mousemove', function (e) {
    var rect = rightBody.getBoundingClientRect();
    var y    = e.clientY - rect.top + rightBody.scrollTop;
    /* Binary search yOffsets for the row containing y */
    var lo = 0, hi = rows.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (y < yOffsets[mid]) {
        hi = mid - 1;
      } else if (y >= yOffsets[mid + 1]) {
        lo = mid + 1;
      } else {
        idx = mid; break;
      }
    }
    if (idx !== hoveredRowIdx) {
      hoveredRowIdx = idx;
      updateRowHighlight();
    }
  });
  rightBody.addEventListener('mouseleave', function () {
    if (hoveredRowIdx !== -1) {
      hoveredRowIdx = -1;
      updateRowHighlight();
    }
  });
```

- [ ] **Step 8.4: Call `updateRowHighlight()` at the end of the full render**

In `render()`, after `fadeArrows.update(...)`:
```js
    fadeArrows.update(lod.showArrows, function () { renderArrows(xScale); });
```

Add:
```js
    updateRowHighlight();   /* refresh gRowHighlight width after any resize */
```

(The `_lastXScale` and `updateBarHighlight()` call will be added in Task 9.)

- [ ] **Step 8.5: Verify row highlighting works**

Regenerate and open `depArrows.htmljs`. Hover over rows in the left panel — the row background should brighten in both panels simultaneously. Moving to a different row should transfer the highlight. Moving out of the chart should clear it. Zoom/pan should not break the highlight (though the SVG stripe may be slightly stale in width until the next render — that's acceptable and will be fixed properly in Task 9).

- [ ] **Step 8.6: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Implement updateRowHighlight() and row-level hover events"
```

---

## Task 9: Implement `updateBarHighlight()` and bar-level events

This is the main task: bar hover highlights the hovered bar plus its full transitive predecessor chain (bars and arrows) using the overlay group.

**Files:**
- Modify: `data/js/tjchart.js` — add `updateBarHighlight()`, bar event listeners, SVG `mouseleave`; hook into `render()`

- [ ] **Step 9.1: Add `updateBarHighlight()` function**

Add this function immediately after `updateRowHighlight()`:

```js
  /* Update the bar/arrow highlight overlay (gBarHighlight).
   * When hoveredBarId is set, redraws highlighted bars and in-chain arrows
   * for the hovered task and its full transitive predecessor chain.
   * Always uses _lastXScale + the group's current transform (set by render pipeline). */
  function updateBarHighlight() {
    clearG(gBarHighlight);
    if (!hoveredBarId || !_lastXScale) { return; }

    var xScale   = _lastXScale;
    var w        = getChartWidth();
    var ancestors = getAncestors(hoveredBarId);
    var chainSet  = ancestors;   /* hoveredBarId included below via explicit check */

    /* ── Highlighted bars ── */
    rows.forEach(function (row, i) {
      if ((row.rowType || 'task') !== 'task') { return; }
      if (row.id !== hoveredBarId && !chainSet.has(row.id)) { return; }

      var y0        = yOffsets[i];
      var scenarios = project.scenarios || [sc0];
      scenarios.forEach(function (scId, s) {
        if (s >= (row.rowSpan || 1)) { return; }
        var sc      = (row.scenarios || {})[scId] || {};
        var yCenter = y0 + s * ROW_H + ROW_H / 2;
        if (!sc.start || !sc.end) { return; }
        var tStart = projectMidnight(sc.start);
        var tEnd   = projectMidnight(sc.end);

        var bx0 = xScale(tStart);
        var bx1 = xScale(tEnd);
        if (bx1 < -RENDER_MARGIN || bx0 > w + RENDER_MARGIN) { return; }
        if (!sc.milestone && (bx1 - bx0) < 1) { return; }

        var g = makeG('tj-task-hl', gBarHighlight);
        if (sc.milestone) {
          /* Highlighted milestone: grey diamond */
          var cx = xScale(tStart);
          var r  = MS_HALF;
          svgEl('polygon', g, {
            points: cx+','+(yCenter-r)+' '+(cx+r)+','+yCenter+' '+
                    cx+','+(yCenter+r)+' '+(cx-r)+','+yCenter,
            fill: '#555555'
          });
        } else if (row._isContainer) {
          /* Highlighted container: grey horizontal bar + jag triangles */
          var x   = xScale(tStart);
          var x2h = xScale(tEnd);
          var wh  = Math.max(2, x2h - x);
          var s2  = CONT_HALF;
          var top = yCenter - s2;
          var mid = yCenter;
          var tip = yCenter + s2;
          svgEl('rect', g, { x: x - s2, y: top, width: wh + 2 * s2, height: s2, fill: '#555555' });
          svgEl('polygon', g, {
            points: (x-s2)+','+mid+' '+(x+s2)+','+mid+' '+x+','+tip, fill: '#555555'
          });
          svgEl('polygon', g, {
            points: (x+wh-s2)+','+mid+' '+(x+wh+s2)+','+mid+' '+(x+wh)+','+tip, fill: '#555555'
          });
        } else {
          /* Highlighted task bar: dark frame + bright blue inner */
          var xb  = xScale(tStart);
          var x2b = xScale(tEnd);
          var wb  = Math.max(2, x2b - xb);
          var bh  = BAR_HALF;
          svgEl('rect', g, { x: xb, y: yCenter - bh, width: wb, height: bh * 2,
                              fill: C.taskbarFrame });
          svgEl('rect', g, { x: xb + 1, y: yCenter - bh + 1,
                              width: Math.max(0, wb - 2), height: bh * 2 - 2,
                              fill: '#6b96ff' });
        }
      });
    });

    /* ── Highlighted arrows ── */
    rows.forEach(function (row, i) {
      if ((row.rowType || 'task') !== 'task') { return; }
      if (!row.depends || !row.depends.length) { return; }

      var isSuccessor = (row.id === hoveredBarId || chainSet.has(row.id));
      if (!isSuccessor) { return; }

      row.depends.forEach(function (dep) {
        if ((dep.scenario || sc0) !== sc0) { return; }
        /* Only highlight arrow if predecessor is also in the chain */
        if (dep.id !== hoveredBarId && !chainSet.has(dep.id)) { return; }

        var predInfo = taskRowById[dep.id];
        if (!predInfo) { return; }
        var pred = predInfo.row;
        if (!pred._end || !row._start) { return; }

        /* Skip inherited dependencies (matches renderArrows() behaviour). */
        if (row.parent) {
          var parentInfo = taskRowById[row.parent];
          if (parentInfo && parentInfo.row.depends && parentInfo.row.depends.some(function (pd) {
            return pd.id === dep.id && (pd.scenario || sc0) === sc0;
          })) { return; }
        }

        var sx = xScale(pred._end);
        var sy = yOffsets[predInfo.idx] + ROW_H / 2;
        var ex = xScale(row._start);
        var ey = yOffsets[i] + ROW_H / 2;

        svgEl('path', gBarHighlight, {
          d: routeArrow(sx, sy, ex, ey),
          fill: 'none', stroke: '#e07800',
          'stroke-width': 2, 'marker-end': 'url(#tjArrowHL)'
        });
      });
    });
  }
```

- [ ] **Step 9.2: Add bar-level `mouseover`/`mouseout` event delegation on `gBars`**

After the `rightBody` scroll sync listeners and the row-hover listeners added in Task 8, add:

```js
  /* Bar highlight: event delegation on gBars */
  gBars.addEventListener('mouseover', function (e) {
    /* Walk up from e.target to find the nearest <g> with _rowId */
    var el = e.target;
    while (el && el !== gBars) {
      if (el._rowId !== undefined) {
        if (el._rowId !== hoveredBarId) {
          hoveredBarId = el._rowId;
          updateBarHighlight();
        }
        return;
      }
      el = el.parentNode;
    }
  });

  gBars.addEventListener('mouseout', function (e) {
    /* Only clear if leaving gBars entirely (not moving to a child element) */
    if (!gBars.contains(e.relatedTarget)) {
      hoveredBarId = null;
      updateBarHighlight();
    }
  });
```

- [ ] **Step 9.3: Add `mouseleave` on the body SVG to clear both states**

After the `gBars` listeners, add:

```js
  /* Clear both hover states when the mouse leaves the chart SVG entirely */
  svg.addEventListener('mouseleave', function () {
    var changed = false;
    if (hoveredRowIdx !== -1) { hoveredRowIdx = -1; changed = true; }
    if (hoveredBarId  !== null) { hoveredBarId = null; changed = true; }
    if (changed) {
      updateRowHighlight();
      updateBarHighlight();
    }
  });
```

- [ ] **Step 9.4: Capture `_lastXScale` and call `updateBarHighlight()` in `render()`**

In `render()`, replace the line added in Task 8:
```js
    updateRowHighlight();   /* refresh gRowHighlight width after any resize */
```

With:
```js
    _lastXScale = xScale;        /* capture for updateBarHighlight() */
    updateRowHighlight();         /* refresh gRowHighlight width after any resize */
    updateBarHighlight();         /* redraw chain highlight at new scale */
```

- [ ] **Step 9.5: Verify bar highlighting works**

Regenerate and open `depArrows.htmljs`. In the browser:

1. Hover over a task bar. Expected: the bar brightens (brighter blue); all ancestor bars also brighten; the connecting arrows turn orange and thicker. Non-ancestor bars and arrows are unchanged.
2. Hover over a task with no dependencies. Expected: only that bar brightens; no arrows highlighted.
3. Hover a bar, then zoom in/out. Expected: the highlight redraws correctly at the new scale.
4. Hover a bar, then pan. Expected: the highlight translates with the pan correctly.
5. Move the mouse off the bar (but stay on the SVG body). Expected: the bar highlight clears; row highlight remains if still on the same row.
6. Move the mouse off the chart. Expected: all highlights clear.

- [ ] **Step 9.6: Commit**

```bash
cd ~/repos/TaskJuggler
git add data/js/tjchart.js
git commit -m "Feat: Implement updateBarHighlight() and bar-level hover events"
```

---

## Task 10: Revert the test fixture change

The `htmljs` format added to `depArrows.tjp` in Task 1 was for development convenience. Revert it so the test suite isn't changed.

**Files:**
- Modify: `test/TestSuite/HTML-Reports/depArrows.tjp:68-69`

- [ ] **Step 10.1: Revert `depArrows.tjp` to `formats html` only**

Change:
```
taskreport "depArrows" {
  formats html, htmljs
```
Back to:
```
taskreport "depArrows" {
  formats html
```

- [ ] **Step 10.2: Commit**

```bash
cd ~/repos/TaskJuggler
git add test/TestSuite/HTML-Reports/depArrows.tjp
git commit -m "Test: Revert depArrows fixture to html-only formats"
```

---

## Task 11: Run the Ruby test suite

Confirm no Ruby-side regressions. The JS is embedded as a data file; Ruby tests verify the JSON output structure, not the JS behavior.

**Files:** none (read-only verification)

- [ ] **Step 11.1: Run the full test suite**

```bash
cd ~/repos/TaskJuggler
bundle exec rspec
```

Expected: all tests pass (same pass/fail count as before this feature).

- [ ] **Step 11.2: If any tests fail, investigate before proceeding**

Check whether failures are pre-existing (`git stash` and re-run to confirm) or introduced by this feature.
