/* tjgantt.js — D3 v7 interactive Gantt chart for TaskJuggler jstaskreport
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
  var ROW_H = 20;   // pixels per task or resource row (matches Ruby ReportTableLine)
  var HDR_H = 40;   // two-row header height (20px each)
  var wdayFmt = null;  // initialised after projectTz is known (below)

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

  var rows     = data.rows;
  var project  = data.project;
  var sc0      = (project.scenarios || [])[0] || 'plan';
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


  var projectStart = project.start ? projectMidnight(project.start) : (rows[0] && rows[0]._start) || new Date();
  var projectEnd   = project.end   ? projectMidnight(project.end)   : new Date(projectStart.getTime() + 86400000 * 30);
  var nowDate      = project.now   ? projectMidnight(project.now)   : new Date();

  /* ── Row height helpers ── */
  /* Returns whether this row is a resource row (not a primary task row). */
  function isResourceRow(row) {
    var rt = row.rowType;
    return rt === 'nested-resource' || rt === 'nested-task' || rt === 'resource';
  }

  /* Background colour for a row, distinguishing task rows (blue) from resource
   * rows (warm peach) to match .taskcell1/2 and .resourcecell1/2 in CSS. */
  function rowBgColor(row, i) {
    if (isResourceRow(row)) {
      return (i % 2 === 0) ? C.resourceRowEven : C.resourceRowOdd;
    }
    return (i % 2 === 0) ? C.rowEven : C.rowOdd;
  }

  function rowVisualHeight(row) {
    return ROW_H * ((row.rowSpan || 1));
  }

  /* Compute array of cumulative Y offsets (one per row, plus total at end). */
  function buildYOffsets() {
    var offsets = [];
    var y = 0;
    rows.forEach(function (r) {
      offsets.push(y);
      y += rowVisualHeight(r);
    });
    offsets.push(y);  // sentinel: total chart height
    return offsets;
  }

  var yOffsets = buildYOffsets();
  var chartH   = yOffsets[yOffsets.length - 1];
  var _stripesW = -1;   // cached width for stripe invalidation
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
   * scrollbar sits in the reserved gutter rather than overlapping columns.  */
  leftPanel.style.cssText =
    'overflow-y:scroll;overflow-x:hidden;border-right:2px solid #7a7a7a;flex-shrink:0;' +
    'width:max-content;';
  wrapper.appendChild(leftPanel);

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
	  'height:' + HDR_H + 'px;border-right:1px solid #9a9a9a;border-bottom:1px solid #9a9a9a;' +
      'box-sizing:border-box;background:' + C.headerBg + ';color:' + C.headerFg + ';';
    hrow.appendChild(th);
  });

  /* Data rows */
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);

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

    cols.forEach(function (col) {
      var td = document.createElement('td');
      td.style.cssText =
        'padding:1px 4px;text-align:' + col.align + ';border:1px solid #9a9a9a;' +
        'vertical-align:middle;';
      if (span > 1) { td.rowSpan = span; }

      if (col.id === 'name') {
        /* Icon + indented name */
        var nameDiv = document.createElement('div');
        nameDiv.style.cssText =
          'display:flex;align-items:center;overflow:hidden;white-space:nowrap;';
        if (isTask && iconBase) {
          var img = document.createElement('img');
          img.src = iconBase + (row._isContainer ? 'taskgroup' : 'task') + '.png';
          img.style.cssText = 'flex-shrink:0;margin-right:3px;';
          nameDiv.appendChild(img);
        }
        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'overflow:hidden;white-space:nowrap;';
        var indent = Math.max(0, ((row.level || 1) - 1) * 2);
        nameSpan.textContent = '\u00a0'.repeat(indent) + (row.name || '');
        nameDiv.appendChild(nameSpan);
        td.appendChild(nameDiv);
      } else {
        var text = getCellText(row, col, sc);
        td.textContent = text;
        td.title       = text;
      }

      tr.appendChild(td);
    });
    tbody.appendChild(tr);

    /* Extra empty TRs for additional scenario sub-rows (span > 1) */
    for (var s = 1; s < span; s++) {
      var tr2 = document.createElement('tr');
      tr2.style.cssText = 'background:' + bg + ';height:' + ROW_H + 'px;';
      tbody.appendChild(tr2);
    }
  });

  /* Return the text for a left-panel cell given the row, column and primary
   * scenario data.  Falls back to row.cols[col.id] for resource rows. */
  function getCellText(row, col, sc) {
    var rowType = row.rowType || 'task';
    var isTask  = rowType === 'task';

    if (isTask) {
      if      (col.id === 'bsi')     { return row.wbs || ''; }
      else if (col.id === 'start')   { return fmtDate(sc.start); }
      else if (col.id === 'end')     { return fmtDate(sc.end);   }
      else if (col.id === 'effort')  { return sc.effort  || ''; }
      else if (col.id === 'cost')    { return sc.cost    || ''; }
      else if (col.id === 'revenue') { return sc.revenue || ''; }
      return '';
    } else {
      /* Resource / nested rows */
      if (col.id === 'no')   { return String(row.no || ''); }
      if (col.id === 'name') { return row.name || ''; }  /* handled above */
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
    'flex-shrink:0;overflow:hidden;height:' + HDR_H + 'px;' +
    'border-bottom:1px solid #7a7a7a;';
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

  /* ── Layer groups ── */
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
  var gBody    = makeG('tj-body');
  var gStripes = makeG('tj-stripes', gBody);
  var gTimeOff = makeG('tj-timeoff', gBody);
  var gBars    = makeG('tj-bars',    gBody);
  var gArrows  = makeG('tj-arrows',  gBody);
  var gNow     = makeG('tj-now',     gBody);
  var gGrid    = makeG('tj-grid',    gBody);

  /* ── D3 scale and zoom ── */
  function getChartWidth() {
    return Math.max(200, rightColumn.getBoundingClientRect().width || 800);
  }

  var baseXScale = d3.scaleUtc()
    .domain([projectStart, projectEnd])
    .range([0, getChartWidth()]);

  /* Apply initialScale from project metadata (e.g. 'week' for weekly column). */
  if (project.initialScale === 'week') {
    var domainMs  = projectEnd.getTime() - projectStart.getTime();
    var weekMs    = 7 * 86400 * 1000;
    var chartW    = getChartWidth();
    /* Scale factor so that one week maps to chartW pixels */
    var scaleFactor = domainMs / weekMs;
    baseXScale = d3.scaleUtc()
      .domain([projectStart, new Date(projectStart.getTime() + weekMs)])
      .range([0, chartW]);
  }

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

  /* ───────────────────────── Render helpers ───────────────────────────── */
  function svgEl(tag, parent, attrs) {
    var el = document.createElementNS(svgNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    }
    if (parent) { parent.appendChild(el); }
    return el;
  }

  function clearG(g) {
    while (g.firstChild) { g.removeChild(g.firstChild); }
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

  function computePpd(xScale) {
    var domainMs = xScale.domain()[1] - xScale.domain()[0];
    var rangeW   = xScale.range()[1]  - xScale.range()[0];
    return rangeW / (domainMs / 86400000);
  }

  /*
   * Returns an LOD descriptor. Fields:
   *   ppd            — pixels per day
   *   bucketDays     — merge this many daily load-stack buckets into one rect
   *   mergeTimeoffPx — coalesce adjacent timeoff zones if pixel gap < this
   *   showArrows     — render dependency arrows at all
   *
   * Thresholds match tickConfig():
   *   level 0: ppd < 0.2  (year scale)
   *   level 1: ppd < 2    (quarter scale)
   *   level 2: ppd < 15   (month scale)
   *   level 3: ppd < 60   (week scale)
   *   level 4: ppd >= 60  (day scale — full detail)
   */
  function computeLod(xScale) {
    var ppd = computePpd(xScale);
    var bucketDays, mergeTimeoffPx, showArrows;

    if      (ppd < 0.2) { bucketDays = 365; mergeTimeoffPx = 4; showArrows = false; }
    else if (ppd < 2)   { bucketDays = 30;  mergeTimeoffPx = 4; showArrows = false; }
    else if (ppd < 15)  { bucketDays = 7;   mergeTimeoffPx = 2; showArrows = true;  }
    else if (ppd < 60)  { bucketDays = 1;   mergeTimeoffPx = 1; showArrows = true;  }
    else                { bucketDays = 1;   mergeTimeoffPx = 0; showArrows = true;  }

    return { ppd: ppd, bucketDays: bucketDays,
             mergeTimeoffPx: mergeTimeoffPx, showArrows: showArrows };
  }

  /* Adaptive tick configuration based on pixels-per-day. */
  function tickConfig(xScale) {
    var ppd = computePpd(xScale);

    if (ppd < 0.2) {
      return { large: d3.utcYear.every(10),  largeFmt: tzFmt({ year: 'numeric' }),
               small: d3.utcYear.every(1),   smallFmt: tzFmt({ year: 'numeric' }) };
    } else if (ppd < 2) {
      return { large: d3.utcYear.every(1),   largeFmt: tzFmt({ year: 'numeric' }),
               small: d3.utcMonth.every(3),  smallFmt: tzFmt({ month: 'short' }) };
    } else if (ppd < 15) {
      return { large: d3.utcMonth.every(1),
               largeFmt: tzFmtParts({ month: 'short', year: 'numeric' }, ['month', 'year']),
               small: d3.utcMonday.every(1), smallFmt: tzFmt({ day: 'numeric' }) };
    } else if (ppd < 60) {
      return { large: d3.utcMonday.every(1),
               largeFmt: tzFmtParts({ month: 'short', day: 'numeric' }, ['month', 'day']),
               small: d3.utcDay.every(1),    smallFmt: tzFmt({ day: 'numeric' }) };
    } else {
      return { large: d3.utcDay.every(1),
               largeFmt: tzFmtParts({ weekday: 'short', day: 'numeric', month: 'short' },
                                    ['weekday', 'day', 'month']),
               small: d3.utcHour.every(6),
               smallFmt: tzFmt({ hour: '2-digit', minute: '2-digit', hour12: false }) };
    }
  }

  /* ── Header ── */
  function renderHeader(xScale) {
    clearG(gHeaderBg);
    clearG(gHeaderLg);
    clearG(gHeaderSm);

    var cfg  = tickConfig(xScale);
    var w    = getChartWidth();
    var rowH = HDR_H / 2;

    /* Background (in gHeaderBg = first child of gHeader) */
    svgEl('rect', gHeaderBg, { x: 0, y: 0, width: w, height: HDR_H, fill: C.headerBg });
    svgEl('line', gHeaderBg, { x1: 0, y1: rowH - 0.5, x2: w, y2: rowH - 0.5,
                                stroke: C.headerBorder, 'stroke-width': 1 });
    svgEl('line', gHeaderBg, { x1: 0, y1: HDR_H - 0.5, x2: w, y2: HDR_H - 0.5,
                                stroke: C.headerBorder, 'stroke-width': 1 });

    /* Large ticks — top row */
    var lgTicks = projectTicks(xScale, cfg.large);
    lgTicks.forEach(function (d, i) {
      var x0 = xScale(d);
      var x1 = (i + 1 < lgTicks.length) ? xScale(lgTicks[i + 1]) : w;
      if (x1 < 0 || x0 > w) { return; }
      svgEl('line', gHeaderLg, { x1: x0, y1: 0, x2: x0, y2: rowH,
                                  stroke: C.headerBorder, 'stroke-width': 1 });
      var lx = Math.max(x0 + 3, 2);
      if (x1 - lx > 5) {
        var txt = svgEl('text', gHeaderLg, {
          x: lx, y: rowH - 5,
          fill: C.headerFg, 'font-size': '10px', 'font-family': 'sans-serif', 'font-weight': 'bold'
        });
        txt.textContent = cfg.largeFmt(d);
      }
    });

    /* Small ticks — bottom row */
    var smTicks = projectTicks(xScale, cfg.small);
    smTicks.forEach(function (d, i) {
      var x0 = xScale(d);
      var x1 = (i + 1 < smTicks.length) ? xScale(smTicks[i + 1]) : w;
      if (x1 < 0 || x0 > w) { return; }
      svgEl('line', gHeaderSm, { x1: x0, y1: rowH, x2: x0, y2: HDR_H,
                                  stroke: C.headerBorder, 'stroke-width': 1 });
      var lx = x0 + 3;
      if (x1 - lx > 4) {
        var txt2 = svgEl('text', gHeaderSm, {
          x: lx, y: HDR_H - 4,
          fill: C.headerFg, 'font-size': '10px', 'font-family': 'sans-serif', 'font-weight': 'bold'
        });
        txt2.textContent = cfg.smallFmt(d);
      }
    });
  }

  /* ── Row stripes ── */
  function renderStripes(xScale, lod) {
    var w = getChartWidth();
    if (w === _stripesW) { return; }
    _stripesW = w;
    clearG(gStripes);
    rows.forEach(function (row, i) {
      var y = yOffsets[i];
      var h = rowVisualHeight(row);
      svgEl('rect', gStripes, { x: 0, y: y, width: w, height: h, fill: rowBgColor(row, i) });
      svgEl('line', gStripes, { x1: 0, y1: y + h - 0.5, x2: w, y2: y + h - 0.5,
                                 stroke: C.headerBorder, 'stroke-width': 1 });
    });
  }

  /* Coalesce adjacent timeoff zones whose pixel gap is < minGapPx.
   * Input zones must be sorted chronologically (as emitted by Ruby). */
  function mergeTimeoffZones(zones, xScale, minGapPx) {
    if (!zones.length || minGapPx <= 0) { return zones; }
    var merged = [];
    var cur    = [zones[0][0], zones[0][1]];
    for (var zi = 1; zi < zones.length; zi++) {
      var next  = zones[zi];
      var gapPx = xScale(new Date(next[0] * 1000)) - xScale(new Date(cur[1] * 1000));
      if (gapPx < minGapPx) { cur[1] = next[1]; }
      else { merged.push(cur); cur = [next[0], next[1]]; }
    }
    merged.push(cur);
    return merged;
  }

  /* ── Off-duty zones (weekends / holidays per task row) ── */
  function renderTimeOff(xScale, lod) {
    clearG(gTimeOff);
    var w = getChartWidth();
    rows.forEach(function (row, i) {
      if ((row.rowType || 'task') !== 'task') { return; }
      var y      = yOffsets[i];
      var h      = rowVisualHeight(row);
      var zones  = ((row.scenarios || {})[sc0] || {}).timeoff || [];
      var merged = mergeTimeoffZones(zones, xScale, lod.mergeTimeoffPx);
      merged.forEach(function (zone) {
        var x0 = xScale(new Date(zone[0] * 1000));
        var x1 = xScale(new Date(zone[1] * 1000));
        if (x1 <= 0 || x0 >= w || x1 - x0 < 0.5) { return; }
        svgEl('rect', gTimeOff, {
          x: x0, y: y, width: x1 - x0, height: h,
          fill: C.offduty
        });
      });
    });
  }

  /* ── Grid lines ── */
  function renderGrid(xScale) {
    clearG(gGrid);
    var cfg = tickConfig(xScale);
    projectTicks(xScale, cfg.small).forEach(function (d) {
      var x = xScale(d);
      svgEl('line', gGrid, { x1: x, y1: 0, x2: x, y2: chartH,
                              stroke: C.gridLine, 'stroke-width': 1 });
    });
  }

  /* ── Now line ── */
  function renderNowLine(xScale) {
    clearG(gNow);
    var x = xScale(nowDate);
    var w = getChartWidth();
    if (x >= 0 && x <= w) {
      svgEl('line', gNow, { x1: x, y1: 0, x2: x, y2: chartH,
                             stroke: C.nowline, 'stroke-width': 1 });
    }
  }

  /* ── Task bars + load stacks ── */
  function renderBars(xScale, lod) {
    clearG(gBars);
    var w = getChartWidth();

    rows.forEach(function (row, i) {
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
          if (bx1 < 0 || bx0 > w) { return; }
          /* Width cull (skip milestones — they are single-point markers) */
          if (!sc.milestone && (bx1 - bx0) < 1) { return; }

          var g = makeG('tj-task', gBars);
          if (sc.milestone) {
            renderMilestone(g, xScale, tStart, yCenter);
          } else if (row._isContainer && s === 0) {
            renderContainer(g, xScale, tStart, tEnd, yCenter);
          } else if (row._isContainer) {
            /* additional scenarios for containers: simple bar */
            renderTaskBar(g, xScale, tStart, tEnd, yCenter, sc.complete || 0);
          } else {
            renderTaskBar(g, xScale, tStart, tEnd, yCenter, sc.complete || 0);
          }
        });
      } else {
        /* Load stack row — render proportional bars for primary scenario */
        renderLoadStack(row, y0, xScale, w, lod);
      }
    });
  }

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

  function renderMilestone(g, xScale, tStart, yCenter) {
    var cx = xScale(tStart);
    var r  = MS_HALF;
    svgEl('polygon', g, {
      points: cx+','+(yCenter-r)+' '+(cx+r)+','+yCenter+' '+
              cx+','+(yCenter+r)+' '+(cx-r)+','+yCenter,
      fill: C.milestone
    });
  }

  /* Merge consecutive groups of n per-day buckets into super-buckets.
   * Values are summed; proportional ratios are preserved.
   * The merged entry carries a _days field for correct pixel-width computation. */
  function mergeBuckets(buckets, n) {
    if (n <= 1 || !buckets.length) { return buckets; }
    var nCats  = buckets[0].length - 1;
    var merged = [];
    var i      = 0;
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
    return merged;
  }

  /* Render proportional load-stack bars for a non-task row, matching the
   * Ruby GanttLoadStack.to_html rendering approach:
   *   1. Draw a dark frame rectangle (loadstackframe) for the whole column.
   *   2. Inside the frame (1px margins), draw category bars in reverse order
   *      (last category → first), so that for ['assigned','busy','free'] the
   *      order from top is: free (green), busy (pink), assigned (red).
   * Each daily bucket maps to one column of stacked rectangles. */
  function renderLoadStack(row, yTop, xScale, chartWidth, lod) {
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
    var visStartS = xScale.invert(0).getTime() / 1000;
    var visEndS   = xScale.invert(chartWidth).getTime() / 1000;

    var buckets = mergeBuckets(ld.buckets, lod.bucketDays);
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
      svgEl('rect', gBars, {
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
        svgEl('rect', gBars, {
          x: x0 + 1, y: yTop + 2 + yUsed,
          width: Math.max(0, bw - 2), height: h,
          fill: loadCatColor[categories[ci]] || '#888'
        });
        yUsed += h;
      }
    }
  }

  /* ── Dependency arrows ── */
  function renderArrows(xScale) {
    clearG(gArrows);

    /* Build index: rowId → { row, rowIndex } for task rows only. */
    var rowIdx = {};
    rows.forEach(function (r, i) {
      if ((r.rowType || 'task') === 'task') {
        rowIdx[r.id] = { row: r, idx: i };
      }
    });

    rows.forEach(function (row, i) {
      if ((row.rowType || 'task') !== 'task') { return; }
      if (!row.depends || !row.depends.length) { return; }
      row.depends.forEach(function (dep) {
        if ((dep.scenario || sc0) !== sc0) { return; }
        var predInfo = rowIdx[dep.id];
        if (!predInfo) { return; }
        var pred = predInfo.row;
        if (!pred._end || !row._start) { return; }

        /* Skip inherited dependencies. */
        if (row.parent) {
          var parentInfo = rowIdx[row.parent];
          if (parentInfo && parentInfo.row.depends && parentInfo.row.depends.some(function (pd) {
            return pd.id === dep.id && (pd.scenario || sc0) === sc0;
          })) { return; }
        }

        var sx = xScale(pred._end);
        var sy = yOffsets[predInfo.idx] + ROW_H / 2;
        var ex = xScale(row._start);
        var ey = yOffsets[i] + ROW_H / 2;

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
      });
    });
  }

  /* ── Main render ── */
  function render(xScale) {
    var lod = computeLod(xScale);
    renderHeader(xScale);
    renderStripes(xScale, lod);
    renderTimeOff(xScale, lod);
    renderGrid(xScale);
    renderNowLine(xScale);
    renderBars(xScale, lod);
    if (lod.showArrows) { renderArrows(xScale); } else { clearG(gArrows); }
  }

  render(currentXScale);

  window.addEventListener('resize', function () {
    _stripesW = -1;   // force stripe redraw on new width
    baseXScale.range([0, getChartWidth()]);
    var t = d3.zoomTransform(svg);
    currentXScale = d3.zoomIdentity.translate(t.x, 0).scale(t.k).rescaleX(baseXScale);
    scheduleRender();
  });

})();
