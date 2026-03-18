#!/usr/bin/env ruby -w
# frozen_string_literal: true
# encoding: UTF-8
#
# = JSTaskReportRE.rb -- The TaskJuggler III Project Management Software
#
# Copyright (c) 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014
#               by Chris Schlaeger <cs@taskjuggler.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of version 2 of the GNU General Public License as
# published by the Free Software Foundation.
#

require 'taskjuggler/reports/ReportBase'
require 'taskjuggler/reports/TableReport'
require 'taskjuggler/Interval'
require 'taskjuggler/PropertyList'
require 'taskjuggler/LogicalExpression'

class TaskJuggler

  # This specialization of ReportBase implements an interactive Gantt chart
  # report. Task data is serialized as JSON and embedded in a self-contained
  # HTML file. D3.js is used to render the chart.
  class JSTaskReportRE < ReportBase

    def initialize(report)
      super
    end

    # Build the filtered and sorted task list.
    def generateIntermediateFormat
      super

      taskList = PropertyList.new(@project.tasks)
      taskList.includeAdopted
      taskList.setSorting(@report.get('sortTasks'))
      taskList.query = @report.project.reportContexts.last.query
      taskList = filterTaskList(taskList, nil, @report.get('hideTask'),
                                @report.get('rollupTask'),
                                @report.get('openNodes'))
      taskList.sort!
      taskList.checkForDuplicates(@report.sourceFileInfo)

      @taskList = taskList
      @scenarios = @report.get('scenarios')

      # Build a full resource list for potential nested resource rows.
      # filterResourceList is called per-task in build_nested_resource_rows.
      resourceList = PropertyList.new(@project.resources)
      begin
        resourceList.setSorting(@report.get('sortResources'))
      rescue
        # sortResources may not be defined for all report contexts; ignore.
      end
      resourceList.query = @report.project.reportContexts.last.query
      @resourceList = resourceList
    end

    # Return the report as an Array of XMLElement objects.
    def to_html
      # Set up a reusable query object for computed attributes.
      @query = @report.project.reportContexts.last.query.dup

      scenarioNames = @scenarios.map { |idx| @project.scenario(idx).id }

      # Columns requested in the report definition (excluding 'chart' and
      # 'weekly' which are the SVG panel itself).
      col_defs = (@report.get('columns') || []).reject { |c|
        c.id == 'chart' || c.id == 'weekly'
      }
      # Fall back to a sensible default when none are specified.
      if col_defs.empty?
        %w( bsi name start end ).each do |id|
          title = TableReport.defaultColumnTitle(id) || id.capitalize
          col_defs << TableColumnDefinition.new(id, title)
        end
      end
      # Build column metadata objects — title and alignment come from the
      # TableColumnDefinition (user-customisable title) and TableReport's
      # alignment table.  Unknown columns default to left-aligned.
      requested_cols = col_defs.map do |col|
        align_sym = TableReport.alignment(col.id, nil)
        align_str = (align_sym == :right) ? 'right' : 'left'
        { 'id' => col.id, 'title' => col.title, 'align' => align_str }
      end

      # Build the rows JSON array.
      rows_json = build_rows_json

      now_date = @project['now'] || TjTime.new

      # Icon base URL — only valid in non-selfcontained mode (same behaviour as
      # ReportTableCell which skips icons when selfcontained).
      icon_base = a('selfcontained') ? nil : (a('auxdir').to_s + 'icons/')

      # Emit initialScale:'week' when a 'weekly' column is present so the
      # JS renderer starts zoomed to approximately one week of width.
      has_weekly = (@report.get('columns') || []).any? { |c| c.id == 'weekly' }

      project_data = {
        'start'        => @project['start'] ? @project['start'].strftime('%Y-%m-%d') : nil,
        'end'          => @project['end']   ? @project['end'].strftime('%Y-%m-%d')   : nil,
        'now'          => now_date.strftime('%Y-%m-%d'),
        'scenarios'    => scenarioNames,
        'columns'      => requested_cols,
        'iconBase'     => icon_base,
        'tz'           => TjTime.timeZone,
        'tzOffset'     => (@project['start'] ? Time.at(@project['start'].to_i).localtime.utc_offset : 0),
        'initialScale' => has_weekly ? 'week' : nil
      }

      gantt_data = {
        'project' => project_data,
        'rows'    => rows_json
      }

      json_str = to_json(gantt_data)

      html = []

      html << rt_to_html('header')

      # ── Inline D3.js ──────────────────────────────────────────────────────
      d3_src = find_data_file('data/js/d3.min.js')
      if d3_src
        html << (d3_script = XMLElement.new('script', 'type' => 'text/javascript'))
        d3_script << XMLBlob.new("\n" + IO.read(d3_src) + "\n")
      end

      # ── Script block: embed the JSON data ─────────────────────────────────
      html << (data_script = XMLElement.new('script', 'type' => 'text/javascript'))
      data_script << XMLBlob.new(
        "\nwindow.tjGanttData = #{json_str};\n"
      )

      # ── Container div ─────────────────────────────────────────────────────
      html << XMLElement.new('div', 'id' => 'tj-gantt-container',
                             'style' => 'width:100%;font-family:sans-serif;')

      # ── Inline chart rendering script ─────────────────────────────────────
      chart_src = find_data_file('data/js/tjgantt.js')
      if chart_src
        html << (chart_script = XMLElement.new('script', 'type' => 'text/javascript'))
        chart_script << XMLBlob.new("\n" + IO.read(chart_src) + "\n")
      end

      # ── Caption and legend ────────────────────────────────────────────────
      # margin-top:-2px collapses the seam with the chart's bottom border.
      # border matches the chart's 2px solid #9a9a9a outer frame.
      footer_div = XMLElement.new('div',
        'style' => 'width:100%;box-sizing:border-box;' \
                   'margin-top:-2px;border:2px solid #9a9a9a;')
      if a('caption')
        cap_div = XMLElement.new('div', 'class' => 'tj_table_caption',
          'style' => 'margin:0;border-bottom:3px solid #9a9a9a;')
        a('caption').sectionNumbers = false
        cap_div << a('caption').to_html
        footer_div << cap_div
      end

      legend = ReportTableLegend.new
      legend.showGanttItems = true
      legend.addGanttItem('Off-duty period', 'offduty')
      legend_el = legend.to_html
      legend_el['style'] = 'margin:0;' if legend_el
      footer_div << legend_el
      html << footer_div

      html << rt_to_html('footer')

      html
    end

    private

    # Build the full rows JSON array for this report.
    def build_rows_json
      rows = []
      proj_iv = TimeInterval.new(@project['start'], @project['end'])
      min_time_off = 86400

      @taskList.each do |task|
        # ── Scenario-specific data ──────────────────────────────────────
        scenarios_data = {}
        @scenarios.each do |idx|
          sc_id = @project.scenario(idx).id
          t_start = task['start', idx]
          t_end   = task['end',   idx]
          milestone = task['milestone', idx]

          start_str = t_start ? t_start.strftime('%Y-%m-%d') : nil
          end_str   = t_end   ? t_end.strftime('%Y-%m-%d')   : nil

          duration_days = nil
          if t_start && t_end
            duration_days = ((t_end - t_start) / 86400.0).round
          end

          timeoff_zones = task.collectTimeOffIntervals(idx, proj_iv, min_time_off)
          timeoff_json  = timeoff_zones.map do |zone|
            [ zone.start.to_i, zone.end.to_i ]
          end

          scenarios_data[sc_id] = {
            'start'     => start_str,
            'end'       => end_str,
            'duration'  => duration_days,
            'complete'  => query_task_num(task, 'complete', idx),
            'milestone' => milestone,
            'effort'    => query_task_str(task, 'effort',  idx),
            'cost'      => query_task_str(task, 'cost',    idx),
            'revenue'   => query_task_str(task, 'revenue', idx),
            'timeoff'   => timeoff_json
          }
        end

        # ── Dependencies ────────────────────────────────────────────────
        depends = []
        @scenarios.each do |idx|
          deps = task['depends', idx] rescue []
          deps.each do |dep|
            dep_id = dep.task.fullId rescue nil
            next unless dep_id
            depends << { 'id' => dep_id, 'scenario' => @project.scenario(idx).id }
          end
        end
        depends.uniq!

        wbs = task.get('bsi') rescue nil
        wbs ||= task.fullId

        rows << {
          'rowType'     => 'task',
          'rowSpan'     => @scenarios.length,
          'id'          => task.fullId,
          'name'        => task.name,
          'wbs'         => wbs,
          'parent'      => task.parent ? task.parent.fullId : nil,
          'level'       => task.level,
          'isContainer' => !task.children.empty?,
          'scenarios'   => scenarios_data,
          'depends'     => depends
        }

        # Append nested resource rows (e.g. Development report style).
        rows.concat(build_nested_resource_rows(task))
      end

      rows
    end

    # Build nested-resource sub-rows for a task.  Returns [] if hideResource
    # filters everything out (e.g. when hideresource @all is set).
    def build_nested_resource_rows(task)
      return [] unless @resourceList

      filtered = filterResourceList(
        @resourceList.dup, task,
        @report.get('hideResource'),
        @report.get('rollupResource'),
        @report.get('openNodes')
      )
      return [] if filtered.empty?

      rows = []
      filtered.each do |resource|
        load_data = {}
        @scenarios.each do |idx|
          sc_id = @project.scenario(idx).id
          buckets = collect_load_buckets(resource, task, idx, ['assigned', 'busy', 'free'])
          load_data[sc_id] = {
            'categories' => ['assigned', 'busy', 'free'],
            'buckets'    => buckets
          }
        end

        rows << {
          'rowType'  => 'nested-resource',
          'id'       => resource.fullId,
          'name'     => resource.name,
          'parent'   => resource.parent ? resource.parent.fullId : nil,
          'scopeId'  => task.fullId,
          'level'    => resource.level,
          'isLeaf'   => resource.children.empty?,
          'loadData' => load_data
        }
      end
      rows
    end

    # Collect daily load buckets for a property (resource or task) optionally
    # scoped to another property.  Returns an array of
    #   [unix_day_start, v0, v1, ...]
    # where the values correspond to the requested categories.
    #
    # categories:
    #   ['assigned', 'busy', 'free']  — nested-resource under task
    #     (property=resource, scope_property=task)
    #   ['busy', 'free']              — resource primary (scope_property=nil)
    #     (property=resource, scope_property=nil)
    #   ['busy', 'free']              — nested-task under resource
    #     (property=task, scope_property=resource)
    def collect_load_buckets(property, scope_property, sc_idx, categories)
      buckets = []
      return buckets if @project['start'].nil? || @project['end'].nil?

      day      = @project['start']
      proj_end = @project['end']

      while day < proj_end
        next_day = TjTime.new(day.to_i + 86400)
        next_day = proj_end if next_day > proj_end

        si = @project.dateToIdx(day)
        ei = @project.dateToIdx(next_day)

        values =
          case categories.first
          when 'assigned'
            # nested-resource under task: property=resource, scope_property=task
            task_work  = property.getEffectiveWork(sc_idx, si, ei, scope_property)
            total_work = property.getEffectiveWork(sc_idx, si, ei)
            free_work  = property.getEffectiveFreeWork(sc_idx, si, ei)
            [task_work, total_work - task_work, free_work]
          when 'busy'
            if scope_property
              # nested-task under resource: property=task, scope_property=resource
              capacity  = scope_property.getEffectiveWork(sc_idx, si, ei) +
                          scope_property.getEffectiveFreeWork(sc_idx, si, ei)
              task_work = property.getEffectiveWork(sc_idx, si, ei, scope_property)
              [task_work, capacity - task_work]
            else
              # resource primary row
              [property.getEffectiveWork(sc_idx, si, ei),
               property.getEffectiveFreeWork(sc_idx, si, ei)]
            end
          else
            []
          end

        buckets << ([day.to_i] + values)
        day = next_day
      end

      buckets
    end

    # Query a task attribute and return the numeric result (or nil).
    def query_task_num(task, attr, idx)
      @query.property    = task
      @query.attributeId = attr
      @query.scenarioIdx = idx
      @query.process
      @query.to_num
    rescue
      nil
    end

    # Query a task attribute and return the formatted string result (or nil).
    def query_task_str(task, attr, idx)
      @query.property    = task
      @query.attributeId = attr
      @query.scenarioIdx = idx
      @query.process
      s = @query.to_s
      s.empty? ? nil : s
    rescue
      nil
    end

    # Locate a data file using AppConfig.dataDirs (same mechanism as CSS).
    def find_data_file(relative_path)
      dir_part  = File.dirname(relative_path)
      base_name = File.basename(relative_path)
      dirs = AppConfig.dataDirs(dir_part)
      dirs.each do |dir|
        candidate = File.join(dir, base_name)
        return candidate if File.exist?(candidate)
      end
      nil
    end

    # Minimal JSON serializer — avoids a hard dependency on the json gem.
    def to_json(obj)
      case obj
      when Hash
        pairs = obj.map { |k, v| "#{to_json(k.to_s)}:#{to_json(v)}" }
        "{#{pairs.join(',')}}"
      when Array
        "[#{obj.map { |v| to_json(v) }.join(',')}]"
      when String
        "\"#{obj.gsub('\\', '\\\\\\\\').gsub('"', '\\"').gsub("\n", '\\n')}\""
      when Integer, Float
        obj.to_s
      when TrueClass, FalseClass
        obj.to_s
      when NilClass
        'null'
      else
        "\"#{obj.to_s.gsub('"', '\\"')}\""
      end
    end

  end

end
