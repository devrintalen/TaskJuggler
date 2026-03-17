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
    end

    # Return the report as an Array of XMLElement objects.
    def to_html
      scenarioNames = @scenarios.map { |idx| @project.scenario(idx).id }

      # Build the tasks JSON array as a Ruby string.
      tasks_json = @taskList.map do |task|
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

          complete = task['complete', idx] rescue nil
          effort   = task['effort', idx] rescue nil

          scenarios_data[sc_id] = {
            'start'     => start_str,
            'end'       => end_str,
            'duration'  => duration_days,
            'complete'  => complete,
            'milestone' => milestone,
            'effort'    => effort
          }
        end

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

        # WBS string — use sequenceNo-based path through the tree
        wbs = task.get('bsi') rescue nil
        wbs ||= task.fullId

        {
          'id'          => task.fullId,
          'name'        => task.name,
          'wbs'         => wbs,
          'parent'      => task.parent ? task.parent.fullId : nil,
          'level'       => task.level,
          'isContainer' => !task.children.empty?,
          'scenarios'   => scenarios_data,
          'depends'     => depends
        }
      end

      project_data = {
        'start'     => @project['start'] ? @project['start'].strftime('%Y-%m-%d') : nil,
        'end'       => @project['end']   ? @project['end'].strftime('%Y-%m-%d')   : nil,
        'now'       => TjTime.new.strftime('%Y-%m-%d'),
        'scenarios' => scenarioNames
      }

      gantt_data = {
        'project' => project_data,
        'tasks'   => tasks_json
      }

      json_str = to_json(gantt_data)

      html = []

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

      html
    end

    private

    # Locate a data file using AppConfig.dataDirs (same mechanism as CSS).
    def find_data_file(relative_path)
      dir_part  = File.dirname(relative_path)   # e.g. 'data/js'
      base_name = File.basename(relative_path)  # e.g. 'd3.min.js'
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
