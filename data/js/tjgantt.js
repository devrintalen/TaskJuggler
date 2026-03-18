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
  var BAR_HALF      = 6;   // GanttTaskBar @@size
  var CONT_HALF     = 5;   // GanttContainer @@size
  var MS_HALF       = 6;   // GanttMilestone @@size
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
    headerBorder : '#9a9a9a',
    gridLine     : 'rgba(0,0,0,0.15)'
  };

  /* ── Layout ── */
  var ROW_H    = 20;   // pixels per task row
  var HDR_H    = 40;   // two-row header height (20px each)
  var DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function fmtDate(s) {
    if (!s) { return ''; }
    var p = s.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return DAY_ABBR[d.getDay()] + ' ' + s;
  }


  /* ───────────────────────── Bootstrap ───────────────────────────────── */
  var data = window.tjGanttData;
  if (!data || !data.tasks || !data.tasks.length) { return; }

  var container = document.getElementById('tj-gantt-container');
  if (!container) { return; }
  container.innerHTML = '';

  var tasks    = data.tasks;
  var project  = data.project;
  var sc0      = (project.scenarios || [])[0] || 'plan';
  var iconBase = project.iconBase || null;   // e.g. "icons/" or null

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

  /* ── Per-task display info ── */
  tasks.forEach(function (t) {
    var sc = t.scenarios[sc0] || {};
    t._start       = sc.start ? new Date(sc.start) : null;
    t._end         = sc.end   ? new Date(sc.end)   : null;
    t._complete    = (sc.complete != null) ? sc.complete : 0;
    t._milestone   = !!sc.milestone;
    t._isContainer = !!t.isContainer;
  });


  var projectStart = project.start ? new Date(project.start) : (tasks[0] && tasks[0]._start) || new Date();
  var projectEnd   = project.end   ? new Date(project.end)   : new Date(projectStart.getTime() + 86400000 * 30);
  var nowDate      = project.now   ? new Date(project.now)   : new Date();

  var chartH = tasks.length * ROW_H;
  var svgH   = chartH + HDR_H;

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

  /* Task rows */
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tasks.forEach(function (t, i) {
    var sc  = t.scenarios[sc0] || {};
    var tr  = document.createElement('tr');
    var bg  = (i % 2 === 0) ? C.rowEven : C.rowOdd;
    tr.style.cssText = 'background:' + bg + ';height:' + ROW_H + 'px;' +
                       (t._isContainer ? 'font-weight:bold;' : '');

    cols.forEach(function (col) {
      var td   = document.createElement('td');
      td.style.cssText =
        'padding:1px 4px;text-align:' + col.align + ';border:1px solid #9a9a9a;';

      if (col.id === 'name') {
        /* Icon + indented name — flex row so icon and text stay side-by-side */
        var nameDiv = document.createElement('div');
        nameDiv.style.cssText =
          'display:flex;align-items:center;overflow:hidden;white-space:nowrap;';
        if (iconBase) {
          var img = document.createElement('img');
          img.src = iconBase + (t._isContainer ? 'taskgroup' : 'task') + '.png';
          img.style.cssText = 'flex-shrink:0;margin-right:3px;';
          nameDiv.appendChild(img);
        }
        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'overflow:hidden;white-space:nowrap;';
        nameSpan.textContent =
          '\u00a0'.repeat(Math.max(0, (t.level - 1) * 2)) + (t.name || '');
        nameDiv.appendChild(nameSpan);
        td.appendChild(nameDiv);
      } else {
        var text = '';
        if      (col.id === 'bsi')     { text = t.wbs || ''; }
        else if (col.id === 'start')   { text = fmtDate(sc.start); }
        else if (col.id === 'end')     { text = fmtDate(sc.end);   }
        else if (col.id === 'effort')  { text = sc.effort  || ''; }
        else if (col.id === 'cost')    { text = sc.cost    || ''; }
        else if (col.id === 'revenue') { text = sc.revenue || ''; }
        td.textContent = text;
        td.title       = text;
      }

      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  /* ── Right panel ── */
  var rightPanel = document.createElement('div');
  rightPanel.style.cssText = 'flex:1;overflow-y:scroll;overflow-x:hidden;position:relative;';
  wrapper.appendChild(rightPanel);

  /* ── SVG ── */
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

  /* ── Layer groups ── */
  function makeG(cls, parent) {
    var g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', cls);
    (parent || svg).appendChild(g);
    return g;
  }

  /* Header: background group FIRST so it renders beneath the tick labels */
  var gHeader   = makeG('tj-header');
  var gHeaderBg = makeG('tj-header-bg',    gHeader);
  var gHeaderLg = makeG('tj-header-large', gHeader);
  var gHeaderSm = makeG('tj-header-small', gHeader);

  var gBody    = makeG('tj-body');
  gBody.setAttribute('transform', 'translate(0,' + HDR_H + ')');
  var gStripes = makeG('tj-stripes', gBody);
  var gTimeOff = makeG('tj-timeoff', gBody);
  var gBars    = makeG('tj-bars',    gBody);
  var gArrows  = makeG('tj-arrows',  gBody);
  var gNow     = makeG('tj-now',     gBody);
  var gGrid    = makeG('tj-grid',    gBody);

  /* ── D3 scale and zoom ── */
  function getChartWidth() {
    return Math.max(200, rightPanel.getBoundingClientRect().width || 800);
  }

  var baseXScale = d3.scaleTime()
    .domain([projectStart, projectEnd])
    .range([0, getChartWidth()]);

  var currentXScale = baseXScale.copy();

  var zoom = d3.zoom()
    .scaleExtent([0.02, 500])
    .on('zoom', function (event) {
      var t  = event.transform;
      var xt = d3.zoomIdentity.translate(t.x, 0).scale(t.k);
      currentXScale = xt.rescaleX(baseXScale);
      render(currentXScale);
    });

  d3.select(svg).call(zoom);
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

  /* Adaptive tick configuration based on pixels-per-day.
   * Small-tick label at week scale uses the day-of-month of the Monday
   * (matching the static taskreport header).                              */
  function tickConfig(xScale) {
    var domainMs = xScale.domain()[1] - xScale.domain()[0];
    var rangeW   = xScale.range()[1]  - xScale.range()[0];
    var ppd      = rangeW / (domainMs / 86400000);

    if (ppd < 0.2) {
      return { large: d3.timeYear.every(10),  largeFmt: d3.timeFormat('%Y'),
               small: d3.timeYear.every(1),   smallFmt: d3.timeFormat('%Y') };
    } else if (ppd < 2) {
      return { large: d3.timeYear.every(1),   largeFmt: d3.timeFormat('%Y'),
               small: d3.timeMonth.every(3),  smallFmt: d3.timeFormat('%b') };
    } else if (ppd < 15) {
      return { large: d3.timeMonth.every(1),  largeFmt: d3.timeFormat('%b %Y'),
               small: d3.timeMonday.every(1), smallFmt: d3.timeFormat('%d') };
    } else if (ppd < 60) {
      return { large: d3.timeMonday.every(1), largeFmt: d3.timeFormat('%b %d'),
               small: d3.timeDay.every(1),    smallFmt: d3.timeFormat('%d') };
    } else {
      return { large: d3.timeDay.every(1),    largeFmt: d3.timeFormat('%a %d %b'),
               small: d3.timeHour.every(6),   smallFmt: d3.timeFormat('%H:%M') };
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
    var lgTicks = xScale.ticks(cfg.large);
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
    var smTicks = xScale.ticks(cfg.small);
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
  function renderStripes(xScale) {
    clearG(gStripes);
    var w = getChartWidth();
    tasks.forEach(function (t, i) {
      svgEl('rect', gStripes, {
        x: 0, y: i * ROW_H, width: w, height: ROW_H,
        fill: (i % 2 === 0) ? C.rowEven : C.rowOdd
      });
      svgEl('line', gStripes, {
        x1: 0, y1: (i + 1) * ROW_H - 0.5, x2: w, y2: (i + 1) * ROW_H - 0.5,
        stroke: C.headerBorder, 'stroke-width': 1
      });
    });
  }

  /* ── Off-duty zones (weekends / holidays per task) ── */
  function renderTimeOff(xScale) {
    clearG(gTimeOff);
    tasks.forEach(function (t, i) {
      var zones = (t.scenarios[sc0] || {}).timeoff || [];
      zones.forEach(function (zone) {
        var x0 = xScale(new Date(zone[0]));
        var x1 = xScale(new Date(zone[1]));
        if (x1 <= 0 || x0 >= getChartWidth()) { return; }
        svgEl('rect', gTimeOff, {
          x: x0, y: i * ROW_H, width: x1 - x0, height: ROW_H,
          fill: C.offduty
        });
      });
    });
  }

  /* ── Grid lines ── */
  function renderGrid(xScale) {
    clearG(gGrid);
    var cfg = tickConfig(xScale);
    xScale.ticks(cfg.small).forEach(function (d) {
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

  /* ── Task bars ── */
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
    var x  = xScale(t._start);
    var x2 = xScale(t._end);
    var w  = Math.max(2, x2 - x);
    var bh = BAR_HALF;

    svgEl('rect', g, { x: x, y: yCenter - bh, width: w, height: bh * 2,
                       fill: C.taskbarFrame });
    svgEl('rect', g, { x: x + 1, y: yCenter - bh + 1,
                       width: Math.max(0, w - 2), height: bh * 2 - 2,
                       fill: C.taskbar });
    var pct = Math.max(0, Math.min(100, t._complete || 0));
    if (pct > 0) {
      svgEl('rect', g, { x: x + 1, y: yCenter - bh / 2,
                         width: Math.max(0, (w - 2) * pct / 100),
                         height: bh, fill: C.progressbar });
    }
  }

  function renderContainer(g, xScale, t, yCenter) {
    var x   = xScale(t._start);
    var x2  = xScale(t._end);
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

  function renderMilestone(g, xScale, t, yCenter) {
    var cx = xScale(t._start);
    var r  = MS_HALF;
    svgEl('polygon', g, {
      points: cx+','+(yCenter-r)+' '+(cx+r)+','+yCenter+' '+
              cx+','+(yCenter+r)+' '+(cx-r)+','+yCenter,
      fill: C.milestone
    });
  }

  /* ── Dependency arrows ── */
  function renderArrows(xScale) {
    clearG(gArrows);

    var taskIdx = {};
    tasks.forEach(function (t, i) { taskIdx[t.id] = { task: t, row: i }; });

    tasks.forEach(function (t, i) {
      if (!t.depends || !t.depends.length) { return; }
      t.depends.forEach(function (dep) {
        if ((dep.scenario || sc0) !== sc0) { return; }
        var predInfo = taskIdx[dep.id];
        if (!predInfo) { return; }
        var pred = predInfo.task;
        if (!pred._end || !t._start) { return; }

        /* Skip inherited dependencies: if t's parent is visible and also
         * depends on this same predecessor, the arrow is already represented
         * by the parent's arrow (matches GanttChart#generateTaskDepLines). */
        if (t.parent) {
          var parentInfo = taskIdx[t.parent];
          if (parentInfo && parentInfo.task.depends && parentInfo.task.depends.some(function (pd) {
            return pd.id === dep.id && (pd.scenario || sc0) === sc0;
          })) { return; }
        }

        var sx = xScale(pred._end);
        var sy = predInfo.row * ROW_H + ROW_H / 2;
        var ex = xScale(t._start);
        var ey = i * ROW_H + ROW_H / 2;

        var x1 = sx + MIN_START_GAP;
        var x2 = ex - MIN_END_GAP;
        var pathStr;
        if (x1 < x2) {
          /* Strategy 1: direct 3-segment path (matches GanttRouter strategy 1) */
          var xSeg = x1 + (x2 - x1) / 2;
          pathStr = 'M'+sx+','+sy+' H'+xSeg+' V'+ey+' H'+ex;
        } else {
          /* Strategy 2: complex U-shape (matches GanttRouter strategy 2)
           * sx,sy → x1,sy → x1,ySeg → x2,ySeg → x2,ey → ex,ey  */
          var deltaY = sy < ey ? 1 : -1;
          var ySeg   = sy + 8 * deltaY;
          var pts    = [[sx, sy], [x1, sy]];
          if (x1 !== x2) {
            pts.push([x1, ySeg], [x2, ySeg]);
          }
          pts.push([x2, ey], [ex, ey]);
          pathStr = pts.map(function (p, i) {
            return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
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
    var w = getChartWidth();
    svg.setAttribute('width', w);
    renderHeader(xScale);
    renderStripes(xScale);
    renderTimeOff(xScale);
    renderGrid(xScale);
    renderNowLine(xScale);
    renderBars(xScale);
    renderArrows(xScale);
  }

  render(currentXScale);

  window.addEventListener('resize', function () {
    baseXScale.range([0, getChartWidth()]);
    render(currentXScale);
  });

})();
