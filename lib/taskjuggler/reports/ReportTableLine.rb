#!/usr/bin/env ruby -w
# frozen_string_literal: true
# encoding: UTF-8
#
# = ReportTableLine.rb -- The TaskJuggler III Project Management Software
#
# Copyright (c) 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014
#               by Chris Schlaeger <cs@taskjuggler.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of version 2 of the GNU General Public License as
# published by the Free Software Foundation.
#

require 'taskjuggler/reports/ReportTableCell'

class TaskJuggler

  class ReportTableLine

    attr_reader :table, :property, :scopeLine
    attr_accessor :height, :indentation, :fontSize, :bold,
                  :no, :lineNo, :subLineNo

    # Create a ReportTableCell object and initialize the variables with default
    # values. _table_ is a reference to the ReportTable object this line belongs
    # to. _property_ is a reference to the Task or Resource that is displayed in
    # this line. _scopeLine_ is the line that sets the scope for this line. The
    # value is nil if this is a primary line.
    def initialize(table, property, scopeLine)
      @table = table
      @property = property
      @scopeLine = scopeLine

      # Register the new line with the table it belongs to.
      @table.addLine(self)
      # The cells of this line. Should be references to ReportTableCell objects.
      @cells = []
      # Heigh of the line in screen pixels
      @height = 21
      # Indentation for hierachiecal columns in screen pixels.
      @indentation = 0
      # The factor used to enlarge or shrink the font size for this line.
      @fontSize = 12
      # Specifies whether the whole line should be in bold type or not.
      @bold = false
      # Counter that counts primary and nested lines separately. It restarts
      # with 0 for each new nested line set. Scenario lines don't count.
      @no = nil
      # Counter that counts the primary lines. Scenario lines don't count.
      @lineNo = nil
      # Counter that counts all lines.
      @subLineNo = nil
    end

    # Return the last non-hidden cell of the line. Start to look for the cell at
    # the first cell after _count_ cells.
    def last(count = 0)
      (1 + count).upto(@cells.length) do |i|
        return @cells[-i] unless @cells[-i].hidden
      end
      nil
    end

    # Add the new cell to the line. _cell_ must reference a ReportTableCell
    # object.
    def addCell(cell)
      @cells << cell
    end

    # Return the scope property or nil
    def scopeProperty
      @scopeLine ? @scopeLine.property : nil
    end

    # Build one row hash for the interactive (htmljs) Gantt chart.
    # _resource_no_ is the sequential resource counter (only meaningful for
    # top-level resource rows; ignored otherwise).
    # Returns nil if this line's property type is not handled.
    def to_htmljs(resource_no = nil)
      scope = scopeProperty
      if @property.is_a?(Task) && scope.nil?
        build_task_row
      elsif @property.is_a?(Resource) && scope.nil?
        build_resource_row(resource_no)
      elsif @property.is_a?(Resource) && scope.is_a?(Task)
        build_nested_resource_row
      elsif @property.is_a?(Task) && scope.is_a?(Resource)
        build_nested_task_row
      end
    end

    # Return this line as a set of XMLElement that represent the line in HTML.
    def to_html
      style = ""
      style += "height:#{@height}px; " if @table.equiLines
      style += "font-size:#{@fontSize}px; " if @fontSize
      tr = XMLElement.new('tr', 'class' => 'tabline', 'style' => style)
      @cells.each { |cell| tr << cell.to_html }
      tr
    end

    # Convert the intermediate format into an Array of values. One entry for
    # every column cell of this line.
    def to_csv(csv, startColumn, lineIdx)
      columnIdx = startColumn
      @cells.each do |cell|
        columnIdx += cell.to_csv(csv, columnIdx, lineIdx)
      end
      columnIdx - startColumn
    end

  private

    # ── Accessor helpers ────────────────────────────────────────────────────────

    # The project, accessed via any cell's query.
    def project
      @cells.each do |c|
        next unless c.respond_to?(:query)
        return c.query.project if c.query&.project
      end
      nil
    end

    # A base query suitable for duplication, from the first non-special cell
    # that has a query.
    def base_query
      @cells.find { |c| c.respond_to?(:query) && !c.special && c.query }&.query
    end

    # Return the GanttChart embedded in the 'chart' column header, or nil.
    def gantt_chart
      @table.columns.each do |col|
        return col.cell1.special if col.definition&.id == 'chart' && col.cell1&.special
      end
      nil
    end

    # Return [chart_start, chart_end] from the GanttChart if present, otherwise
    # from the project's overall start/end.
    def chart_bounds
      g = gantt_chart
      return [g.start, g.end] if g
      pr = project
      [pr&.[]('start'), pr&.[]('end')]
    end

    # Return the scenario index for this line (from the first available query).
    def scenario_idx
      @cells.each do |c|
        next unless c.respond_to?(:query)
        return c.query.scenarioIdx if c.query
      end
      0
    end

    # Return the scenario name string for index _idx_.
    def scenario_name(idx)
      project&.scenario(idx)&.id
    end

    # ── Row builders ────────────────────────────────────────────────────────────

    def build_task_row
      task = @property
      chart_start, chart_end = chart_bounds
      gantt  = gantt_chart
      idx    = scenario_idx
      sc_id  = scenario_name(idx)
      bq     = base_query

      t_start = task['start', idx]
      t_end   = task['end',   idx]

      gantt_line = gantt&.line_for(task, nil, idx)
      if gantt_line
        line_data = gantt_line.to_htmljs
        timeoff   = line_data['timeoff'] || []
        bar       = line_data['bar']
        complete  = bar ? bar['complete'] : nil
      else
        timeoff  = htmljs_collect_timeoff(task, idx, chart_start, chart_end)
        complete = htmljs_query_num(bq, task, 'complete', idx)
      end

      sc_data = {
        'start'     => t_start ? t_start.strftime('%Y-%m-%d') : nil,
        'end'       => t_end   ? t_end.strftime('%Y-%m-%d')   : nil,
        'duration'  => (t_start && t_end) ?
                       ((t_end - t_start) / 86400.0).round : nil,
        'complete'  => complete,
        'milestone' => task['milestone', idx],
        'effort'    => htmljs_query_str(bq, task, 'effort',  idx),
        'cost'      => htmljs_query_str(bq, task, 'cost',    idx),
        'revenue'   => htmljs_query_str(bq, task, 'revenue', idx),
        'timeoff'   => timeoff
      }

      depends = []
      deps = task['depends', idx] rescue []
      deps.each do |dep|
        dep_id = dep.task.fullId rescue nil
        next unless dep_id
        depends << { 'id' => dep_id, 'scenario' => sc_id }
      end
      depends.uniq!

      wbs = task.get('bsi') rescue nil
      wbs ||= task.fullId

      {
        'rowType'     => 'task',
        'rowSpan'     => 1,
        'id'          => task.fullId,
        'name'        => task.name,
        'wbs'         => wbs,
        'parent'      => task.parent ? task.parent.fullId : nil,
        'level'       => task.level,
        'isContainer' => !task.children.empty?,
        'scenarios'   => { sc_id => sc_data },
        'depends'     => depends
      }
    end

    def build_resource_row(no)
      resource = @property
      chart_start, chart_end = chart_bounds
      gantt  = gantt_chart
      idx    = scenario_idx
      sc_id  = scenario_name(idx)
      bq     = base_query

      col_defs = @table.columns.reject { |c|
        id = c.definition&.id
        id == 'chart' || id == 'weekly' || id == 'no' || id == 'name'
      }

      gantt_line = gantt&.line_for(resource, nil, idx)
      if gantt_line
        line_data = gantt_line.to_htmljs
        load_sc = {
          'categories' => line_data['categories'],
          'buckets'    => line_data['buckets'],
          'timeoff'    => line_data['timeoff'] || []
        }
      else
        load_sc = htmljs_load_buckets(resource, nil, idx, ['busy', 'free'],
                                      chart_start, chart_end)
      end

      cols_data = {}
      col_defs.each do |col|
        col_id = col.definition&.id
        cols_data[col_id] = htmljs_query_str(bq, resource, col_id, idx)
      end

      {
        'rowType'  => 'resource',
        'no'       => no,
        'id'       => resource.fullId,
        'name'     => resource.name,
        'parent'   => resource.parent ? resource.parent.fullId : nil,
        'level'    => resource.level,
        'isLeaf'   => resource.children.empty?,
        'cols'     => cols_data,
        'loadData' => { sc_id => load_sc }
      }
    end

    def build_nested_resource_row
      resource    = @property
      task        = scopeProperty
      chart_start, chart_end = chart_bounds
      gantt  = gantt_chart
      idx    = scenario_idx
      sc_id  = scenario_name(idx)

      gantt_line = gantt&.line_for(resource, task, idx)
      if gantt_line
        line_data = gantt_line.to_htmljs
        load_sc = {
          'categories' => line_data['categories'],
          'buckets'    => line_data['buckets'],
          'timeoff'    => line_data['timeoff'] || []
        }
      else
        load_sc = htmljs_load_buckets(resource, task, idx,
                                      ['assigned', 'busy', 'free'],
                                      chart_start, chart_end)
      end

      {
        'rowType'  => 'nested-resource',
        'id'       => resource.fullId,
        'name'     => resource.name,
        'parent'   => resource.parent ? resource.parent.fullId : nil,
        'scopeId'  => task.fullId,
        'level'    => resource.level,
        'isLeaf'   => resource.children.empty?,
        'loadData' => { sc_id => load_sc }
      }
    end

    def build_nested_task_row
      task     = @property
      resource = scopeProperty
      chart_start, chart_end = chart_bounds
      gantt  = gantt_chart
      idx    = scenario_idx
      sc_id  = scenario_name(idx)

      gantt_line = gantt&.line_for(task, resource, idx)
      if gantt_line
        line_data = gantt_line.to_htmljs
        load_sc = {
          'categories' => line_data['categories'],
          'buckets'    => line_data['buckets'],
          'timeoff'    => line_data['timeoff'] || []
        }
      else
        load_sc = htmljs_load_buckets(task, resource, idx, ['busy'],
                                      chart_start, chart_end)
      end

      {
        'rowType'  => 'nested-task',
        'id'       => task.fullId,
        'name'     => task.name,
        'scopeId'  => resource.fullId,
        'level'    => task.level,
        'isLeaf'   => task.children.empty?,
        'loadData' => { sc_id => load_sc }
      }
    end

    # ── Fallback load/timeoff helpers ───────────────────────────────────────────

    # Fallback load-bucket computation used when no GanttChart is present
    # (e.g. 'weekly' column reports).
    def htmljs_load_buckets(property, scope_property, sc_idx, categories,
                             chart_start, chart_end)
      buckets = []
      return { 'categories' => categories, 'buckets' => buckets,
               'timeoff'    => [] } unless chart_start && chart_end

      task_start = task_end = nil
      if scope_property.is_a?(Task)
        task_start = scope_property['start', sc_idx] || chart_start
        task_end   = scope_property['end',   sc_idx] || chart_end
      elsif scope_property.is_a?(Resource) && property.is_a?(Task)
        task_start = property['start', sc_idx] || chart_start
        task_end   = property['end',   sc_idx] || chart_end
      end

      pr  = project
      day = chart_start
      while day < chart_end
        next_day = TjTime.new(day.to_i + 86400)
        next_day = chart_end if next_day > chart_end

        eff_start = day
        eff_end   = next_day

        if task_start
          if eff_end <= task_start || task_end <= eff_start
            day = next_day
            next
          end
          eff_start = task_start if eff_start < task_start
          eff_end   = task_end   if eff_end   > task_end
        end

        si = pr.dateToIdx(eff_start)
        ei = pr.dateToIdx(eff_end)

        values =
          if property.is_a?(Resource) && scope_property.is_a?(Task)
            task_work    = property.getEffectiveWork(sc_idx, si, ei, scope_property)
            overall_work = property.getEffectiveWork(sc_idx, si, ei)
            free_work    = property.getEffectiveFreeWork(sc_idx, si, ei)
            [task_work, overall_work - task_work, free_work]
          elsif property.is_a?(Resource)
            [property.getEffectiveWork(sc_idx, si, ei),
             property.getEffectiveFreeWork(sc_idx, si, ei)]
          elsif property.is_a?(Task) && scope_property.is_a?(Resource)
            [property.getEffectiveWork(sc_idx, si, ei, scope_property)]
          else
            []
          end

        sum = values.inject(0.0, :+)
        buckets << ([day.to_i] + values) if sum > 0

        day = next_day
      end

      timeoff = htmljs_collect_timeoff(property, sc_idx, chart_start, chart_end)
      { 'categories' => categories, 'buckets' => buckets, 'timeoff' => timeoff }
    end

    # Collect time-off intervals for _property_ as [[startUnix, endUnix], ...].
    def htmljs_collect_timeoff(property, sc_idx, chart_start, chart_end)
      return [] unless chart_start && chart_end
      iv  = TimeInterval.new(chart_start, chart_end)
      raw = property.collectTimeOffIntervals(sc_idx, iv, 86400)
      raw.map { |z| [z.start.to_i, z.end.to_i] }
    rescue
      []
    end

    # Run a query and return the numeric result, or nil on failure.
    def htmljs_query_num(base_query, property, attr, sc_idx)
      return nil unless base_query
      q = base_query.dup
      q.property    = property
      q.attributeId = attr
      q.scenarioIdx = sc_idx
      q.process
      q.to_num
    rescue
      nil
    end

    # Run a query and return the formatted string result, or nil if empty.
    def htmljs_query_str(base_query, property, attr, sc_idx)
      return nil unless base_query
      q = base_query.dup
      q.property    = property
      q.attributeId = attr
      q.scenarioIdx = sc_idx
      q.process
      s = q.to_s
      s.empty? ? nil : s
    rescue
      nil
    end

  end

end

