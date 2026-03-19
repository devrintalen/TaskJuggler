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
| `lib/taskjuggler/reports/TaskListRE.rb` | Intermediate representation for task list reports |
| `lib/taskjuggler/reports/TableReport.rb` | Mixin/base providing `to_html` and `to_htmljs` for table-based reports |

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

  └─ Report#generateHTML()                            # Report.rb:174
       └─ HTMLDocument.new(...)                       # sets up <html><head><body>
            # Inlines tjreport.css into <style>
       └─ Report#to_html                              # Report.rb:156
            └─ TaskListRE#to_html                     # TaskListRE.rb:69
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

```
Project.report.generate(:htmljs)                      # Report.rb:71
  └─ Report#generateIntermediateFormat()              # Report.rb:115
       └─ TaskListRE.new(self)   (same as above)

  └─ Report#generateHTML()                            # Report.rb:174
       └─ HTMLDocument.new(...)
       └─ TaskListRE#to_html                          # TaskListRE.rb:69
            # Detects htmljs_format? → calls to_htmljs path
            └─ TableReport#to_htmljs                  # TableReport.rb:157
                 # Builds JSON: project settings, scenarios, column defs, row data
                 └─ (per row) GanttLine#to_htmljs     # GanttLine.rb:126
                       └─ content#to_htmljs  dispatches to:
                            GanttTaskBar#to_htmljs    # GanttTaskBar.rb:64
                            GanttMilestone#to_htmljs  # GanttMilestone.rb:62
                            GanttContainer#to_htmljs  # GanttContainer.rb:64
                            GanttLoadStack#to_htmljs  # GanttLoadStack.rb:72
                 # All to_htmljs methods return Ruby hashes → serialized to JSON
                 # JSON embedded in <script>window.tjGanttData = {...}</script>
                 # tjgantt.js reads this and renders the chart with D3
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
