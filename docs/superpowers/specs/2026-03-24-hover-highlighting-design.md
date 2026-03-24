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
var hoveredBarId  = null; // row.id of the bar under the cursor (null = none)
```

---

## Ancestor Computation

A lazily-populated cache computes the full transitive predecessor set for any task via
BFS over `row.depends` links (primary scenario only):

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
gRowHighlight   ← NEW: single <rect> for hovered row stripe
gTimeOff        (unchanged)
gBars           (unchanged)
gArrows         (unchanged)
gBarHighlight   ← NEW: highlighted bars + arrows for ancestor chain
gNow            (unchanged)
gGrid           (unchanged)
```

`gRowHighlight` is not date-positioned and is **excluded** from the pan fast path
translate. Its width is updated on resize alongside `gStripes`.

`gBarHighlight` is date-positioned and is **included** in the pan fast path translate
alongside `gBars`, `gArrows`, etc.

---

## Event Handling

### Row-level hover (brightens stripe + left panel `<tr>`)

- **Left panel:** `mouseenter`/`mouseleave` on each `<tr>` → set `hoveredRowIdx` → call `updateRowHighlight()`.
- **SVG body:** `mousemove` on `rightBody` → compute row index from
  `(e.offsetY + rightBody.scrollTop)` vs `yOffsets[]` (binary search) → call
  `updateRowHighlight()`. `mouseleave` on `rightBody` clears `hoveredRowIdx`.
- Both panels stay in sync via the shared `hoveredRowIdx` variable.
- `rowTrs[i]` array (populated during table build) maps each row index to its primary
  `<tr>` for instant left-panel access.

### Bar-level hover (highlights chain + arrows)

- `mouseover`/`mouseout` on `gBars` via event delegation — walk `e.target` up to find
  a `<g>` carrying a `_rowId` property stamped during `renderBars`.
- Set `hoveredBarId` → call `updateBarHighlight()`.
- `mouseleave` from the SVG clears both `hoveredRowIdx` and `hoveredBarId`.

### Update functions

**`updateRowHighlight()`**
1. Revert previous `<tr>` style (if any).
2. Set new `<tr>` background to highlight color.
3. Clear `gRowHighlight`; if `hoveredRowIdx >= 0`, draw one full-width `<rect>` at
   `yOffsets[hoveredRowIdx]` with height `rowVisualHeight(row)`.

**`updateBarHighlight()`**
1. Clear `gBarHighlight`.
2. If `hoveredBarId` is null, return.
3. Compute `ancestors = getAncestors(hoveredBarId)`.
4. For each row in `rows[]` whose id is `hoveredBarId` or in `ancestors`: redraw its
   bar(s) into `gBarHighlight` using highlight colors.
5. For each arrow where both predecessor and successor are in
   `{hoveredBarId} ∪ ancestors`: redraw the arrow in `gBarHighlight` using the
   highlight arrow style.

---

## Visual Style

### Row highlight

| Row type | Highlight color |
|----------|----------------|
| Task / nested-task | `#b8d0ff` |
| Resource / nested-resource | `#ffd4b0` |

Applied to both the left panel `<tr>` background and the `gRowHighlight` SVG rect.
Overrides even/odd stripe color.

### Bar highlight (in `gBarHighlight`, drawn above `gBars`)

| Element | Highlight color |
|---------|----------------|
| Task bar inner fill | `#6b96ff` (brighter than base `#2f57ea`) |
| Task bar frame | `#09090a` (unchanged) |
| Container bar fill | `#555555` |
| Milestone fill | `#555555` |
| Progress overlay | Omitted (base bar shows through underneath) |

### Arrow highlight (in `gBarHighlight`)

- Stroke: `#e07800` (orange), stroke-width `2`
- A second SVG marker `#tjArrowHL` (orange fill) is added to `<defs>` for highlighted
  arrowheads.

---

## Implementation Notes

- `_ancestorCache` is invalidated (reset to `{}`) if the data ever changes; currently
  `tjGanttData` is static per page load so no invalidation is needed.
- The `renderBars` function stamps each `<g class="tj-task">` with `g._rowId = row.id`
  so that bar-hover delegation can identify the row without a DOM search.
- `gBarHighlight` uses the same xScale passed to the last full render (captured in a
  closure variable `_lastXScale`) so `updateBarHighlight()` can redraw bars at the
  correct pixel positions without triggering a full render.
- On every full render, `updateBarHighlight()` and `updateRowHighlight()` are called
  (after `renderBars`) to repaint highlights with the new scale, since `gBarHighlight`
  is cleared by its own update function and `gRowHighlight` needs a width refresh.
