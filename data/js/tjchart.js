/* tjchart.js — D3 v7 interactive chart for TaskJuggler htmljs reports
 * Reads window.tjGanttData and renders an interactive Gantt chart into
 * #tj-gantt-container.
 *
 * Visual vocabulary matches the static taskreport output (GanttChart.rb etc.)
 * Saleae Logic-style scroll-wheel zoom: the date under the cursor stays fixed.
 *
 * Supports row types: task, nested-resource, nested-task, resource.
 * Multi-scenario task rows use rowSpan > 1 (one bar per scenario stacked).
 * Load-stack rows (resource/nested-resource/nested-task) render proportional
 * busy/free/assigned bars.
 */
(function () {
  'use strict';

  /* ── Constants matching Ruby GanttTaskBar/Container/Milestone sizes ── */
  var BAR_HALF      = 6;   // GanttTaskBar @@size
  var CONT_HALF     = 5;   // GanttContainer @@size
  var MS_HALF       = 6;   // GanttMilestone @@size
  var MIN_START_GAP = 5;
  var MIN_END_GAP   = 10;

  /* ── Colors from tjreport.css ── */
  var C = {
    taskbarFrame   : '#09090a',
    taskbar        : '#2f57ea',
    progressbar    : '#36363f',
    container      : '#09090a',
    milestone      : '#09090a',
    depline        : '#000000',
    nowline        : '#EE0000',
    offduty        : '#bdbdaa',
    rowEven        : '#ebf2ff',   /* .taskcell1 */
    rowOdd         : '#d9dfeb',   /* .taskcell2 */
    resourceRowEven: '#fff2eb',   /* .resourcecell1 */
    resourceRowOdd : '#ebdfd9',   /* .resourcecell2 */
    headerBg       : '#7a7a7a',
    headerFg       : '#ffffff',
    headerBorder   : '#9a9a9a',
    gridLine       : 'rgba(0,0,0,0.15)',
    /* Load stack colours — match .loadstackframe / .assigned / .busy / .free */
    loadstackframe : '#452a2a',
    loadAssigned   : '#ff3b3b',   /* .assigned */
    loadBusy       : '#ff9b9b',   /* .busy */
    loadFree       : '#a5ffb5'    /* .free */
  };

  /* Category name → fill colour */
  var loadCatColor = {
    assigned: C.loadAssigned,
    busy    : C.loadBusy,
    free    : C.loadFree
  };

  /* ── Layout ── */
  var ROW_H     = 20;   // pixels per task or resource row (matches Ruby ReportTableLine)
  var HDR_H     = 40;   // two-row header height (20px each)
  var INDENT_PX = 8;    // pixels per indentation level in the left-panel name column
  var wdayFmt   = null; // initialised after projectTz is known (below)

  /* ── LOD thresholds (pixels per day) ── */
  var LOD_PPD_YEAR    = 0.2;   // below → year scale
  var LOD_PPD_QUARTER = 2;     // below → quarter scale
  var LOD_PPD_MONTH   = 20;    // below → month scale
  var LOD_PPD_WEEK    = 120;   // below → week scale  (≥ → day scale)

  var LOD_FADE_MS         = 200;                              // duration of show/hide opacity transitions
  var LOD_FADE_TRANSITION = 'opacity ' + LOD_FADE_MS + 'ms'; // pre-built CSS transition string
  var TIMEOFF_MIN_PX      = 6;   // hide off-duty zones narrower than this; show again when they grow back
  /* Extra viewport margin rendered during full builds so the pan fast path can
   * shift the pre-rendered content without missing elements at the edges. */
  var RENDER_MARGIN = 400;

  /* Format a YYYY-MM-DD date string for display, prefixed with the abbreviated
   * weekday name in the project timezone (e.g. "Wed 2002-01-16").
   * Returns an empty string if s is falsy. */
  function fmtDate(s) {
    if (!s) { return ''; }
    return wdayFmt.format(projectMidnight(s)) + ' ' + s;
  }


  /* ───────────────────────── Bootstrap ───────────────────────────────── */
  var data = window.tjGanttData;
  if (!data || !data.rows || !data.rows.length) { return; }

  var container = document.getElementById('tj-gantt-container');
  if (!container) { return; }
  container.innerHTML = '';

  /* ── Floating tooltip ── (shared across all Gantt charts on the page) */
  var tooltipDiv  = document.getElementById('tj-gantt-tooltip');
  var _ttipTitle  = null;   /* <span> holding the header text */
  var _ttipBody   = null;   /* <div> holding the body HTML    */
  var _ttipSticky = false;  /* true once the user clicks      */
  if (!tooltipDiv) {
    tooltipDiv = document.createElement('div');
    tooltipDiv.id = 'tj-gantt-tooltip';
    tooltipDiv.style.cssText =
      'position:fixed;z-index:10000;display:none;' +
      'background:#C3C8DA;border:1px solid #999999;' +
      'max-width:600px;font-size:8pt;font-family:Verdana,Geneva,sans-serif;' +
      'box-shadow:4px 4px 8px rgba(0,0,0,0.35);color:#000044;line-height:1.4;';

    /* Title bar */
    var ttipHeader = document.createElement('div');
    ttipHeader.style.cssText =
      'background:#7A7A7A;color:#ffffff;padding:2px 6px;' +
      'display:flex;justify-content:space-between;align-items:center;' +
      'font-weight:bold;cursor:default;user-select:none;';

    _ttipTitle = document.createElement('span');
    ttipHeader.appendChild(_ttipTitle);

    var ttipClose = document.createElement('span');
    ttipClose.innerHTML = '&nbsp;X&nbsp;';
    ttipClose.style.cssText =
      'cursor:pointer;background:#505050;color:#ffffff;' +
      'padding:0 3px;margin-left:8px;flex-shrink:0;';
    ttipClose.addEventListener('mouseover', function () {
      this.style.background = '#A0A0A0'; this.style.color = '#000000';
    });
    ttipClose.addEventListener('mouseout',  function () {
      this.style.background = '#505050'; this.style.color = '#ffffff';
    });
    ttipClose.addEventListener('click', function (e) {
      e.stopPropagation();
      _ttipSticky = false;
      tooltipDiv.style.display = 'none';
    });
    ttipHeader.appendChild(ttipClose);
    tooltipDiv.appendChild(ttipHeader);

    /* Body */
    _ttipBody = document.createElement('div');
    _ttipBody.style.cssText = 'padding:10px;';
    tooltipDiv.appendChild(_ttipBody);

    /* Click outside closes a sticky tooltip */
    document.addEventListener('click', function (e) {
      if (_ttipSticky && !tooltipDiv.contains(e.target)) {
        _ttipSticky = false;
        tooltipDiv.style.display = 'none';
      }
    });

    document.body.appendChild(tooltipDiv);
  } else {
    /* Re-entering tjGanttRender for a second chart on the same page */
    _ttipTitle = tooltipDiv.querySelector('div > span');
    _ttipBody  = tooltipDiv.querySelector('div + div');
  }
  /* Cached tooltip dimensions — read once per show, not on every mousemove. */
  var _ttipW = 0, _ttipH = 0;

  /* Populate and display the shared tooltip with the given body HTML and title.
   * html  — innerHTML for the body panel (Ruby-generated tooltip markup).
   * title — plain text shown in the grey header bar (usually the task/resource name).
   * e     — the triggering MouseEvent, used to set the initial position. */
  function showTooltip(html, title, e) {
    if (!html) { return; }
    _ttipTitle.textContent = title || '';
    _ttipBody.innerHTML    = html;
    tooltipDiv.style.display = 'block';
    _ttipW = tooltipDiv.offsetWidth;
    _ttipH = tooltipDiv.offsetHeight;
    positionTooltip(e);
  }

  /* Position the tooltip 16px below-right of the cursor, clamping to keep it
   * within the viewport with an 8px margin on each edge.
   * e — the current MouseEvent. */
  function positionTooltip(e) {
    var x = e.clientX + 16;
    var y = e.clientY + 16;
    /* Keep within viewport */
    if (x + _ttipW > window.innerWidth  - 8) { x = e.clientX - _ttipW - 8; }
    if (y + _ttipH > window.innerHeight - 8) { y = e.clientY - _ttipH - 8; }
    tooltipDiv.style.left = x + 'px';
    tooltipDiv.style.top  = y + 'px';
  }

  /* Hide the tooltip unconditionally. Called by the X button and the
   * document-level click-outside handler after clearing _ttipSticky. */
  function hideTooltip() {
    tooltipDiv.style.display = 'none';
  }

  /* Attach a click-activated sticky tooltip to an SVG element.
   * el    — the SVG <g> to listen on.
   * html  — body HTML for showTooltip (passed through unchanged).
   * title — header text for showTooltip (usually row.name).
   * The first click opens the tooltip and makes it sticky; subsequent clicks
   * on the same element are ignored until the user closes it via X or an
   * outside click. */
  function attachTooltip(el, html, title) {
    if (!html) { return; }
    el.style.cursor = 'help';
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_ttipSticky) { return; }
      _ttipSticky = true;
      showTooltip(html, title, e);
    });
  }

  var rows     = data.rows;
  var project  = data.project;
  var scenarios = project.scenarios || ['plan'];
  var sc0       = scenarios[0];
  var iconBase = project.iconBase || null;   // e.g. "icons/" or null

  /* ── Project timezone ── */
  var projectTz  = project.tz       || 'UTC';
  var tzOffsetMs = (project.tzOffset || 0) * 1000;

  /* Convert a 'YYYY-MM-DD' date string to the UTC timestamp that represents
   * midnight in the project timezone.  new Date('YYYY-MM-DD') gives UTC
   * midnight; subtracting the project's UTC offset shifts it to project-local
   * midnight so that d3.scaleUtc() places it correctly. */
  function projectMidnight(dateStr) {
    return new Date(new Date(dateStr).getTime() - tzOffsetMs);
  }

  wdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: projectTz, weekday: 'short' });

  /* Columns to show — array of {id, title, align} objects from the backend */
  var cols = (project.columns || []);
  if (!cols.length) {
    cols = [
      { id: 'bsi',   title: 'BSI',   align: 'left' },
      { id: 'name',  title: 'Name',  align: 'left' },
      { id: 'start', title: 'Start', align: 'left' },
      { id: 'end',   title: 'End',   align: 'left' }
    ];
  }

  /* ── Per-row display info (task rows only) ── */
  rows.forEach(function (r) {
    if (r.rowType !== 'task' && r.rowType !== undefined) { return; }
    var sc = (r.scenarios || {})[sc0] || {};
    r._start       = sc.start ? projectMidnight(sc.start) : null;
    r._end         = sc.end   ? projectMidnight(sc.end)   : null;
    r._complete    = (sc.complete != null) ? sc.complete : 0;
    r._milestone   = !!sc.milestone;
    r._isContainer = !!r.isContainer;
  });


  /* Index of task rows by id — used by renderLoadStack and renderArrows. */
  var taskRowById = {};
  rows.forEach(function (r, i) {
    if ((r.rowType || 'task') === 'task') { taskRowById[r.id] = { row: r, idx: i }; }
  });

  var projectStart = project.start ? projectMidnight(project.start) : (rows[0] && rows[0]._start) || new Date();
  var projectEnd   = project.end   ? projectMidnight(project.end)   : new Date(projectStart.getTime() + 86400000 * 30);
  var nowDate      = project.now   ? projectMidnight(project.now)   : new Date();

  /* ── Row height helpers ── */
  /* Background colour for a row, distinguishing task rows (blue) from resource
   * rows (warm peach) to match .taskcell1/2 and .resourcecell1/2 in CSS.
   * nested-task rows are tasks visually, so they use task colours. */
  function rowBgColor(row, i) {
    var rt = row.rowType;
    if (rt === 'nested-task' || rt === 'task' || rt === undefined) {
      return (i % 2 === 0) ? C.rowEven : C.rowOdd;
    }
    return (i % 2 === 0) ? C.resourceRowEven : C.resourceRowOdd;
  }

  /* Return the highlight background colour for a hovered row. */
  function rowHoverColor(row) {
    var rt = row.rowType;
    if (rt === 'nested-task' || rt === 'task' || rt === undefined) {
      return 'rgba(184,208,255,0.6)';
    }
    return 'rgba(255,212,176,0.6)';
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
        width: getChartWidth(), height: rowVisualHeight(row) - 1,
        fill: rowHoverColor(row)
      });
    }
  }
  updateRowHighlight._prev = -1;

  /* Update the bar/arrow highlight overlay (gBarHighlight).
   * When hoveredBarId is set, redraws highlighted bars and in-chain arrows
   * for the hovered task and its full transitive predecessor chain.
   * Always uses _lastXScale + the group's current transform (set by render pipeline). */
  function updateBarHighlight() {
    clearG(gBarHighlight);
    if (!hoveredBarId || !_lastXScale) { return; }

    var xScale    = _lastXScale;
    var w         = getChartWidth();
    var ancestors = getAncestors(hoveredBarId);
    var chainSet  = ancestors;   /* hoveredBarId handled by explicit check below */

    /* ── Highlighted bars ── */
    rows.forEach(function (row, i) {
      if (row._hidden) { return; }
      if ((row.rowType || 'task') !== 'task') { return; }
      if (row.id !== hoveredBarId && !chainSet.has(row.id)) { return; }

      var y0        = yOffsets[i];
      var scList    = project.scenarios || [sc0];
      scList.forEach(function (scId, s) {
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
          /* Highlighted container: grey bar + jag triangles */
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
          /* Highlighted task bar: dark frame + bright blue inner + orange border */
          var xb  = xScale(tStart);
          var x2b = xScale(tEnd);
          var wb  = Math.max(2, x2b - xb);
          var bh  = BAR_HALF;
          svgEl('rect', g, { x: xb, y: yCenter - bh, width: wb, height: bh * 2,
                              fill: C.taskbarFrame });
          svgEl('rect', g, { x: xb + 1, y: yCenter - bh + 1,
                              width: Math.max(0, wb - 2), height: bh * 2 - 2,
                              fill: '#6b96ff' });
          var pct = Math.max(0, Math.min(100, sc.complete || 0));
          if (pct > 0) {
            svgEl('rect', g, { x: xb + 1, y: yCenter - bh / 2,
                                width: Math.max(0, (wb - 2) * pct / 100),
                                height: bh, fill: C.progressbar });
          }
          svgEl('rect', g, { x: xb, y: yCenter - bh, width: wb, height: bh * 2,
                              fill: 'none', stroke: '#e07800', 'stroke-width': 2 });
        }
      });
    });

    /* ── Highlighted arrows ── */
    rows.forEach(function (row, i) {
      if (row._hidden) { return; }
      if ((row.rowType || 'task') !== 'task') { return; }
      if (!row.depends || !row.depends.length) { return; }

      var isSuccessor = (row.id === hoveredBarId || chainSet.has(row.id));
      if (!isSuccessor) { return; }

      row.depends.forEach(function (dep) {
        if ((dep.scenario || sc0) !== sc0) { return; }
        /* Only highlight arrow if predecessor is also in the chain */
        if (dep.id !== hoveredBarId && !chainSet.has(dep.id)) { return; }

        var predInfo = taskRowById[dep.id];
        if (!predInfo || predInfo.row._hidden) { return; }
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

  /* Return the total pixel height of a row. Multi-scenario task rows use
   * rowSpan > 1, stacking one ROW_H band per scenario vertically. */
  function rowVisualHeight(row) {
    return ROW_H * ((row.rowSpan || 1));
  }

  /* Compute array of cumulative Y offsets (one per row, plus total at end).
   * Hidden rows (r._hidden === true) contribute zero height so they are
   * effectively removed from the chart without touching the rows array. */
  function buildYOffsets() {
    var offsets = [];
    var y = 0;
    rows.forEach(function (r) {
      offsets.push(y);
      if (!r._hidden) { y += rowVisualHeight(r); }
    });
    offsets.push(y);  // sentinel: total chart height
    return offsets;
  }

  var yOffsets = buildYOffsets();
  var chartH   = yOffsets[yOffsets.length - 1];
  var _stripesW = -1;   // cached width for stripe invalidation
  var _panBaseT = null; // zoom transform {x,k} saved at last full render (pan fast-path)

  /* ── Collapse / expand ── */
  var collapsedIds = new Set();   // ids of currently-collapsed container rows

  /* Recompute row._hidden for every row based on collapsedIds.
   * Assumes rows are in tree order (parents appear before their children). */
  function computeHidden() {
    rows.forEach(function (row) {
      var rt = row.rowType || 'task';
      if (rt === 'task') {
        if (!row.parent) { row._hidden = false; return; }
        var pInfo = taskRowById[row.parent];
        if (!pInfo) { row._hidden = false; return; }
        row._hidden = collapsedIds.has(row.parent) || !!pInfo.row._hidden;
      } else {
        /* nested-resource, nested-task: scopeId is the owning task */
        var scopeId = row.scopeId;
        if (!scopeId) { row._hidden = false; return; }
        var sInfo = taskRowById[scopeId];
        if (!sInfo) { row._hidden = false; return; }
        row._hidden = collapsedIds.has(scopeId) || !!sInfo.row._hidden;
      }
    });
  }

  /* Return the nearest taskRowById entry for rowId that is not hidden,
   * walking up the task parent chain.  Returns null if no visible ancestor exists. */
  function visibleAncestorInfo(rowId) {
    var info = taskRowById[rowId];
    if (!info) { return null; }
    if (!info.row._hidden) { return info; }
    var parentId = info.row.parent;
    while (parentId) {
      var pInfo = taskRowById[parentId];
      if (!pInfo) { return null; }
      if (!pInfo.row._hidden) { return pInfo; }
      parentId = pInfo.row.parent;
    }
    return null;
  }

  /* Apply the current collapsedIds: recompute hidden state, rebuild yOffsets,
   * update SVG height, show/hide left-panel <tr>s, refresh toggle icons,
   * then schedule a full re-render. */
  function applyCollapse() {
    computeHidden();
    yOffsets  = buildYOffsets();
    chartH    = yOffsets[yOffsets.length - 1];
    svg.setAttribute('height', chartH);
    _stripesW = -1;    // force stripe redraw at new width
    _panBaseT = null;  // force full render (not pan fast-path)

    /* Re-number visible rows so stripe colours alternate correctly after collapse.
     * rowBgs[i] is updated here; renderStripes and updateRowHighlight read it. */
    var visIdx = 0;
    rows.forEach(function (row, i) {
      if (!row._trs) { return; }
      var display = row._hidden ? 'none' : '';
      row._trs.forEach(function (tr) { tr.style.display = display; });
      if (row._toggleBtn) {
        row._toggleBtn.textContent = collapsedIds.has(row.id) ? '\u25b6' : '\u25bc';
      }
      if (!row._hidden) {
        var newBg = rowBgColor(row, visIdx);
        if (newBg !== rowBgs[i]) {
          rowBgs[i] = newBg;
          row._trs.forEach(function (tr) { tr.style.background = newBg; });
        }
        visIdx++;
      }
    });

    scheduleRender();
  }

  /* Toggle the collapsed/expanded state of the container with the given id. */
  function toggleCollapse(id) {
    if (collapsedIds.has(id)) { collapsedIds.delete(id); } else { collapsedIds.add(id); }
    applyCollapse();
  }
  /* ── Hover highlight state ── */
  var hoveredRowIdx = -1;   // index into rows[] (-1 = none)
  var hoveredBarId  = null; // row.id of the task bar under the cursor (null = none)
  var _lastXScale   = null; // xScale captured at last full render; used by updateBarHighlight
  /* ───────────────────────── DOM Structure ───────────────────────────── */
  var wrapper = document.createElement('div');
  wrapper.style.cssText =
    'display:flex;width:100%;height:600px;overflow:hidden;' +
    'font-family:sans-serif;font-size:11px;border:2px solid #9a9a9a;';
  container.appendChild(wrapper);

  /* ── Left panel ── */
  var leftPanel = document.createElement('div');
  /* overflow-y:scroll reserves a fixed-width scrollbar gutter; combined with
   * width:max-content the div grows to fit the table exactly, then the
   * scrollbar sits in the reserved gutter rather than overlapping columns.
   * position:relative is the containing block for the collapse-bracket overlay. */
  leftPanel.style.cssText =
    'position:relative;overflow-y:scroll;overflow-x:hidden;' +
    'border-right:2px solid #7a7a7a;flex-shrink:0;width:max-content;';
  wrapper.appendChild(leftPanel);

  /* Bracket overlay: absolutely-positioned inside leftPanel (scrolls with content).
   * Shown on hover of a container's toggle button to indicate which rows collapse. */
  var bracketDiv = document.createElement('div');
  bracketDiv.style.cssText =
    'position:absolute;display:none;pointer-events:none;z-index:5;box-sizing:border-box;' +
    'left:0;width:4px;' +
    'border-left:3px solid rgba(80,120,220,0.55);' +
    'border-top:2px solid rgba(80,120,220,0.55);' +
    'border-bottom:2px solid rgba(80,120,220,0.55);';
  leftPanel.appendChild(bracketDiv);

  var table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;white-space:nowrap;';
  leftPanel.appendChild(table);

  /* Header row */
  var thead = document.createElement('thead');
  table.appendChild(thead);
  var hrow = document.createElement('tr');
  thead.appendChild(hrow);
  cols.forEach(function (col) {
    var th  = document.createElement('th');
    th.textContent = col.title;
    th.style.cssText =
      'position:sticky;top:0;z-index:10;' +
      'padding:2px 4px;text-align:' + col.align + ';' +
	  'height:' + HDR_H + 'px;border-right:1px solid #9a9a9a;box-sizing:border-box;' +
      'box-shadow:inset 0 -1px 0 0 #9a9a9a;' +
      'background:' + C.headerBg + ';color:' + C.headerFg + ';';
    hrow.appendChild(th);
  });

  /* Data rows */
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);

  var rowTrs = [];   /* rowTrs[i] = primary <tr> (scenarioTrs[0]) for row i */
  var rowBgs = [];   /* rowBgs[i] = original rowBgColor string for row i     */

  /* ── Bracket hover helpers ── */
  /* Returns true if row is a transitive descendant of the task with ancestorId. */
  function isDescendantOf(row, ancestorId) {
    var rt = row.rowType || 'task';
    if (rt === 'task') {
      var parentId = row.parent;
      while (parentId) {
        if (parentId === ancestorId) { return true; }
        var pInfo = taskRowById[parentId];
        if (!pInfo) { return false; }
        parentId = pInfo.row.parent;
      }
      return false;
    } else {
      var scopeId = row.scopeId;
      if (!scopeId) { return false; }
      if (scopeId === ancestorId) { return true; }
      var sInfo = taskRowById[scopeId];
      if (!sInfo) { return false; }
      return isDescendantOf(sInfo.row, ancestorId);
    }
  }

  /* Show the bracket overlay covering the currently-visible descendants of
   * the container at containerIdx.  Only shown when the container is expanded. */
  function showBracket(containerIdx) {
    if (collapsedIds.has(rows[containerIdx].id)) { return; }  // already collapsed
    var containerId = rows[containerIdx].id;
    var firstTr = null, lastTr = null;
    for (var j = containerIdx + 1; j < rows.length; j++) {
      if (!isDescendantOf(rows[j], containerId)) { continue; }
      if (rows[j]._hidden) { continue; }
      var trs = rows[j]._trs;
      if (!firstTr) { firstTr = trs[0]; }
      lastTr = trs[trs.length - 1];
    }
    if (!firstTr) { return; }
    var lpRect = leftPanel.getBoundingClientRect();
    var ftRect = firstTr.getBoundingClientRect();
    var ltRect = lastTr.getBoundingClientRect();
    var top    = ftRect.top    - lpRect.top + leftPanel.scrollTop;
    var bottom = ltRect.bottom - lpRect.top + leftPanel.scrollTop;
    bracketDiv.style.top    = top + 'px';
    bracketDiv.style.height = (bottom - top) + 'px';
    bracketDiv.style.display = 'block';
  }

  rows.forEach(function (row, i) {
    var span    = row.rowSpan || 1;
    var rowType = row.rowType || 'task';
    var isTask  = rowType === 'task';
    var sc      = isTask ? ((row.scenarios || {})[sc0] || {}) : {};
    var bg      = rowBgColor(row, i);

    /* First TR for this logical row */
    var tr = document.createElement('tr');
    tr.style.cssText = 'background:' + bg + ';height:' + ROW_H + 'px;' +
                       (isTask && row._isContainer ? 'font-weight:bold;' : '');

    /* Build the extra scenario TRs first so we can fill them below. */
    var scenarioTrs = [tr];
    for (var s = 1; s < span; s++) {
      var tr2 = document.createElement('tr');
      tr2.style.cssText = 'background:' + bg + ';height:' + ROW_H + 'px;';
      scenarioTrs.push(tr2);
    }

    row._trs = scenarioTrs;   /* saved for show/hide during collapse */
    rowTrs.push(scenarioTrs[0]);
    rowBgs.push(bg);

    cols.forEach(function (col) {
      /* Non-scenario-specific columns span all rows; scenario-specific ones
       * get a separate cell in each scenario TR. */
      var scSpecific = isTask && col.scenarioSpecific;
      var scNames    = scSpecific ? scenarios : [sc0];

      scNames.forEach(function (scName, si) {
        var scData = isTask ? ((row.scenarios || {})[scName] || {}) : sc;
        var targetTr = scenarioTrs[si] || tr;

        var td = document.createElement('td');
        td.style.cssText =
          'padding:1px 4px;text-align:' + col.align + ';' +
          'border-left:1px solid #9a9a9a;border-right:1px solid #9a9a9a;' +
          'box-shadow:inset 0 -1px 0 0 #9a9a9a;' +
          'vertical-align:middle;';
        if (!scSpecific && span > 1) { td.rowSpan = span; }

        if (col.id === 'name' && si === 0) {
          /* Use indentation from Ruby (matches static HTML treeMode logic).
           * Only rendered once (si === 0); rowSpan covers subsequent rows. */
          var indentPx = (row.indentation || 0) * INDENT_PX;

          var nameDiv = document.createElement('div');
          nameDiv.style.cssText =
            'display:flex;align-items:center;overflow:hidden;white-space:nowrap;';

          /* Toggle button — only for container task rows */
          if (isTask && row._isContainer) {
            (function (rowId, rowIdx) {
              var btn = document.createElement('span');
              btn.textContent = '\u25bc';   /* ▼ expanded; ▶ when collapsed */
              btn.style.cssText =
                'flex-shrink:0;width:12px;text-align:center;font-size:8px;' +
                'line-height:1;cursor:pointer;user-select:none;color:#444;' +
                'margin-right:1px;';
              btn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleCollapse(rowId);
              });
              btn.addEventListener('mouseenter', function () { showBracket(rowIdx); });
              btn.addEventListener('mouseleave', function () { bracketDiv.style.display = 'none'; });
              row._toggleBtn = btn;
              nameDiv.appendChild(btn);
            }(row.id, i));
          } else {
            /* Non-container: reserve the same 13px so columns stay aligned */
            var btnSpacer = document.createElement('span');
            btnSpacer.style.cssText = 'flex-shrink:0;width:13px;';
            nameDiv.appendChild(btnSpacer);
          }

          if (indentPx > 0) {
            var spacer = document.createElement('span');
            spacer.style.cssText = 'display:inline-block;flex-shrink:0;width:' + indentPx + 'px;';
            nameDiv.appendChild(spacer);
          }
          if (iconBase) {
            var isTaskLike = isTask || rowType === 'nested-task';
            var iconName = isTaskLike
              ? (row._isContainer ? 'taskgroup' : 'task')
              : (row.isLeaf ? 'resource' : 'resourcegroup');
            var img = document.createElement('img');
            img.src = iconBase + iconName + '.png';
            img.style.cssText = 'flex-shrink:0;margin-right:3px;';
            nameDiv.appendChild(img);
          }
          var nameSpan = document.createElement('span');
          nameSpan.style.cssText = 'overflow:hidden;white-space:nowrap;';
          nameSpan.textContent = row.name || '';
          nameDiv.appendChild(nameSpan);
          td.appendChild(nameDiv);
        } else if (col.id !== 'name') {
          var text = getCellText(row, col, scData);
          td.textContent = text;
          td.title       = text;
          if (col.id === 'bsi' && row.scopeId !== undefined) {
            td.style.paddingLeft = '20px'; /* 4px base + 16px static-HTML indent */
          }
        }

        targetTr.appendChild(td);
      });
    });
    /* Row hover: attach to all scenario TRs so multi-scenario rows don't flicker */
    (function (idx) {
      scenarioTrs.forEach(function (t) {
        t.addEventListener('mouseenter', function () {
          hoveredRowIdx = idx;
          updateRowHighlight();
        });
        t.addEventListener('mouseleave', function () {
          hoveredRowIdx = -1;
          updateRowHighlight();
        });
      });
    }(i));

    scenarioTrs.forEach(function (t) { tbody.appendChild(t); });
  });

  /* Return the text for a left-panel cell given the row, column and primary
   * scenario data.  Falls back to row.cols[col.id] for resource rows. */
  function getCellText(row, col, sc) {
    var rowType = row.rowType || 'task';
    var isTask  = rowType === 'task';

    if (isTask) {
      if      (col.id === 'bsi')      { return row.wbs || ''; }
      else if (col.id === 'id')       { return row.id  || ''; }
      else if (col.id === 'start')    { return fmtDate(sc.start); }
      else if (col.id === 'end')      { return fmtDate(sc.end);   }
      else if (col.id === 'effort')   { return sc.effort   || ''; }
      else if (col.id === 'duration') { return sc.duration || ''; }
      else if (col.id === 'cost')     { return sc.cost     || ''; }
      else if (col.id === 'revenue')  { return sc.revenue  || ''; }
      else if (col.id === 'complete') {
        return (sc && sc.complete != null) ? Math.round(sc.complete) + '%' : '';
      }
      /* Fallback: columns like note, status, responsible, etc. */
      if (row.cols && row.cols[col.id] != null) { return row.cols[col.id]; }
      return '';
    } else {
      /* Resource / nested rows */
      if (col.id === 'no')   { return String(row.no || ''); }
      if (col.id === 'name') { return row.name || ''; }  /* handled above */
      if (col.id === 'bsi')  { return row.bsi || (row.cols && row.cols['bsi']) || ''; }
      /* Other columns come from row.cols */
      if (row.cols && row.cols[col.id] != null) { return row.cols[col.id]; }
      return '';
    }
  }

  /* ── Right column: fixed header + scrollable body ── */
  var rightColumn = document.createElement('div');
  rightColumn.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';
  wrapper.appendChild(rightColumn);

  /* Fixed (non-scrolling) header strip */
  var rightHeader = document.createElement('div');
  rightHeader.style.cssText =
    'flex-shrink:0;overflow:hidden;height:' + HDR_H + 'px;';
  rightColumn.appendChild(rightHeader);

  /* ── SVG ── */
  var svgNS = 'http://www.w3.org/2000/svg';

  /* Header SVG — lives in the fixed strip and never scrolls */
  var hdrSvg = document.createElementNS(svgNS, 'svg');
  hdrSvg.setAttribute('width', '100%');
  hdrSvg.setAttribute('height', HDR_H);
  hdrSvg.style.cssText = 'display:block;overflow:hidden;';
  rightHeader.appendChild(hdrSvg);

  /* Scrollable body area */
  var rightBody = document.createElement('div');
  rightBody.style.cssText = 'flex:1;overflow-y:scroll;overflow-x:hidden;';
  rightColumn.appendChild(rightBody);

  /* Body SVG — scrolls with rightBody */
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', chartH);
  svg.style.cssText = 'display:block;overflow:hidden;';
  rightBody.appendChild(svg);

  /* defs — arrowhead marker */
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

  var markerHL = document.createElementNS(svgNS, 'marker');
  markerHL.setAttribute('id', 'tjArrowHL');
  markerHL.setAttribute('markerUnits', 'userSpaceOnUse');
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

  /* ── Layer groups ── */
  /* Create an SVG <g> element, set its class, append it to parent (defaulting
   * to the scrollable body svg), and return it.
   * cls    — CSS class name string.
   * parent — optional parent SVG element; defaults to the body svg. */
  function makeG(cls, parent) {
    var g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', cls);
    (parent || svg).appendChild(g);
    return g;
  }

  /* Header groups live in hdrSvg so they never scroll */
  var gHeader   = makeG('tj-header',    hdrSvg);
  var gHeaderBg = makeG('tj-header-bg',    gHeader);
  var gHeaderLg = makeG('tj-header-large', gHeader);
  var gHeaderSm = makeG('tj-header-small', gHeader);

  /* Body groups live in svg (the scrollable body SVG); no Y translate needed */
  var gBody         = makeG('tj-body');
  var gStripes      = makeG('tj-stripes',       gBody);
  var gTimeOff      = makeG('tj-timeoff',       gBody);
  var gRowHighlight = makeG('tj-row-highlight', gBody);
  var gBars         = makeG('tj-bars',          gBody);
  var gArrows       = makeG('tj-arrows',        gBody);
  var gBarHighlight = makeG('tj-bar-highlight', gBody);
  var gNow          = makeG('tj-now',           gBody);
  var gGrid         = makeG('tj-grid',          gBody);
  gBarHighlight.style.pointerEvents = 'none';

  var fadeTimeOff = makeFadeable(gTimeOff, { noClear: true });
  var fadeArrows  = makeFadeable(gArrows);

  /* ── D3 scale and zoom ── */
  /* Return the current pixel width of the right-column chart area, clamped to
   * a minimum of 200px to avoid degenerate scales before layout settles. */
  function getChartWidth() {
    return Math.max(200, rightColumn.getBoundingClientRect().width || 800);
  }

  var baseXScale = d3.scaleUtc()
    .domain([projectStart, projectEnd])
    .range([0, getChartWidth()]);

  var currentXScale = baseXScale.copy();

  /* Throttle renders to one per animation frame so that rapid zoom/wheel
   * events (which D3 fires synchronously for every pixel of movement) do not
   * trigger a full SVG rebuild on each event. */
  var _rafId = null;
  function scheduleRender() {
    if (_rafId) { return; }
    _rafId = requestAnimationFrame(function () {
      _rafId = null;
      render(currentXScale);
    });
  }

  var zoom = d3.zoom()
    .scaleExtent([0.02, 500])
    .on('zoom', function (event) {
      var t  = event.transform;
      var xt = d3.zoomIdentity.translate(t.x, 0).scale(t.k);
      currentXScale = xt.rescaleX(baseXScale);
      scheduleRender();
    });

  /* Zoom is applied only to the body SVG so a single zoom state is tracked.
   * Wheel events on the header SVG are forwarded to the body SVG. */
  d3.select(svg).call(zoom);
  svg.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  hdrSvg.addEventListener('wheel', function (e) {
    e.preventDefault();
    svg.dispatchEvent(new WheelEvent('wheel', e));
  }, { passive: false });

  /* ── Synchronise vertical scroll ── */
  var _scrollLock = false;
  leftPanel.addEventListener('scroll', function () {
    if (_scrollLock) { return; }
    _scrollLock = true;
    rightBody.scrollTop = leftPanel.scrollTop;
    _scrollLock = false;
  });
  rightBody.addEventListener('scroll', function () {
    if (_scrollLock) { return; }
    _scrollLock = true;
    leftPanel.scrollTop = rightBody.scrollTop;
    _scrollLock = false;
  });

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

  /* ───────────────────────── Render helpers ───────────────────────────── */
  /* Create an SVG element of the given tag, set all key/value pairs in attrs,
   * append to parent if provided, and return the element.
   * tag    — SVG element tag name (e.g. 'rect', 'line', 'path').
   * parent — optional parent node to append to.
   * attrs  — optional plain object of attribute name → value pairs. */
  function svgEl(tag, parent, attrs) {
    var el = document.createElementNS(svgNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    }
    if (parent) { parent.appendChild(el); }
    return el;
  }

  /* Remove all child nodes from an SVG <g> element.
   * g — the SVG group to clear. */
  function clearG(g) {
    while (g.firstChild) { g.removeChild(g.firstChild); }
  }

  /* Wraps a <g> so that show/hide transitions fade rather than snap.
   * On the very first call (initial render) no animation is applied.
   * While visible, re-renders clear and repopulate with no animation.
   * On hide: fades to opacity 0, then clears DOM after LOD_FADE_MS.
   * On show: renders content at opacity 0, forces reflow, fades to 1.
   *
   * opts.noClear — when true, skip clearG during re-renders; the renderFn
   *               is responsible for managing its own element lifecycle
   *               (e.g. via a D3 join). clearG is still called after hiding. */
  function makeFadeable(g, opts) {
    opts = opts || {};
    var visible = null;   /* null = not yet rendered */
    var timer   = null;
    return {
      update: function (show, renderFn) {
        var initial = visible === null;
        if (show) {
          if (timer) { clearTimeout(timer); timer = null; }
          if (visible) {
            /* Already shown — redraw in place without animation. */
            g.style.transition = 'none';
            g.style.opacity = '1';
            if (!opts.noClear) { clearG(g); }
            renderFn();
          } else {
            /* Transitioning hidden → shown (or initial render). */
            if (!opts.noClear) { clearG(g); }
            renderFn();
            if (initial) {
              g.style.opacity = '1';
            } else {
              g.style.transition = 'none';
              g.style.opacity = '0';
              g.getBoundingClientRect();  /* force reflow before transition */
              g.style.transition = LOD_FADE_TRANSITION;
              g.style.opacity = '1';
            }
          }
          visible = true;
        } else {
          if (visible || initial) {
            /* Transitioning shown → hidden (or initial render with show=false). */
            if (initial) {
              g.style.opacity = '0';
              if (!opts.noClear) { clearG(g); }
            } else {
              g.style.transition = LOD_FADE_TRANSITION;
              g.style.opacity = '0';
              timer = setTimeout(function () { clearG(g); timer = null; }, LOD_FADE_MS);
            }
          }
          visible = false;
        }
      }
    };
  }

  /* ── Project-timezone-aware tick helpers ── */

  /* Build an Intl formatter that outputs dates in the project timezone. */
  function tzFmt(options) {
    var f = new Intl.DateTimeFormat('en-US',
      Object.assign({ timeZone: projectTz }, options));
    return function(d) { return f.format(d); };
  }

  /* Like tzFmt but assembles selected parts in a specific order. */
  function tzFmtParts(options, order) {
    var f = new Intl.DateTimeFormat('en-US',
      Object.assign({ timeZone: projectTz }, options));
    return function(d) {
      var parts = {};
      f.formatToParts(d).forEach(function(p) { parts[p.type] = p.value; });
      return order.map(function(k) { return parts[k] || ''; }).join(' ');
    };
  }

  /* Generate ticks at project-timezone midnight / boundary positions.
   * Strategy: shift the current domain by +tzOffsetMs so that UTC
   * midnight in the shifted space equals project-local midnight in real
   * time; generate UTC ticks there; shift each tick back by -tzOffsetMs.
   * This aligns ticks with the project timezone rather than UTC or the
   * browser's local timezone. */
  function projectTicks(xScale, interval) {
    var dom = xScale.domain();
    var rng = xScale.range();
    var shifted = d3.scaleUtc()
      .domain([new Date(dom[0].getTime() + tzOffsetMs),
               new Date(dom[1].getTime() + tzOffsetMs)])
      .range(rng);
    return shifted.ticks(interval).map(function(t) {
      return new Date(t.getTime() - tzOffsetMs);
    });
  }

  /* Compute the current zoom ratio in pixels per day from a D3 UTC scale.
   * xScale — a d3.scaleUtc() instance with a Date domain and pixel range.
   * Returns a positive number; larger values mean more zoomed in. */
  function computePpd(xScale) {
    var domainMs = xScale.domain()[1] - xScale.domain()[0];
    var rangeW   = xScale.range()[1]  - xScale.range()[0];
    return rangeW / (domainMs / 86400000);
  }

  /*
   * Returns an LOD descriptor for the current zoom level. Fields:
   *   ppd            — pixels per day
   *   bucketDays     — merge this many daily load-stack buckets into one rect
   *   (off-duty zone visibility is controlled by the global TIMEOFF_MIN_PX constant)
   *   showArrows     — render dependency arrows at all
   *   large / small  — d3 tick intervals for the header (large = top row, small = bottom)
   *   largeFmt / smallFmt — Intl formatters for each header row
   *
   * Five zoom levels keyed on ppd:
   *   ppd < 0.2   year scale
   *   ppd < 2     quarter scale
   *   ppd < 15    month scale
   *   ppd < 60    week scale
   *   ppd >= 60   day scale (full detail)
   */
  function computeLod(xScale) {
    var ppd = computePpd(xScale);

    if (ppd < LOD_PPD_YEAR) {
	/* YEAR */
      return { ppd: ppd, bucketDays: 365, showArrows: false,
               large: d3.utcYear.every(10),  largeFmt: tzFmt({ year: 'numeric' }),
               small: d3.utcYear.every(1),   smallFmt: tzFmt({ year: 'numeric' }) };
    } else if (ppd < LOD_PPD_QUARTER) {
	/* QUARTER */
      return { ppd: ppd, bucketDays: 30,  showArrows: false,
               large: d3.utcYear.every(1),   largeFmt: tzFmt({ year: 'numeric' }),
               small: d3.utcMonth.every(3),  smallFmt: tzFmt({ month: 'short' }) };
    } else if (ppd < LOD_PPD_MONTH) {
	/* MONTH */
      return { ppd: ppd, bucketDays: 7,   showArrows: true,
               large: d3.utcMonth.every(1),
               largeFmt: tzFmtParts({ month: 'short', year: 'numeric' }, ['month', 'year']),
               small: d3.utcMonday.every(1), smallFmt: tzFmt({ day: 'numeric' }) };
    } else if (ppd < LOD_PPD_WEEK) {
	/* WEEK */
      return { ppd: ppd, bucketDays: 1,   showArrows: true,
               large: d3.utcMonday.every(1),
               largeFmt: tzFmtParts({ month: 'short', day: 'numeric' }, ['month', 'day']),
               small: d3.utcDay.every(1),    smallFmt: tzFmt({ day: 'numeric' }) };
    } else {
	/* DAY */
      return { ppd: ppd, bucketDays: 1,   showArrows: true,
               large: d3.utcDay.every(1),
               largeFmt: tzFmtParts({ weekday: 'short', day: 'numeric', month: 'short' },
                                    ['weekday', 'day', 'month']),
               small: d3.utcHour.every(1),
               smallFmt: tzFmt({ hour: '2-digit', minute: '2-digit', hour12: false }) };
    }
  }

  /* ── Header ── */
  /* Background is rendered once and its width updated on resize. */
  var _hdrBgRect  = svgEl('rect', gHeaderBg, { x: 0, y: 0, height: HDR_H, fill: C.headerBg });
  var _hdrRowH    = HDR_H / 2;
  svgEl('line', gHeaderBg, { x1: 0, y1: _hdrRowH - 0.5, x2: 99999, y2: _hdrRowH - 0.5,
                              stroke: C.headerBorder, 'stroke-width': 1 });
  svgEl('line', gHeaderBg, { x1: 0, y1: HDR_H - 0.5,    x2: 99999, y2: HDR_H - 0.5,
                              stroke: C.headerBorder, 'stroke-width': 1 });

  /* Tick groups use D3 joins keyed by timestamp so that:
   *   • pan/zoom within the same LOD → update positions of existing elements
   *   • LOD change → old ticks exit, new ones enter (new format, new interval)
   * Each tick is a <g> containing a separator <line> and a <text> label. */
  /* lxMin: minimum x for the label (clamps x+3); use 0 for no effective clamp. */
  function _renderTickRow(xScale, gEl, ticks, y1, y2, labelY, minAvail, fmtFn, lxMin, w) {
    var data = ticks.map(function (d, i) {
      var x   = xScale(d);
      var x1  = (i + 1 < ticks.length) ? xScale(ticks[i + 1]) : w;
      return { t: d.getTime(), x: x, avail: x1 - Math.max(x + 3, 2), label: fmtFn(d) };
    });

    d3.select(gEl).selectAll('g').data(data, function (d) { return d.t; })
      .join(function (enter) {
        var g = enter.append('g');
        g.append('line')
          .attr('stroke', C.headerBorder).attr('stroke-width', 1)
          .attr('y1', y1).attr('y2', y2);
        g.append('text')
          .attr('y', labelY).attr('fill', C.headerFg)
          .attr('font-size', '10px').attr('font-family', 'sans-serif')
          .attr('font-weight', 'bold');
        return g;
      })
      .each(function (d) {
        var g  = d3.select(this);
        var lx = Math.max(d.x + 3, lxMin);
        g.select('line').attr('x1', d.x).attr('x2', d.x);
        g.select('text').attr('x', lx)
          .attr('display', d.avail > minAvail ? null : 'none')
          .text(d.label);
      });
  }

  var _hdrBgRectW = -1;
  /* Render the two-row chart header (large ticks on top, small ticks below).
   * Updates the background rect width whenever the chart is resized.
   * xScale — current D3 UTC scale.
   * lod    — LOD descriptor from computeLod(). */
  function renderHeader(xScale, lod) {
    var w = getChartWidth();

    if (w !== _hdrBgRectW) {
      _hdrBgRect.setAttribute('width', w);
      _hdrBgRectW = w;
    }

    _renderTickRow(xScale, gHeaderLg, projectTicks(xScale, lod.large),
      0, _hdrRowH, _hdrRowH - 5, 5, lod.largeFmt, 2, w);
    _renderTickRow(xScale, gHeaderSm, projectTicks(xScale, lod.small),
      _hdrRowH, HDR_H, HDR_H - 4, 4, lod.smallFmt, 0, w);
  }

  /* ── Row stripes ── */
  /* Render alternating background stripe rectangles and horizontal row-divider
   * lines for every row. Skips work entirely when the chart width has not changed
   * since the last call (width is tracked by _stripesW).
   * xScale — current D3 UTC scale (used only to read chart width). */
  function renderStripes(xScale) {
    var w = getChartWidth();
    if (w === _stripesW) { return; }
    _stripesW = w;
    clearG(gStripes);
    rows.forEach(function (row, i) {
      if (row._hidden) { return; }
      var y = yOffsets[i];
      var h = rowVisualHeight(row);
      svgEl('rect', gStripes, { x: 0, y: y, width: w, height: h, fill: rowBgs[i] });
      svgEl('line', gStripes, { x1: 0, y1: y + h - 0.5, x2: w, y2: y + h - 0.5,
                                 stroke: C.headerBorder, 'stroke-width': 1 });
    });
  }

  /* ── Off-duty zones (weekends / holidays per task row) ── */
  /* Uses a D3 join keyed by zone start time so that zones narrower than
   * TIMEOFF_MIN_PX fade out via the exit selection and reappear via
   * the enter selection as the user zooms in and out.
   * Zones beyond TIMEOFF_PAN_MARGIN px outside the viewport are excluded
   * to prevent spurious enter/exit fades while panning. */
  function renderTimeOff(xScale) {
    var w       = getChartWidth();
    var allData = [];
    rows.forEach(function (row, i) {
      if (row._hidden) { return; }
      if ((row.rowType || 'task') !== 'task') { return; }
      var y      = yOffsets[i];
      var h      = rowVisualHeight(row);
      var zones = ((row.scenarios || {})[sc0] || {}).timeoff || [];

      zones.forEach(function (zone) {
        var x0 = xScale(new Date(zone[0] * 1000));
        var x1 = xScale(new Date(zone[1] * 1000));
        if (x1 < -RENDER_MARGIN || x0 > w + RENDER_MARGIN || x1 - x0 < TIMEOFF_MIN_PX) { return; }
        allData.push({ key: i + '/' + zone[0], x: x0, width: x1 - x0, y: y, h: h });
      });
    });

    var sel = d3.select(gTimeOff).selectAll('rect')
      .data(allData, function (d) { return d.key; });

    /* Enter: zones fade in when they grow wide enough. */
    sel.enter().append('rect')
      .attr('y',       function (d) { return d.y; })
      .attr('height',  function (d) { return d.h; })
      .attr('fill',    C.offduty)
      .attr('x',       function (d) { return d.x; })
      .attr('width',   function (d) { return d.width; })
      .attr('opacity', 0)
      .transition().duration(LOD_FADE_MS)
      .attr('opacity', 1);

    /* Update: existing zones always update position instantly.
     * y and h are updated here in addition to x/width so that collapse/expand
     * events (which shift yOffsets for rows below the hidden section) are
     * reflected without requiring a full D3 exit/re-enter cycle.
     * opacity is reset to 1 in case the element was mid-fade-out when it
     * re-entered the update selection (e.g. zoom reversal before exit completes). */
    sel.interrupt()
      .attr('x',       function (d) { return d.x; })
      .attr('y',       function (d) { return d.y; })
      .attr('width',   function (d) { return d.width; })
      .attr('height',  function (d) { return d.h; })
      .attr('opacity', 1);

    /* Exit: zones that become too narrow fade out then are removed. */
    sel.exit()
      .transition().duration(LOD_FADE_MS)
      .attr('opacity', 0)
      .remove();
  }

  /* ── Grid lines ── */
  /* Uses a D3 join keyed by tick timestamp (same pattern as renderHeader) so
   * that zooming within the same LOD updates positions in place rather than
   * destroying and recreating DOM elements.  Ticks are generated RENDER_MARGIN
   * beyond each edge so the pan fast path can shift the group without gaps. */
  function renderGrid(xScale, lod) {
    var w        = getChartWidth();
    var expScale = d3.scaleUtc()
      .domain([xScale.invert(-RENDER_MARGIN), xScale.invert(w + RENDER_MARGIN)])
      .range([-RENDER_MARGIN, w + RENDER_MARGIN]);
    var tickData = projectTicks(expScale, lod.small).map(function (d) {
      return { t: d.getTime(), x: xScale(d) };
    });
    d3.select(gGrid).selectAll('line')
      .data(tickData, function (d) { return d.t; })
      .join(function (enter) {
        return enter.append('line')
          .attr('stroke', C.gridLine).attr('stroke-width', 1)
          .attr('y1', 0);
      })
      .attr('y2', chartH)
      .attr('x1', function (d) { return d.x; })
      .attr('x2', function (d) { return d.x; });
  }

  /* ── Now line ── */
  /* Render a single red vertical line at today's date (nowDate). The line is
   * omitted when it falls outside the RENDER_MARGIN-extended viewport so it
   * does not interfere with the pan fast-path transform.
   * xScale — current D3 UTC scale. */
  function renderNowLine(xScale) {
    clearG(gNow);
    var x = xScale(nowDate);
    var w = getChartWidth();
    if (x >= -RENDER_MARGIN && x <= w + RENDER_MARGIN) {
      svgEl('line', gNow, { x1: x, y1: 0, x2: x, y2: chartH,
                             stroke: C.nowline, 'stroke-width': 1 });
    }
  }

  /* ── Task bars + load stacks ── */
  /* Clear gBars and redraw all rows. Task rows render one bar per scenario
   * (stacked vertically by rowSpan); resource/nested rows render a load-stack.
   * Viewport culling skips bars entirely outside RENDER_MARGIN.
   * xScale — current D3 UTC scale.
   * lod    — LOD descriptor from computeLod(), forwarded to renderLoadStack. */
  function renderBars(xScale, lod) {
    clearG(gBars);
    var w = getChartWidth();

    rows.forEach(function (row, i) {
      if (row._hidden) { return; }
      var rowType = row.rowType || 'task';
      var y0      = yOffsets[i];

      if (rowType === 'task') {
        /* One bar per scenario, stacked vertically */
        var scenarios = project.scenarios || [sc0];
        scenarios.forEach(function (scId, s) {
          if (s >= (row.rowSpan || 1)) { return; }
          var sc      = (row.scenarios || {})[scId] || {};
          var yCenter = y0 + s * ROW_H + ROW_H / 2;
          if (!sc.start || !sc.end) { return; }
          var tStart = projectMidnight(sc.start);
          var tEnd   = projectMidnight(sc.end);

          /* Viewport cull */
          var bx0 = xScale(tStart);
          var bx1 = xScale(tEnd);
          if (bx1 < -RENDER_MARGIN || bx0 > w + RENDER_MARGIN) { return; }
          /* Width cull (skip milestones — they are single-point markers) */
          if (!sc.milestone && (bx1 - bx0) < 1) { return; }

          var g = makeG('tj-task', gBars);
          g._rowId = row.id;
          if (sc.milestone) {
            renderMilestone(g, xScale, tStart, yCenter);
          } else if (row._isContainer) {
            renderContainer(g, xScale, tStart, tEnd, yCenter);
          } else {
            renderTaskBar(g, xScale, tStart, tEnd, yCenter, sc.complete || 0);
          }

          attachTooltip(g, row.tooltip, row.name);
        });
      } else {
        /* Load stack row — render proportional bars for primary scenario */
        var lg = makeG('tj-loadstack', gBars);
        renderLoadStack(row, y0, xScale, w, lod, lg);
        attachTooltip(lg, row.tooltip, row.name);
      }
    });
  }

  /* Render a normal task bar into g: a dark frame rect, a blue inner rect, and
   * an optional dark progress rect covering the completed percentage.
   * g        — target SVG <g> to draw into.
   * xScale   — current D3 UTC scale.
   * tStart   — task start as a Date object.
   * tEnd     — task end as a Date object.
   * yCenter  — vertical center Y coordinate in pixels.
   * complete — completion percentage (0–100). */
  function renderTaskBar(g, xScale, tStart, tEnd, yCenter, complete) {
    var x  = xScale(tStart);
    var x2 = xScale(tEnd);
    var w  = Math.max(2, x2 - x);
    var bh = BAR_HALF;

    svgEl('rect', g, { x: x, y: yCenter - bh, width: w, height: bh * 2,
                       fill: C.taskbarFrame });
    svgEl('rect', g, { x: x + 1, y: yCenter - bh + 1,
                       width: Math.max(0, w - 2), height: bh * 2 - 2,
                       fill: C.taskbar });
    var pct = Math.max(0, Math.min(100, complete || 0));
    if (pct > 0) {
      svgEl('rect', g, { x: x + 1, y: yCenter - bh / 2,
                         width: Math.max(0, (w - 2) * pct / 100),
                         height: bh, fill: C.progressbar });
    }
  }

  /* Render a container/summary task bar into g: a dark horizontal bar spanning
   * the full duration with downward-pointing jag (triangle) markers at each end,
   * matching the static HTML GanttContainer rendering.
   * g       — target SVG <g>.
   * xScale  — current D3 UTC scale.
   * tStart  — container start as a Date object.
   * tEnd    — container end as a Date object.
   * yCenter — vertical center Y coordinate in pixels. */
  function renderContainer(g, xScale, tStart, tEnd, yCenter) {
    var x   = xScale(tStart);
    var x2  = xScale(tEnd);
    var w   = Math.max(2, x2 - x);
    var s   = CONT_HALF;
    var top = yCenter - s;
    var mid = yCenter;
    var tip = yCenter + s;

    svgEl('rect', g, { x: x - s, y: top, width: w + 2 * s, height: s,
                       fill: C.container });
    svgEl('polygon', g, {
      points: (x-s)+','+mid+' '+(x+s)+','+mid+' '+x+','+tip,
      fill: C.container
    });
    svgEl('polygon', g, {
      points: (x+w-s)+','+mid+' '+(x+w+s)+','+mid+' '+(x+w)+','+tip,
      fill: C.container
    });
  }

  /* Render a milestone as a diamond (rotated square polygon) centered on tStart.
   * g       — target SVG <g>.
   * xScale  — current D3 UTC scale.
   * tStart  — milestone date as a Date object.
   * yCenter — vertical center Y coordinate in pixels. */
  function renderMilestone(g, xScale, tStart, yCenter) {
    var cx = xScale(tStart);
    var r  = MS_HALF;
    svgEl('polygon', g, {
      points: cx+','+(yCenter-r)+' '+(cx+r)+','+yCenter+' '+
              cx+','+(yCenter+r)+' '+(cx-r)+','+yCenter,
      fill: C.milestone
    });
  }

  /* Return the Unix timestamp (seconds) of the Monday that starts the
   * calendar week containing bucketUnixS, in the project timezone. */
  function mondayOf(bucketUnixS) {
    var localDay = Math.floor((bucketUnixS * 1000 + tzOffsetMs) / 86400000);
    var dow      = ((localDay % 7) + 7 + 3) % 7;  // 0=Mon…6=Sun (epoch Thu = 3)
    return ((localDay - dow) * 86400000 - tzOffsetMs) / 1000;
  }

  /* Merge per-day buckets into super-buckets for lower-detail LODs.
   * Values are summed; the merged entry carries a _days field for correct
   * pixel-width computation.
   *
   * n=7  → calendar-week-aligned groups (Monday boundaries, project timezone)
   * else → count-based groups of n consecutive buckets */
  function mergeBuckets(buckets, n) {
    if (n <= 1 || !buckets.length) { return buckets; }
    var nCats  = buckets[0].length - 1;
    var merged = [];

    if (n === 7) {
      /* Group by calendar week: key is the Monday timestamp of each bucket. */
      var groups = Object.create(null);
      var order  = [];
      buckets.forEach(function (b) {
        var key = mondayOf(b[0]);
        if (!groups[key]) {
          groups[key] = { start: b[0], sums: new Array(nCats).fill(0), count: 0 };
          order.push(key);
        }
        var g = groups[key];
        for (var ci = 0; ci < nCats; ci++) { g.sums[ci] += Math.max(0, b[ci + 1] || 0); }
        g.count++;
      });
      order.forEach(function (key) {
        var g     = groups[key];
        var entry = [g.start].concat(g.sums);
        entry._days = g.count;
        merged.push(entry);
      });
    } else {
      /* Count-based grouping for year/quarter scales. */
      var i = 0;
      while (i < buckets.length) {
        var groupStart = buckets[i][0];
        var sums       = new Array(nCats).fill(0);
        var count      = 0;
        while (count < n && i < buckets.length) {
          var b = buckets[i];
          for (var ci = 0; ci < nCats; ci++) { sums[ci] += Math.max(0, b[ci + 1] || 0); }
          i++; count++;
        }
        var entry = [groupStart].concat(sums);
        entry._days = count;
        merged.push(entry);
      }
    }
    return merged;
  }

  /* Render proportional load-stack bars for a non-task row, matching the
   * Ruby GanttLoadStack.to_html rendering approach:
   *   1. Draw a dark frame rectangle (loadstackframe) for the whole column.
   *   2. Inside the frame (1px margins), draw category bars in reverse order
   *      (last category → first), so that for ['assigned','busy','free'] the
   *      order from top is: free (green), busy (pink), assigned (red).
   * Each daily bucket maps to one column of stacked rectangles. */
  function renderLoadStack(row, yTop, xScale, chartWidth, lod, targetG) {
    if (!targetG) { targetG = gBars; }
    var scId = (project.scenarios || [sc0])[0] || sc0;
    var ld   = row.loadData && row.loadData[scId];
    if (!ld || !ld.buckets || !ld.buckets.length) { return; }

    var categories = ld.categories || ['busy', 'free'];
    /* 1px margin top and bottom inside the row (matching Ruby y=1 / height-2) */
    var frameH = rowVisualHeight(row) - 2;
    /* Inner bar area: 1px inside the frame on all sides */
    var innerH = frameH - 2;

    /* Pre-compute visible time window in Unix seconds so off-screen buckets
     * can be culled with a plain numeric comparison — no Date allocation or
     * xScale call needed.  Buckets are chronologically sorted, so we can
     * break out of the loop once we are past the right edge. */
    var visStartS = xScale.invert(-RENDER_MARGIN).getTime() / 1000;
    var visEndS   = xScale.invert(chartWidth + RENDER_MARGIN).getTime() / 1000;

    /* At quarter/year LOD, nested-resource rows collapse to a single bar
     * anchored to the parent task's start/end rather than bucket boundaries,
     * so the bar edges stay stable as the user crosses the LOD threshold. */
    var buckets;
    if (row.rowType === 'nested-resource' && lod.bucketDays >= 30) {
      var parentEntry = row.scopeId && taskRowById[row.scopeId];
      var parentTask  = parentEntry && parentEntry.row;
      if (parentTask && parentTask._start && parentTask._end) {
        if (!row._loadSums) {
          var nCats = (ld.buckets[0] || []).length - 1;
          var sums  = new Array(nCats).fill(0);
          ld.buckets.forEach(function (b) {
            for (var ci = 0; ci < nCats; ci++) { sums[ci] += Math.max(0, b[ci + 1] || 0); }
          });
          row._loadSums = sums;
        }
        var taskStartS = parentTask._start.getTime() / 1000;
        var taskEndS   = parentTask._end.getTime()   / 1000;
        var synthetic  = [taskStartS].concat(row._loadSums);
        synthetic._days = (taskEndS - taskStartS) / 86400;
        buckets = [synthetic];
      }
    }
    if (!buckets) { buckets = mergeBuckets(ld.buckets, lod.bucketDays); }

    for (var bi = 0; bi < buckets.length; bi++) {
      var bucket    = buckets[bi];
      var bucketS   = bucket[0];          /* Unix seconds at bucket start */
      var durationS = (bucket._days || 1) * 86400;
      if (bucketS + durationS <= visStartS) { continue; }   /* entirely left of view */
      if (bucketS             >= visEndS)   { break; }       /* entirely right of view */

      var x0 = xScale(new Date(bucketS * 1000));
      var x1 = xScale(new Date((bucketS + durationS) * 1000));
      var bw = x1 - x0;
      if (bw < 0.5) { continue; }

      var vals  = bucket.slice(1);
      var total = 0;
      vals.forEach(function (v) { total += Math.max(0, v || 0); });

      /* Always draw the frame, even when total == 0 (matches Ruby drawFrame). */
      svgEl('rect', targetG, {
        x: x0, y: yTop + 1, width: bw, height: frameH,
        fill: C.loadstackframe
      });

      if (total <= 0) { continue; }

      /* Draw category bars in reverse (last index first = free→busy→assigned
       * from top), accumulating y downward. Matches Ruby's downto(0) loop. */
      var yUsed = 0;
      for (var ci = categories.length - 1; ci >= 0; ci--) {
        var h = Math.max(0, vals[ci] || 0) / total * innerH;
        if (h < 0.5) { yUsed += h; continue; }
        svgEl('rect', targetG, {
          x: x0 + 1, y: yTop + 2 + yUsed,
          width: Math.max(0, bw - 2), height: h,
          fill: loadCatColor[categories[ci]] || '#888'
        });
        yUsed += h;
      }
    }
  }

  /* ── Dependency arrows ── */
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

  /* Render SVG path dependency arrows for all task rows in the primary scenario.
   * Each arrow runs from the end of the predecessor to the start of the successor.
   * Inherited dependencies (shared with a parent task) are skipped to avoid clutter.
   * When either endpoint is hidden (collapsed), the arrow is rerouted to the nearest
   * visible ancestor.  Arrows that resolve to the same visible row are dropped.
   * Duplicate rerouted arrows (multiple hidden children → same ancestor pair) are
   * deduplicated via a drawn-pair set.
   * xScale — current D3 UTC scale. */
  function renderArrows(xScale) {
    clearG(gArrows);
    var drawn = Object.create(null);  /* "predId->succId" → true, for dedup */

    rows.forEach(function (row, i) {
      if ((row.rowType || 'task') !== 'task') { return; }
      if (!row.depends || !row.depends.length) { return; }

      row.depends.forEach(function (dep) {
        if ((dep.scenario || sc0) !== sc0) { return; }
        var predInfo = taskRowById[dep.id];
        if (!predInfo) { return; }

        /* Resolve visible proxy for each endpoint. */
        var succInfo = visibleAncestorInfo(row.id);
        var pInfo    = visibleAncestorInfo(dep.id);
        if (!succInfo || !pInfo) { return; }
        if (succInfo.row.id === pInfo.row.id) { return; }  /* degenerate */

        /* Deduplicate rerouted pairs. */
        var key = pInfo.row.id + '->' + succInfo.row.id;
        if (drawn[key]) { return; }
        drawn[key] = true;

        /* Skip inherited dependencies only when neither endpoint was rerouted. */
        if (!row._hidden && !predInfo.row._hidden && row.parent) {
          var parentInfo = taskRowById[row.parent];
          if (parentInfo && parentInfo.row.depends && parentInfo.row.depends.some(function (pd) {
            return pd.id === dep.id && (pd.scenario || sc0) === sc0;
          })) { return; }
        }

        var pred = pInfo.row;
        var succ = succInfo.row;
        if (!pred._end || !succ._start) { return; }

        var sx = xScale(pred._end);
        var sy = yOffsets[pInfo.idx] + ROW_H / 2;
        var ex = xScale(succ._start);
        var ey = yOffsets[succInfo.idx] + ROW_H / 2;

        svgEl('path', gArrows, {
          d: routeArrow(sx, sy, ex, ey), fill: 'none', stroke: C.depline,
          'stroke-width': 1, 'marker-end': 'url(#tjArrow)'
        });
      });
    });
  }

  /* ── Main render ── */
  /* Two paths:
   *
   * Pan fast path — when the zoom scale (k) is unchanged and the accumulated
   * pan (dx) is within RENDER_MARGIN of the last full render:
   *   • Apply a single transform="translate(dx,0)" to each date-positioned group.
   *   • Only update the header (D3 join, cheap).
   *   • All other groups (bars, grid, now-line, timeoff, arrows) shift as one
   *     without any DOM creation or attribute mutation per element.
   *
   * Full render — on zoom level change or when dx exceeds RENDER_MARGIN:
   *   • Reset group transforms.
   *   • Rebuild everything, but extend the viewport cull by RENDER_MARGIN on
   *     each side so future fast-path pans have pre-rendered content available.
   */
  function render(xScale) {
    var lod = computeLod(xScale);
    var t   = d3.zoomTransform(svg);

    if (_panBaseT !== null && t.k === _panBaseT.k) {
      var dx = t.x - _panBaseT.x;
      if (Math.abs(dx) < RENDER_MARGIN) {
        /* Fast path: translate pre-rendered body content, refresh header only. */
        var xlate = 'translate(' + dx + ',0)';
        gBars.setAttribute('transform',         xlate);
        gBarHighlight.setAttribute('transform', xlate);
        gGrid.setAttribute('transform',         xlate);
        gNow.setAttribute('transform',          xlate);
        gTimeOff.setAttribute('transform',      xlate);
        gArrows.setAttribute('transform',       xlate);
        renderHeader(xScale, lod);
        return;
      }
    }

    /* Full render: reset transforms, rebuild with RENDER_MARGIN expansion. */
    _panBaseT = { x: t.x, k: t.k };
    gBars.removeAttribute('transform');
    gBarHighlight.removeAttribute('transform');
    gGrid.removeAttribute('transform');
    gNow.removeAttribute('transform');
    gTimeOff.removeAttribute('transform');
    gArrows.removeAttribute('transform');

    renderHeader(xScale, lod);
    renderStripes(xScale);
    fadeTimeOff.update(true, function () { renderTimeOff(xScale); });
    renderGrid(xScale, lod);
    renderNowLine(xScale);
    renderBars(xScale, lod);
    fadeArrows.update(lod.showArrows, function () { renderArrows(xScale); });
    _lastXScale = xScale;        /* capture for updateBarHighlight() */
    updateRowHighlight();         /* refresh gRowHighlight width after any resize */
    updateBarHighlight();         /* redraw chain highlight at new scale */
  }

  /* Apply initialScale from project metadata (set when a daily/weekly/monthly/
   * quarterly/yearly column is present).  We set the zoom transform rather than
   * shrinking baseXScale so that scaleExtent stays consistent across all charts. */
  var _SCALE_MS = {
    'day':     86400 * 1000,
    'week':    7  * 86400 * 1000,
    'month':   31 * 86400 * 1000,
    'quarter': 91 * 86400 * 1000,
    'year':   365 * 86400 * 1000
  };
  if (project.initialScale && _SCALE_MS[project.initialScale]) {
    var domainMs    = projectEnd.getTime() - projectStart.getTime();
    var scaleFactor = domainMs / _SCALE_MS[project.initialScale];
    /* zoom.transform fires the zoom handler synchronously, updating currentXScale */
    d3.select(svg).call(zoom.transform, d3.zoomIdentity.scale(scaleFactor));
  }

  /* Restore the visible date range saved immediately before a live-reload.
   * Uses date-based bounds so the view survives project domain changes.
   * Runs after initialScale so it takes priority when present. */
  (function () {
    var saved = sessionStorage.getItem('tjchart-view');
    if (!saved) { return; }
    sessionStorage.removeItem('tjchart-view');
    try {
      var v   = JSON.parse(saved);
      var lPx = baseXScale(new Date(v.l));
      var rPx = baseXScale(new Date(v.r));
      if (rPx - lPx > 1) {
        var k = getChartWidth() / (rPx - lPx);
        d3.select(svg).call(zoom.transform,
          d3.zoomIdentity.translate(-lPx * k, 0).scale(k));
      }
    } catch (e) { /* malformed saved state — ignore */ }
  })();

  /* Called by the live-reload watcher just before location.reload().
   * Captures the currently visible date range (left/right edges) so the
   * chart can be restored to the same view after the page reloads. */
  window._tjSaveView = function () {
    var t  = d3.zoomTransform(svg);
    var xt = d3.zoomIdentity.translate(t.x, 0).scale(t.k).rescaleX(baseXScale);
    sessionStorage.setItem('tjchart-view', JSON.stringify({
      l: xt.invert(0).getTime(),
      r: xt.invert(getChartWidth()).getTime()
    }));
  };

  render(currentXScale);

  window.addEventListener('resize', function () {
    _stripesW = -1;   // force stripe redraw on new width
    baseXScale.range([0, getChartWidth()]);
    var t = d3.zoomTransform(svg);
    currentXScale = d3.zoomIdentity.translate(t.x, 0).scale(t.k).rescaleX(baseXScale);
    scheduleRender();
  });

})();

/* ── Live-reload watcher ──────────────────────────────────────────────────
 * Polls for changes to the generated HTML file and reloads when a new
 * version is detected.  Works for http[s]:// (all browsers) and file://
 * (Firefox; Chrome blocks same-origin file:// fetch).  Falls back to
 * reloading on tab focus/visibility for protocols where fetch is blocked.
 */
(function () {
  'use strict';

  var POLL_MS = 2000;

  /* Read the tj-generated timestamp embedded by TaskJuggler at report-gen time. */
  var metaEl = document.querySelector('meta[name="tj-generated"]');
  if (!metaEl) { return; }   /* not a TaskJuggler report — do nothing */

  var initialStamp = metaEl.getAttribute('content');
  console.log('tjchart: watching for changes (tj-generated=' + initialStamp + ')');

  /* Extract the tj-generated content value from a raw HTML string. */
  function extractStamp(html) {
    var m = html.match(/<meta[^>]+name=["']tj-generated["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']tj-generated["']/i);
    return m ? m[1] : null;
  }

  /* Fetch the current page and reload if the stamp has changed. */
  function checkForUpdate() {
    fetch(location.href, { cache: 'no-cache' })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var stamp = extractStamp(text);
        if (stamp && stamp !== initialStamp) {
          if (typeof window._tjSaveView === 'function') { window._tjSaveView(); }
          location.reload();
        }
      })
      .catch(function () {
        /* fetch not supported for this protocol/browser — switch to focus fallback */
        clearInterval(pollInterval);
        function reloadWithSavedView() {
          if (typeof window._tjSaveView === 'function') { window._tjSaveView(); }
          location.reload();
        }
        window.addEventListener('focus', reloadWithSavedView);
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) { reloadWithSavedView(); }
        });
      });
  }

  var pollInterval = setInterval(checkForUpdate, POLL_MS);
})();
