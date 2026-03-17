/* tjgantt.js — D3 v7 interactive Gantt chart for TaskJuggler jstaskreport
 * Reads window.tjGanttData and renders an interactive Gantt chart into
 * #tj-gantt-container.
 *
 * Visual vocabulary matches the static taskreport output (GanttChart.rb etc.)
 * Saleae Logic-style scroll-wheel zoom: the date under the cursor stays fixed.
 */
(function () {
  'use strict';

  /* ── Constants matching Ruby GanttTaskBar/Container/Milestone sizes ── */
  var BAR_HALF   = 6;   // GanttTaskBar @@size
  var CONT_HALF  = 5;   // GanttContainer @@size
  var MS_HALF    = 6;   // GanttMilestone @@size
  var MIN_START_GAP = 5;
  var MIN_END_GAP   = 10;

  /* ── Colors from tjreport.css ── */
  var C = {
    taskbarFrame : '#09090a',
    taskbar      : '#2f57ea',
    progressbar  : '#36363f',
    container    : '#09090a',
    milestone    : '#09090a',
    depline      : '#000000',
    nowline      : '#EE0000',
    offduty      : '#bdbdaa',
    rowEven      : '#ebf2ff',
    rowOdd       : '#d9dfeb',
    headerBg     : '#7a7a7a',
    headerFg     : '#ffffff',
    gridLine     : 'rgba(0,0,0,0.15)'
  };

  /* ── Layout ── */
  var ROW_H      = 20;   // pixels per task row
  var HDR_H      = 40;   // two-row header height (20px each)
  var LEFT_W     = 380;  // left panel width
  var COL_WIDTHS = [30, 180, 85, 85]; // WBS, Name, Start, End
  var COL_NAMES  = ['WBS', 'Name', 'Start', 'End'];

  /* ───────────────────────── Bootstrap ───────────────────────────────── */
  var data = window.tjGanttData;
  if (!data || !data.tasks || !data.tasks.length) {
    return;
  }

  var container = document.getElementById('tj-gantt-container');
  if (!container) { return; }
  /* Clear the placeholder text */
  container.innerHTML = '';

  var tasks     = data.tasks;
  var project   = data.project;
  var scenarios = project.scenarios || [];
  var sc0       = scenarios[0] || 'plan';

  /* ── Compute per-task display info ── */
  tasks.forEach(function (t) {
    var sc = t.scenarios[sc0] || {};
    t._start = sc.start ? new Date(sc.start) : null;
    t._end   = sc.end   ? new Date(sc.end)   : null;
    t._complete   = sc.complete   != null ? sc.complete   : 0;
    t._milestone  = !!sc.milestone;
    t._isContainer = !!t.isContainer;
  });

  var projectStart = project.start ? new Date(project.start) : (tasks[0] && tasks[0]._start) || new Date();
  var projectEnd   = project.end   ? new Date(project.end)   : new Date(projectStart.getTime() + 86400000 * 30);
  var nowDate      = new Date(project.now || Date.now());

  var nTasks   = tasks.length;
  var chartH   = nTasks * ROW_H;
  var svgH     = chartH + HDR_H;

  /* ───────────────────────── DOM Structure ───────────────────────────── */
  /*
   * Outer flex wrapper
   *   ├── leftPanel  (HTML table, overflow-y scroll)
   *   └── rightPanel (SVG, overflow-y scroll / overflow-x hidden)
   */
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;width:100%;height:600px;overflow:hidden;' +
                          'font-family:sans-serif;font-size:11px;border:1px solid #9a9a9a;';
  container.appendChild(wrapper);

  /* ── Left panel ── */
  var leftPanel = document.createElement('div');
  leftPanel.style.cssText = 'width:' + LEFT_W + 'px;min-width:' + LEFT_W + 'px;' +
    'overflow-y:scroll;overflow-x:hidden;border-right:2px solid #7a7a7a;flex-shrink:0;';
  wrapper.appendChild(leftPanel);

  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;';
  leftPanel.appendChild(table);

  /* Header row */
  var thead = document.createElement('thead');
  table.appendChild(thead);
  var hrow = document.createElement('tr');
  hrow.style.cssText = 'position:sticky;top:0;z-index:10;background:' + C.headerBg + ';color:' + C.headerFg + ';';
  thead.appendChild(hrow);
  COL_NAMES.forEach(function (name, i) {
    var th = document.createElement('th');
    th.textContent = name;
    th.style.cssText = 'padding:2px 4px;text-align:left;width:' + COL_WIDTHS[i] + 'px;' +
      'height:' + HDR_H + 'px;border-bottom:1px solid #555;white-space:nowrap;overflow:hidden;';
    hrow.appendChild(th);
  });

  /* Task rows */
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tasks.forEach(function (t, i) {
    var sc = t.scenarios[sc0] || {};
    var tr = document.createElement('tr');
    var bg = (i % 2 === 0) ? C.rowEven : C.rowOdd;
    tr.style.cssText = 'background:' + bg + ';height:' + ROW_H + 'px;';

    var cells = [
      t.wbs || '',
      (t._isContainer ? '▸ ' : (t._milestone ? '◆ ' : '  ')) +
        '\u00a0'.repeat(Math.max(0, (t.level - 1) * 2)) + (t.name || ''),
      sc.start || '',
      sc.end   || ''
    ];
    cells.forEach(function (text, ci) {
      var td = document.createElement('td');
      td.textContent = text;
      td.title = text;
      td.style.cssText = 'padding:1px 4px;overflow:hidden;white-space:nowrap;' +
        'width:' + COL_WIDTHS[ci] + 'px;border-bottom:1px solid #ccc;';
      if (ci === 1 && t._isContainer) { td.style.fontWeight = 'bold'; }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  /* ── Right panel ── */
  var rightPanel = document.createElement('div');
  rightPanel.style.cssText = 'flex:1;overflow-y:scroll;overflow-x:hidden;position:relative;';
  wrapper.appendChild(rightPanel);

  /* Measure available width after mount (approximate until we can read it) */
  var chartW = 0; /* set after appending to DOM */

  /* ── Build SVG ── */
  var svgNS = 'http://www.w3.org/2000/svg';

  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', svgH);
  svg.style.cssText = 'display:block;';
  rightPanel.appendChild(svg);

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

  /* Layer groups */
  function makeG(cls, parent) {
    var g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', cls);
    (parent || svg).appendChild(g);
    return g;
  }

  var gHeader    = makeG('tj-header');
  var gHeaderLg  = makeG('tj-header-large',  gHeader);
  var gHeaderSm  = makeG('tj-header-small',  gHeader);
  var gBody      = makeG('tj-body');
  gBody.setAttribute('transform', 'translate(0,' + HDR_H + ')');
  var gStripes   = makeG('tj-stripes',    gBody);
  var gGrid      = makeG('tj-grid',       gBody);
  var gNow       = makeG('tj-now',        gBody);
  var gBars      = makeG('tj-bars',       gBody);
  var gArrows    = makeG('tj-arrows',     gBody);

  /* ── D3 scales and zoom ── */
  function getChartWidth() {
    return Math.max(200, rightPanel.getBoundingClientRect().width || 800);
  }

  chartW = getChartWidth();

  var baseXScale = d3.scaleTime()
    .domain([projectStart, projectEnd])
    .range([0, chartW]);

  var currentXScale = baseXScale.copy();

  /* ── Zoom ── */
  var zoom = d3.zoom()
    .scaleExtent([0.02, 500])
    .on('zoom', function (event) {
      /* X-only zoom: ignore y component */
      var t = event.transform;
      var xt = d3.zoomIdentity.translate(t.x, 0).scale(t.k);
      currentXScale = xt.rescaleX(baseXScale);
      render(currentXScale);
    });

  d3.select(svg).call(zoom);

  /* Prevent default scroll behavior on the SVG so wheel events zoom */
  svg.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });

  /* ── Synchronise vertical scroll ── */
  var _scrollLock = false;
  leftPanel.addEventListener('scroll', function () {
    if (_scrollLock) { return; }
    _scrollLock = true;
    rightPanel.scrollTop = leftPanel.scrollTop;
    _scrollLock = false;
  });
  rightPanel.addEventListener('scroll', function () {
    if (_scrollLock) { return; }
    _scrollLock = true;
    leftPanel.scrollTop = rightPanel.scrollTop;
    _scrollLock = false;
  });

  /* ─────────────────────────── Render ──────────────────────────────── */
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

  /* Adaptive tick configuration based on pixels-per-day */
  function tickConfig(xScale) {
    var domainMs   = xScale.domain()[1] - xScale.domain()[0];
    var rangeW     = xScale.range()[1] - xScale.range()[0];
    var pxPerDay   = rangeW / (domainMs / 86400000);

    if (pxPerDay < 0.2) {
      return { large: d3.timeYear.every(10),  largeFmt: d3.timeFormat('%Y'),
               small: d3.timeYear.every(1),   smallFmt: d3.timeFormat('%Y') };
    } else if (pxPerDay < 2) {
      return { large: d3.timeYear.every(1),   largeFmt: d3.timeFormat('%Y'),
               small: d3.timeMonth.every(3),  smallFmt: d3.timeFormat('%b') };
    } else if (pxPerDay < 15) {
      return { large: d3.timeMonth.every(1),  largeFmt: d3.timeFormat('%b %Y'),
               small: d3.timeMonday.every(1), smallFmt: d3.timeFormat('W%W') };
    } else if (pxPerDay < 60) {
      return { large: d3.timeMonday.every(1), largeFmt: d3.timeFormat('W%W %b'),
               small: d3.timeDay.every(1),    smallFmt: d3.timeFormat('%d') };
    } else {
      return { large: d3.timeDay.every(1),    largeFmt: d3.timeFormat('%a %d %b'),
               small: d3.timeHour.every(6),   smallFmt: d3.timeFormat('%H:%M') };
    }
  }

  function renderHeader(xScale) {
    clearG(gHeaderLg);
    clearG(gHeaderSm);

    var cfg = tickConfig(xScale);
    var w   = getChartWidth();

    /* Background bar */
    svgEl('rect', gHeader, { x: 0, y: 0, width: w, height: HDR_H, fill: C.headerBg });

    var rowH = HDR_H / 2; /* 20px per header row */

    /* Large ticks (top row) */
    var lgTicks = xScale.ticks(cfg.large);
    lgTicks.forEach(function (d, i) {
      var x0 = xScale(d);
      var x1 = (i + 1 < lgTicks.length) ? xScale(lgTicks[i + 1]) : w;
      if (x1 < 0 || x0 > w) { return; }
      /* Cell border */
      svgEl('line', gHeaderLg, { x1: x0, y1: 0, x2: x0, y2: rowH, stroke: '#555', 'stroke-width': 1 });
      /* Label — clip to cell */
      var labelX = Math.max(x0 + 3, 2);
      var availW = x1 - labelX - 2;
      if (availW > 5) {
        var txt = svgEl('text', gHeaderLg, {
          x: labelX, y: rowH - 5,
          fill: C.headerFg, 'font-size': '10px', 'font-family': 'sans-serif'
        });
        txt.textContent = cfg.largeFmt(d);
      }
    });

    /* Small ticks (bottom row) */
    var smTicks = xScale.ticks(cfg.small);
    smTicks.forEach(function (d, i) {
      var x0 = xScale(d);
      var x1 = (i + 1 < smTicks.length) ? xScale(smTicks[i + 1]) : w;
      if (x1 < 0 || x0 > w) { return; }
      svgEl('line', gHeaderSm, { x1: x0, y1: rowH, x2: x0, y2: HDR_H, stroke: '#555', 'stroke-width': 1 });
      var labelX = x0 + 3;
      var availW = x1 - labelX - 2;
      if (availW > 8) {
        var txt2 = svgEl('text', gHeaderSm, {
          x: labelX, y: HDR_H - 4,
          fill: C.headerFg, 'font-size': '10px', 'font-family': 'sans-serif'
        });
        txt2.textContent = cfg.smallFmt(d);
      }
    });

    /* Bottom border of header */
    svgEl('line', gHeader, { x1: 0, y1: HDR_H - 0.5, x2: w, y2: HDR_H - 0.5,
                              stroke: '#444', 'stroke-width': 1 });
  }

  function renderStripes(xScale) {
    clearG(gStripes);
    var w = getChartWidth();
    tasks.forEach(function (t, i) {
      var bg = (i % 2 === 0) ? C.rowEven : C.rowOdd;
      svgEl('rect', gStripes, { x: 0, y: i * ROW_H, width: w, height: ROW_H, fill: bg });
    });
  }

  function renderGrid(xScale) {
    clearG(gGrid);
    var cfg = tickConfig(xScale);
    xScale.ticks(cfg.small).forEach(function (d) {
      var x = xScale(d);
      svgEl('line', gGrid, { x1: x, y1: 0, x2: x, y2: chartH,
                              stroke: C.gridLine, 'stroke-width': 1 });
    });
  }

  function renderNowLine(xScale) {
    clearG(gNow);
    var x = xScale(nowDate);
    if (x >= 0 && x <= getChartWidth()) {
      svgEl('line', gNow, { x1: x, y1: 0, x2: x, y2: chartH,
                             stroke: C.nowline, 'stroke-width': 1 });
    }
  }

  /* ── Task bar rendering ── */
  function renderBars(xScale) {
    clearG(gBars);

    tasks.forEach(function (t, i) {
      if (!t._start || !t._end) { return; }

      var yCenter = i * ROW_H + ROW_H / 2;
      var g = makeG('tj-task', gBars);

      if (t._milestone) {
        renderMilestone(g, xScale, t, yCenter);
      } else if (t._isContainer) {
        renderContainer(g, xScale, t, yCenter);
      } else {
        renderTaskBar(g, xScale, t, yCenter);
      }
    });
  }

  function renderTaskBar(g, xScale, t, yCenter) {
    var x = xScale(t._start);
    var x2 = xScale(t._end);
    var w = Math.max(2, x2 - x);
    var bh = BAR_HALF;

    /* Black border rect */
    svgEl('rect', g, { x: x, y: yCenter - bh, width: w, height: bh * 2,
                       fill: C.taskbarFrame });
    /* Blue fill (1px inset) */
    svgEl('rect', g, { x: x + 1, y: yCenter - bh + 1, width: Math.max(0, w - 2),
                       height: bh * 2 - 2, fill: C.taskbar });
    /* Progress overlay */
    var pct = Math.max(0, Math.min(100, t._complete || 0));
    if (pct > 0) {
      var pw = Math.max(0, (w - 2) * pct / 100);
      svgEl('rect', g, { x: x + 1, y: yCenter - bh / 2,
                         width: pw, height: bh, fill: C.progressbar });
    }
  }

  function renderContainer(g, xScale, t, yCenter) {
    var x = xScale(t._start);
    var x2 = xScale(t._end);
    var w = Math.max(2, x2 - x);
    var s = CONT_HALF;

    /*
     * Container shape: flat bar with downward-pointing triangular jags at
     * each end, matching GanttContainer jagToHTML geometry.
     *
     *   x-s        x       x+w     x+w+s
     *    |<-- s -->|<-- w -->|<-- s -->|
     *
     * Top of bar at yCenter - s, bottom at yCenter.
     * Jag points down to yCenter + s.
     *
     * Path (clockwise):
     *   Start at top-left of bar: (x-s, yCenter-s)
     *   → right to top-right:     (x+w+s, yCenter-s)
     *   ↓ down to yCenter:        (x+w+s, yCenter)
     *   ↙ jag point right:        (x+w, yCenter+s)
     *   ↑ back up to yCenter:     (x+w, yCenter)   [close right jag]
     *   ← left to start of right jag: (x, yCenter)
     *   ↙ jag point left:         (x-0, yCenter+s)  [left jag tip]  -- actually at x
     *   Wait, let me think about the jag shapes more carefully.
     *
     * GanttContainer draws:
     *   - a rect from (xStart-s, yCenter-s) width (w+2s) height s  (the bar)
     *   - jagToHTML(xStart, yCenter): a downward pointing triangle at xStart
     *   - jagToHTML(xStart+width, yCenter): same at right edge
     *
     * The jag is a downward triangle: top-left=(x-s, y), top-right=(x, y), tip=(x-s/2+...).
     * Looking at HTMLGraphics#jagToHTML: it draws a triangle using CSS borders.
     * The triangle points down, centered at x, top at yCenter, tip at yCenter+s.
     * Left edge of triangle at x-s, right edge at x.  Actually the CSS triangle
     * technique means: border-left: s px solid transparent,
     *                  border-right: s px solid transparent,
     *                  border-top: s px solid #09090a
     * → triangle pointing down, width=2s, height=s, centered at x (left=x-s, right=x+s)
     *
     * But from GanttContainer: jagToHTML(xStart, yCenter) and jagToHTML(xStart+width, yCenter)
     * So jags centered at xStart and xStart+width respectively.
     * Each jag: top-left=(cx-s, yCenter), top-right=(cx+s, yCenter), tip=(cx, yCenter+s)
     *
     * Combined SVG path:
     *   Bar rect: (x-s, yCenter-s) → (x+w+s, yCenter-s) → (x+w+s, yCenter) → (x-s, yCenter) → close
     *   Left jag:  triangle (x-s, yCenter) (x+s, yCenter) (x, yCenter+s)
     *   Right jag: triangle (x+w-s, yCenter) (x+w+s, yCenter) (x+w, yCenter+s)
     *
     * Draw as one path for simplicity.
     */
    var top  = yCenter - s;
    var mid  = yCenter;
    var tip  = yCenter + s;

    /* Bar rectangle */
    svgEl('rect', g, {
      x: x - s, y: top,
      width: w + 2 * s, height: s,
      fill: C.container
    });

    /* Left jag (downward triangle, centered at x) */
    var ljag = (x - s) + ',' + mid + ' ' + (x + s) + ',' + mid + ' ' + x + ',' + tip;
    svgEl('polygon', g, { points: ljag, fill: C.container });

    /* Right jag (downward triangle, centered at x+w) */
    var rjag = (x + w - s) + ',' + mid + ' ' + (x + w + s) + ',' + mid + ' ' + (x + w) + ',' + tip;
    svgEl('polygon', g, { points: rjag, fill: C.container });
  }

  function renderMilestone(g, xScale, t, yCenter) {
    /* Diamond centered on start date */
    var cx = xScale(t._start);
    var r  = MS_HALF;
    var pts = cx + ',' + (yCenter - r) + ' ' +
              (cx + r) + ',' + yCenter + ' ' +
              cx + ',' + (yCenter + r) + ' ' +
              (cx - r) + ',' + yCenter;
    svgEl('polygon', g, { points: pts, fill: C.milestone });
  }

  /* ── Dependency arrows ── */
  function renderArrows(xScale) {
    clearG(gArrows);

    /* Build index: taskId → { task, rowIndex } */
    var taskIdx = {};
    tasks.forEach(function (t, i) { taskIdx[t.id] = { task: t, row: i }; });

    tasks.forEach(function (t, i) {
      if (!t.depends || !t.depends.length) { return; }
      t.depends.forEach(function (dep) {
        var depSc = dep.scenario || sc0;
        if (depSc !== sc0) { return; }
        var predInfo = taskIdx[dep.id];
        if (!predInfo) { return; }
        var pred = predInfo.task;
        if (!pred._end || !t._start) { return; }

        var predRow  = predInfo.row;
        var succRow  = i;
        var startX   = xScale(pred._end);
        var startY   = predRow * ROW_H + ROW_H / 2;
        var endX     = xScale(t._start);
        var endY     = succRow * ROW_H + ROW_H / 2;

        drawArrow(startX, startY, endX, endY);
      });
    });

    function drawArrow(sx, sy, ex, ey) {
      /* Finish-to-start routing matching GanttRouter logic:
       *   exit right from pred end → step right (minStartGap) →
       *   step vertically to target row → enter left from (ex - minEndGap)
       */
      var x1 = sx + MIN_START_GAP;
      var x2 = ex - MIN_END_GAP;
      var pathStr;

      if (x1 < x2) {
        /* Direct route */
        var xMid = x1 + (x2 - x1) / 2;
        pathStr = 'M' + sx + ',' + sy +
                  ' H' + xMid +
                  ' V' + ey +
                  ' H' + ex;
      } else {
        /* Wrap-around: go right from sx, down/up, come back left to ex */
        var xOut = Math.max(sx + MIN_START_GAP, ex + MIN_END_GAP + 2);
        pathStr = 'M' + sx + ',' + sy +
                  ' H' + xOut +
                  ' V' + ey +
                  ' H' + ex;
      }

      var path = svgEl('path', gArrows, {
        d: pathStr,
        fill: 'none',
        stroke: C.depline,
        'stroke-width': 1,
        'marker-end': 'url(#tjArrow)'
      });
    }
  }

  /* ── Main render function ── */
  function render(xScale) {
    /* Update SVG width to match available space */
    var w = getChartWidth();
    svg.setAttribute('width', w);

    renderHeader(xScale);
    renderStripes(xScale);
    renderGrid(xScale);
    renderNowLine(xScale);
    renderBars(xScale);
    renderArrows(xScale);
  }

  /* Initial render */
  render(currentXScale);

  /* Re-render on window resize */
  window.addEventListener('resize', function () {
    chartW = getChartWidth();
    baseXScale.range([0, chartW]);
    render(currentXScale);
  });

})();
