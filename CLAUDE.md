# TaskJuggler HTML Report Generation

This document describes how the `to_html` generators create the visual image of a task report, including the files involved and the call chains.

## Overview

TaskJuggler supports two HTML output modes for task reports:

- **`:html`** — Static HTML rendered entirely in Ruby, using `<div>` elements with absolute positioning and CSS classes.
- **`:htmljs`** — Interactive HTML that embeds a JSON data payload and JavaScript (D3.js + custom `tjgantt.js`) for client-side rendering with pan/zoom support.

---

## Files Involved

### Core Report Architecture

| File | Role |
|------|------|
| `lib/taskjuggler/reports/Report.rb` | Top-level entry point; orchestrates format selection and HTML document creation |
| `lib/taskjuggler/reports/ReportBase.rb` | Shared base class for all report types |
| `lib/taskjuggler/reports/TaskListRE.rb` | Intermediate representation for task list reports; `to_html` redirects to `to_htmljs` via `htmljs_format?` for the embedded-report path |
| `lib/taskjuggler/reports/ResourceListRE.rb` | Same as TaskListRE but for resource reports |
| `lib/taskjuggler/reports/TableReport.rb` | Mixin/base providing `to_html` and `to_htmljs` for table-based reports |
| `lib/taskjuggler/reports/TextReport.rb` | Layout wrapper for textreports; has no `to_htmljs` — the htmljs redirect happens inside the embedded sub-report chain |
| `lib/taskjuggler/RichText/RTFReport.rb` | Renders an embedded `<[report id="..."]>` reference inside RichText; calls `report.to_html` on the inner Report object |

### Table Rendering

| File | Role |
|------|------|
| `lib/taskjuggler/reports/ReportTable.rb` | Renders the outer `<table>` and coordinates rows |
| `lib/taskjuggler/reports/ReportTableLine.rb` | Renders each `<tr>` row |
| `lib/taskjuggler/reports/ReportTableCell.rb` | Renders each `<td>` cell, including nested tables for Gantt columns |
| `lib/taskjuggler/reports/ReportTableColumn.rb` | Column header definitions |

### Gantt Chart (Static HTML)

| File | Role |
|------|------|
| `lib/taskjuggler/reports/GanttChart.rb` | Top-level Gantt chart container; delegates per-line rendering |
| `lib/taskjuggler/reports/GanttLine.rb` | Renders one Gantt row (time-off zones, grid lines, task bar/milestone) |
| `lib/taskjuggler/reports/GanttTaskBar.rb` | Renders a task bar as positioned `<div>` elements |
| `lib/taskjuggler/reports/GanttMilestone.rb` | Renders a milestone diamond |
| `lib/taskjuggler/reports/GanttContainer.rb` | Renders a container/summary task with jag markers |
| `lib/taskjuggler/reports/GanttLoadStack.rb` | Renders a resource load bar stack |
| `lib/taskjuggler/reports/HTMLGraphics.rb` | Module with primitive drawing helpers (`lineToHTML`, `rectToHTML`, `diamondToHTML`, `arrowHeadToHTML`, `jagToHTML`) |

### HTML/XML Infrastructure

| File | Role |
|------|------|
| `lib/taskjuggler/HTMLDocument.rb` | HTML5 document wrapper (head, body frame) |
| `lib/taskjuggler/HTMLElements.rb` | Metaprogrammed helper classes for HTML tags (TABLE, TD, H1, etc.) |
| `lib/taskjuggler/XMLDocument.rb` | Base tree builder and serializer |

### Static Assets

| File | Role |
|------|------|
| `data/css/tjreport.css` | All CSS for tables, Gantt elements, load stacks, grid lines |
| `data/js/tjgantt.js` | Client-side Gantt renderer (reads `window.tjGanttData`) |
| `data/js/d3.min.js` | D3.js library used by `tjgantt.js` |
| `data/icons/` | PNG icons embedded in report cells |

---

## Call Chain: Static HTML (`:html` format)

```
Project.report.generate(:html)                        # Report.rb:71
  └─ Report#generateIntermediateFormat()              # Report.rb:115
       └─ TaskListRE.new(self)                        # Report.rb:139
            └─ TaskListRE#generateIntermediateFormat  # TaskListRE.rb:36
                 └─ TableReport#generateIntermediateFormat  # TableReport.rb:106
                      # Builds ReportTable with columns, lines, and cells.
                      # Gantt-column cells contain a GanttChart object.

  └─ Report#generateHTML(:html)                       # Report.rb:174
       └─ HTMLDocument.new(...)                       # sets up <html><head><body>
            # Inlines tjreport.css into <style>
       └─ @content.to_html                            # Report.rb:156
            └─ TaskListRE#to_html → super             # TaskListRE.rb:69
                 └─ TableReport#to_html               # TableReport.rb:111
                      └─ ReportTable#to_html          # ReportTable.rb:86
                           # Emits <table><tbody>
                           └─ (per row) ReportTableLine#to_html    # ReportTableLine.rb:77
                                # Emits <tr>
                                └─ (per cell) ReportTableCell#to_html  # ReportTableCell.rb:105
                                     # Emits <td> with indentation, icons, tooltips
                                     # For Gantt column cells:
                                     └─ GanttChart#to_html         # GanttChart.rb:145
                                          └─ (per row) GanttLine#to_html  # GanttLine.rb:69
                                               # Emits time-off zones, grid lines
                                               └─ content#to_html  # dispatches to:
                                                    GanttTaskBar#to_html    # GanttTaskBar.rb:91
                                                    GanttMilestone#to_html  # GanttMilestone.rb:77
                                                    GanttContainer#to_html  # GanttContainer.rb:86
                                                    GanttLoadStack#to_html  # GanttLoadStack.rb:89
                                                    # All use HTMLGraphics primitives:
                                                    #   rectToHTML     HTMLGraphics.rb:50
                                                    #   lineToHTML     HTMLGraphics.rb:26
                                                    #   diamondToHTML  HTMLGraphics.rb:62
                                                    #   arrowHeadToHTML HTMLGraphics.rb:73
                                                    #   jagToHTML      HTMLGraphics.rb:56

       └─ XMLDocument#write()  # serializes element tree to HTML file
```

---

## Call Chain: Interactive HTML (`:htmljs` format)

There are **two dispatch paths** to `TableReport#to_htmljs` depending on how the
report is structured in the project file.

### Path A — Direct report (`taskreport`/`resourcereport` with `formats htmljs`)

`@content` is `TaskListRE`/`ResourceListRE` which inherits `to_htmljs` from
`TableReport`. `Report#generateHTML` detects this via `respond_to?(:to_htmljs)`
and calls it directly.

```
Project.report.generate(:htmljs)                      # Report.rb:71
  └─ Report#generateIntermediateFormat()              # Report.rb:115
       └─ TaskListRE.new(self)   (same as above)

  └─ Report#generateHTML(:htmljs)                     # Report.rb:174
       └─ HTMLDocument.new(...)
       └─ @content.respond_to?(:to_htmljs) → true
            └─ TableReport#to_htmljs                  # TableReport.rb:157
                 (see below)
```

### Path B — Embedded report (`textreport` wrapping a `taskreport`/`resourcereport`)

The typical pattern in the tutorial. `@content` is `TextReport` which has no
`to_htmljs`. `generateHTML` falls back to `@content.to_html`; the redirect
happens later inside `TaskListRE#to_html` via `htmljs_format?`.

```
Project.report.generate(:htmljs)  [outer textreport]  # Report.rb:71
  └─ Report#generateHTML(:htmljs)                      # Report.rb:174
       └─ @content.respond_to?(:to_htmljs) → false (TextReport)
            └─ TextReport#to_html                      # TextReport.rb:65
                 └─ rt_to_html('center')               # ReportBase.rb:143
                      └─ RichTextIntermediate#to_html
                           └─ RTFReport#to_html        # RTFReport.rb:71
                                # pushes inner report's ReportContext
                                └─ Report#to_html      # Report.rb:156  [inner taskreport]
                                     └─ TaskListRE#to_html  # TaskListRE.rb:69
                                          └─ htmljs_format? → true
                                               └─ TableReport#to_htmljs
                                                    (see below)
```

**Why `htmljs_format?` still exists:** `RTFReport#to_html` calls `report.to_html`
on the inner report unconditionally. There is no `to_htmljs` plumbing in the
RichText pipeline, so the redirect must happen at the `TaskListRE` level.
`htmljs_format?` checks `@report.get('formats')` (for a directly-formatted report)
and `reportContexts` (to find a parent textreport with `:htmljs`).

### Common tail: `TableReport#to_htmljs`

```
TableReport#to_htmljs                                 # TableReport.rb:157
  # Builds project_data hash: chart start/end, scenario names, column defs,
  # now date, timezone, initialScale.
  └─ @table.to_htmljs                                 # ReportTable.rb:147
       # Iterates @lines once.
       # Lines with the same (property, scopeProperty) key are duplicate
       # scenario lines — their 'scenarios'/'loadData' hashes are merged
       # and rowSpan is incremented.
       └─ (per line) ReportTableLine#to_htmljs(resource_no)  # ReportTableLine.rb:80
            # Dispatches on property/scope type:
            ├─ Task + no scope      → build_task_row
            ├─ Resource + no scope  → build_resource_row(no)
            ├─ Resource + Task scope → build_nested_resource_row
            └─ Task + Resource scope → build_nested_task_row
            #
            # Each builder:
            #   1. Looks up the GanttChart via gantt_chart helper
            #      (column header's cell1.special where definition.id == 'chart')
            #   2. Calls gantt_chart.line_for(property, scope, scenario_idx)
            #      to get the pre-built GanttLine for this row/scenario.
            #   3. If a GanttLine exists → calls GanttLine#to_htmljs
            #      (fast path: data already computed during generateIntermediateFormat)
            #   4. If no GanttLine (e.g. 'weekly' column report with no 'chart' column)
            #      → falls back to htmljs_load_buckets / htmljs_collect_timeoff
            #      (replicates GanttLine's per-day bucket computation)
            #
            └─ GanttLine#to_htmljs                    # GanttLine.rb:126
                 # Task line → { type:'task', bar:{...}, timeoff:[...] }
                 # Resource/load line → { type:'resource', categories:[...],
                 #                        buckets:[[t,v...]], timeoff:[...] }
                 └─ content#to_htmljs  dispatches to:
                      GanttTaskBar#to_htmljs           # GanttTaskBar.rb:64
                      GanttMilestone#to_htmljs         # GanttMilestone.rb:62
                      GanttContainer#to_htmljs         # GanttContainer.rb:64
                      GanttLoadStack#to_htmljs         # GanttLoadStack.rb:72

  # All to_htmljs methods return Ruby hashes.
  # TableReport serializes the full tree to JSON via htmljs_to_json (no gem dep).
  # JSON embedded as: <script>window.tjGanttData = {...};</script>
  # d3.min.js and tjgantt.js are then inlined.
  # tjgantt.js reads window.tjGanttData and renders the chart with D3.
```

---

## `window.tjGanttData` JSON Schema

```
{
  "project": {
    "start": "YYYY-MM-DD",      # chart period start
    "end":   "YYYY-MM-DD",      # chart period end
    "now":   "YYYY-MM-DD",      # today marker
    "scenarios": ["plan", ...], # list of scenario id strings
    "columns": [                # non-chart, non-weekly columns
      { "id": "name", "title": "Name", "align": "left" }, ...
    ],
    "iconBase": "path/to/icons/",  # null if selfcontained
    "tz": "UTC",
    "tzOffset": 0,
    "initialScale": "week"      # null unless 'weekly' column present
  },
  "rows": [                     # one entry per unique (property, scope) pair
    # Task row
    { "rowType": "task",
      "rowSpan": 2,             # number of scenario lines merged into this row
      "id": "proj.task",        # fullId
      "name": "Task Name",
      "wbs": "1.2",
      "parent": "proj",         # null if top-level
      "level": 2,
      "isContainer": false,
      "scenarios": {
        "plan": {
          "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "duration": 5,
          "complete": 75.0,      # percentage, or null
          "milestone": false,
          "effort": "3.0d", "cost": null, "revenue": null,
          "timeoff": [[t_start_unix, t_end_unix], ...]
        },
        "delayed": { ... }
      },
      "depends": [{ "id": "proj.other", "scenario": "plan" }, ...]
    },

    # Resource row
    { "rowType": "resource",
      "no": 1,                  # sequential resource counter
      "id": "dev",
      "name": "Developer",
      "parent": null,
      "level": 1,
      "isLeaf": true,
      "cols": { "effort": "10d", ... },   # non-chart column values
      "loadData": {
        "plan": {
          "categories": ["busy", "free"],
          "buckets": [[t_unix, busy_val, free_val], ...],
          "timeoff": [[t_start_unix, t_end_unix], ...]
        }
      }
    },

    # Nested-resource row  (resource under a task scope)
    { "rowType": "nested-resource",
      "id": "dev", "name": "Developer",
      "parent": null, "scopeId": "proj.task",
      "level": 1, "isLeaf": true,
      "loadData": {
        "plan": {
          "categories": ["assigned", "busy", "free"],
          "buckets": [[t_unix, assigned, busy, free], ...],
          "timeoff": [...]
        }
      }
    },

    # Nested-task row  (task under a resource scope)
    { "rowType": "nested-task",
      "id": "proj.task", "name": "Task",
      "scopeId": "dev",
      "level": 2, "isLeaf": true,
      "loadData": {
        "plan": {
          "categories": ["busy"],
          "buckets": [[t_unix, busy_val], ...],
          "timeoff": [...]
        }
      }
    }
  ]
}
```

---

## How the Visual Image Is Produced

### Static HTML mode

Gantt chart visuals are produced entirely server-side in Ruby. `HTMLGraphics` methods produce `<div>` elements with inline `style` attributes specifying pixel `left`, `top`, `width`, and `height`, combined with CSS class names defined in `tjreport.css`. The result is a pixel-accurate chart embedded directly in the HTML table.

Key rendering primitives in `HTMLGraphics` (`lib/taskjuggler/reports/HTMLGraphics.rb`):

- **`rectToHTML(x, y, w, h, category)`** (line 50) — Filled rectangle; used for task bars, load segments, off-duty zones.
- **`lineToHTML(xs, ys, xe, ye, category)`** (line 26) — Horizontal or vertical line; used for grid lines and dependency arrows.
- **`diamondToHTML(x, y)`** (line 62) — Milestone diamond; composed of four triangular `<div>` elements using CSS border tricks.
- **`arrowHeadToHTML(x, y)`** (line 73) — Arrowhead for dependency links.
- **`jagToHTML(x, y)`** (line 56) — Jag/notch marker for container task start/end.

### Interactive HTML mode

The Ruby code serializes all task/resource data into a JSON structure (`window.tjGanttData`) embedded in a `<script>` tag. The `tjgantt.js` file (820 lines, using D3.js) reads this data and renders an interactive SVG/Canvas Gantt chart with zoom and pan support.

---

## CSS Styling

`data/css/tjreport.css` (493 lines) provides all visual styling:

- `.tj_table`, `.tj_table_cell`, `.tj_table_header_cell` — Table structure
- `.tj_gantt_jag`, `.tj_diamond_top`, `.tj_arrow_head` — Gantt shape elements
- `.nowline` — The "current date" vertical indicator
- `.offduty` — Off-duty/time-off shading
- `.loadstackframe`, `.assigned`, `.busy`, `.free` — Resource load colors
- `.taskcell1`, `.taskcell2`, `.resourcecell1`, `.resourcecell2` — Alternating row colors
- `.tabvline` — Vertical grid lines
