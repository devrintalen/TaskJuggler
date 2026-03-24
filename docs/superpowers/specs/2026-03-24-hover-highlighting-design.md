# Hover Highlighting for JS Gantt Chart

**Date:** 2026-03-24
**Branch:** jsgantt
**File:** `data/js/tjchart.js`

## Overview

Add interactive hover highlighting to the `htmljs` Gantt chart. Hovering any part of a
row brightens that row's background in both the left (table) and right (SVG) panels.
Hovering a task bar additionally highlights the full transitive predecessor chain —
all ancestor bars and the dependency arrows connecting them — in a distinct color.
No dimming of unrelated rows.

---

## Hover State

Two module-level variables track active hover state:

```js
var hoveredRowIdx = -1;   // index into rows[] (-1 = none)
var hoveredBarId  = null; // row.id of the task bar under the cursor (null = none)
```

Bar hover (`hoveredBarId`) applies only to **task rows** (`rowType === 'task'` or
`rowType === undefined`). Resource and nested rows have no `depends` links and are
not indexed in `taskRowById`; their load-stack `<g>` elements are not stamped with
`_rowId` and will not trigger `updateBarHighlight()`.

---

## Ancestor Computation

A lazily-populated cache computes the full transitive predecessor set for any task via
BFS over `row.depends` links (primary scenario only). The cache is permanent for the
lifetime of the IIFE because `tjGanttData` is written once per page load and never
mutated:

```js
var _ancestorCache = {};  // rowId → Set of ancestor task ids

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

An arrow is in the chain if **both** its predecessor and successor are within
`{hoveredBarId} ∪ ancestors(hoveredBarId)`.

---

## SVG Layer Groups

Two new groups are inserted into the existing layer stack:

```
gStripes        (unchanged)
gRowHighlight   ← NEW: single <rect> for hovered row stripe; sits below gTimeOff
gTimeOff        (unchanged; off-duty zones render on top of the row highlight)
gBars           (unchanged)
gArrows         (unchanged)
gBarHighlight   ← NEW: highlighted bars + arrows for ancestor chain; sits above gArrows
gNow            (unchanged)
gGrid           (unchanged)
```

**`gRowHighlight`** sits between `gStripes` and `gTimeOff`. Off-duty zones remain
visible on top of the highlight stripe, which is correct — weekend/holiday information
should not be suppressed by the hover effect. The brighter stripe color is still clearly
visible in the non-off-duty portions of the row.

`gRowHighlight` is **not** date-positioned and is **excluded** from the pan fast path
translate. Like `gStripes`, it draws rects with absolute pixel coordinates (`x=0`,
`width=getChartWidth()`), so no pan translate is needed or applied. Its highlight rect
width must always equal `getChartWidth()`. Width is obtained by calling
`getChartWidth()` inside `updateRowHighlight()` each time it redraws; no separate
invalidation flag is needed since the function is already called on every hover change.

**`gBarHighlight`** is date-positioned and is **included** in the pan fast path
translate alongside `gBars`, `gArrows`, etc.:

```js
gBarHighlight.setAttribute('transform', xlate);
```

`gBarHighlight` sits above `gArrows`. This means highlighted bars will layer on top of
normal (non-highlighted) arrows, which is visually acceptable — the highlighted content
is intentionally given visual prominence.

---

## `_lastXScale` and the Pan Fast Path

A module-level variable captures the D3 scale used in the most recent full render:

```js
var _lastXScale = null;  // set at the start of each full render
```

`updateBarHighlight()` **always draws bars using `_lastXScale`** coordinates, never
`currentXScale`. This is correct because `gBarHighlight` carries whatever `transform`
the render pipeline last applied:

- After a full render: `gBarHighlight` has no transform; bars drawn at `_lastXScale(d)`
  appear at `_lastXScale(d)`. Correct.
- After a pan fast path: `gBarHighlight` has `transform="translate(dx,0)"`. Bars drawn
  at `_lastXScale(d)` appear at `_lastXScale(d) + dx = currentXScale(d)`. Correct.

`clearG()` removes child nodes but leaves the `transform` attribute intact, so
`updateBarHighlight()` can safely clear and redraw without touching the transform.

---

## Event Handling

### Left-panel table row tracking

During the table-build loop, two parallel arrays are populated:

```js
var rowTrs  = [];   // rowTrs[i]  = the primary <tr> (scenarioTrs[0]) for row i
var rowBgs  = [];   // rowBgs[i]  = the original rowBgColor(row, i) string for row i
```

`rowTrs[i]` holds `scenarioTrs[0]` (the first `<tr>` for multi-scenario rows). The
assignment happens immediately after `scenarioTrs` is built, before the `cols.forEach`
loop fills the cells.

`rowBgs[i]` stores the result of `rowBgColor(row, i)` so `updateRowHighlight()` can
revert the previous highlight without recomputing.

### Row-level hover (brightens stripe + left panel `<tr>`)

- **Left panel:** `mouseenter`/`mouseleave` on each `<tr>` → set `hoveredRowIdx` →
  call `updateRowHighlight()`.
- **SVG body:** `mousemove` on `rightBody`:

  ```js
  var y = e.clientY - rightBody.getBoundingClientRect().top + rightBody.scrollTop;
  ```

  Binary-search `yOffsets[]` for this `y` to find the row index. Call
  `updateRowHighlight()`. `mouseleave` on `rightBody` clears `hoveredRowIdx` and calls
  `updateRowHighlight()`.

  Using `clientY` minus the element's bounding rect (rather than `e.offsetY`) is
  required because `mousemove` events may fire on SVG child elements inside `rightBody`,
  making `e.offsetY` unreliable.

- Both panels stay in sync via the shared `hoveredRowIdx` variable.

### Bar-level hover (highlights chain + arrows)

- `mouseover`/`mouseout` on `gBars` via event delegation — walk `e.target` up to find
  a `<g>` carrying a `_rowId` property. `_rowId` is stamped only on task-row groups
  (`<g class="tj-task">`), not on load-stack groups. The stamping is done inside
  `renderBars()`, immediately after each `g = makeG('tj-task', gBars)` call:
  `g._rowId = row.id`.
- Set `hoveredBarId` → call `updateBarHighlight()`.
- `mouseleave` from the body SVG clears both `hoveredRowIdx` and `hoveredBarId` and
  calls both update functions.
- When the mouse moves from one bar directly to another (without leaving `gBars`),
  `mouseout` fires on the first bar before `mouseover` fires on the second. The
  transient clear-then-set is benign: `updateBarHighlight()` is called twice in quick
  succession, producing a momentary blank followed immediately by the new highlight.
  This is imperceptible in practice.

### Update functions

**`updateRowHighlight()`**
1. If a previous `<tr>` was highlighted, revert its `backgroundColor` to `rowBgs[prevIdx]`.
2. If `hoveredRowIdx >= 0`, set `rowTrs[hoveredRowIdx].style.backgroundColor` to the
   highlight color for that row's type.
3. Clear `gRowHighlight`.
4. If `hoveredRowIdx >= 0`, draw one `<rect>` at `x=0`, `y=yOffsets[hoveredRowIdx]`,
   `width=getChartWidth()`, `height=rowVisualHeight(rows[hoveredRowIdx])`, fill =
   highlight color.

**`updateBarHighlight()`**
1. Clear `gBarHighlight`.
2. If `hoveredBarId` is null, return.
3. Compute `ancestors = getAncestors(hoveredBarId)`.
4. Build `chainSet = {hoveredBarId} ∪ ancestors`.
5. For each row in `rows[]` whose `id` is in `chainSet`:
   - Iterate scenarios exactly as `renderBars()` does (same `scenarios.forEach` loop,
     same `rowSpan` guard, same viewport cull).
   - Draw each scenario bar into `gBarHighlight` using highlight colors.
   - Do **not** call `attachTooltip()` on `gBarHighlight` elements — the tooltip is
     already attached to the underlying `gBars` elements.
6. Draw highlighted arrows: iterate `rows[]` as in `renderArrows()`; for each dependency
   where **both** `dep.id` (predecessor) and the row's `id` (successor) are in
   `chainSet`, draw the arrow into `gBarHighlight` with highlight style.
   Use `_lastXScale` for all pixel computations.

### Arrow routing refactor

The arrow path computation in `renderArrows()` is non-trivial (three-segment vs. stepped
detour). Before implementing `updateBarHighlight()`, extract this logic into a shared
helper:

```js
function routeArrow(sx, sy, ex, ey) {
  // Returns a path string 'M…H…V…H…' or 'M…L…L…L…' depending on available room.
  // (Body of existing computation in renderArrows, unchanged.)
}
```

`renderArrows()` is updated to call `routeArrow(sx, sy, ex, ey)`.
`updateBarHighlight()` calls the same helper for highlighted arrows.

### Reapply highlights after full render

The full-render code path in `render()` already calls `gBarHighlight.removeAttribute('transform')`
alongside the five existing groups (`gBars`, `gGrid`, `gNow`, `gTimeOff`, `gArrows`).
This is required for the `_lastXScale` correctness argument to hold — without it,
`gBarHighlight` would carry a stale pan-offset after a full render.

At the end of `render()`, after `renderBars()` and the `fadeArrows.update(...)` call:

```js
_lastXScale = xScale;          // capture before update functions use it
updateRowHighlight();           // refreshes gRowHighlight width after resize
updateBarHighlight();           // redraws highlight bars at new scale
```

---

## Visual Style

### Row highlight

| Row type | Highlight color |
|----------|----------------|
| Task / nested-task | `#b8d0ff` |
| Resource / nested-resource | `#ffd4b0` |

Applied to both the left panel `<tr>` `backgroundColor` and the `gRowHighlight` SVG
rect. Overrides even/odd stripe color.

### Bar highlight (in `gBarHighlight`, drawn above `gBars`)

| Element | Highlight color |
|---------|----------------|
| Task bar inner fill | `#6b96ff` (brighter than base `#2f57ea`) |
| Task bar frame | `#09090a` (unchanged) |
| Container bar fill | `#555555` (lighter than base `#09090a`; dark grey signals "highlighted container" without matching task-bar blue) |
| Milestone fill | `#555555` (same rationale as container) |
| Progress overlay | Omitted — the base bar in `gBars` remains visible underneath |

### Arrow highlight (in `gBarHighlight`)

- Stroke: `#e07800` (orange), `stroke-width` 2 (vs. base black width 1)
- A second SVG marker `#tjArrowHL` (orange fill, same geometry as `#tjArrow`) is added
  to `<defs>`. Highlighted arrows use `marker-end="url(#tjArrowHL)"`.
