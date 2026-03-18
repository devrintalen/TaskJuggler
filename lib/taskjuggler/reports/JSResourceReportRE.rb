#!/usr/bin/env ruby -w
# frozen_string_literal: true
# encoding: UTF-8
#
# = JSResourceReportRE.rb -- The TaskJuggler III Project Management Software
#
# Copyright (c) 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014
#               by Chris Schlaeger <cs@taskjuggler.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of version 2 of the GNU General Public License as
# published by the Free Software Foundation.
#

require 'taskjuggler/reports/JSTaskReportRE'

class TaskJuggler

  # Interactive JS Gantt chart renderer for resourcereport with htmljs format.
  # Resources are the primary rows; tasks may be nested beneath each resource.
  # Inherits to_html, collect_load_buckets, to_json, find_data_file, and
  # query helpers from JSTaskReportRE.
  class JSResourceReportRE < JSTaskReportRE

    def generateIntermediateFormat
      # Call ReportBase#generateIntermediateFormat directly to set up query
      # objects on header/footer/caption rich-text attributes.
      query = @report.project.reportContexts.last.query
      %w( header left center right footer
          prolog headline caption epilog ).each do |name|
        next unless (text = a(name))
        text.setQuery(query)
      end

      @scenarios = @report.get('scenarios')

      # Build the filtered, sorted resource list (primary rows).
      resourceList = PropertyList.new(@project.resources)
      resourceList.setSorting(@report.get('sortResources'))
      resourceList.query = @report.project.reportContexts.last.query
      resourceList = filterResourceList(resourceList, nil,
                                        @report.get('hideResource'),
                                        @report.get('rollupResource'),
                                        @report.get('openNodes'))
      resourceList.sort!
      @resourceList = resourceList

      # Build the full task list (unfiltered); filtering is done per-resource
      # in build_nested_task_rows so that *_() LogicalFunctions work correctly.
      taskList = PropertyList.new(@project.tasks)
      taskList.setSorting(@report.get('sortTasks'))
      taskList.query = @report.project.reportContexts.last.query
      taskList.sort!
      @taskList = taskList
    end

    # Build rows JSON for a resource-primary report.
    def build_rows_json
      rows = []
      no_counter = 0

      @resourceList.each do |resource|
        no_counter += 1

        # Collect non-chart column values as strings.
        col_defs = (@report.get('columns') || []).reject { |c|
          c.id == 'chart' || c.id == 'weekly'
        }
        cols_data = {}
        col_defs.each do |col|
          next if col.id == 'no' || col.id == 'name'
          val = query_task_str(resource, col.id, @scenarios.first || 0)
          cols_data[col.id] = val
        end

        # Load data per scenario (busy / free proportional bars).
        load_data = {}
        @scenarios.each do |idx|
          sc_id = @project.scenario(idx).id
          buckets = collect_load_buckets(resource, nil, idx, ['busy', 'free'])
          load_data[sc_id] = {
            'categories' => ['busy', 'free'],
            'buckets'    => buckets
          }
        end

        rows << {
          'rowType'  => 'resource',
          'no'       => no_counter,
          'id'       => resource.fullId,
          'name'     => resource.name,
          'parent'   => resource.parent ? resource.parent.fullId : nil,
          'level'    => resource.level,
          'isLeaf'   => resource.children.empty?,
          'cols'     => cols_data,
          'loadData' => load_data
        }

        # Append nested task sub-rows (e.g. ResourceGraph style).
        rows.concat(build_nested_task_rows(resource))
      end

      rows
    end

    private

    # Build nested-task sub-rows for a resource.  Returns [] when hideTask
    # filters out all tasks (e.g. hidetask @all in ContactList).
    def build_nested_task_rows(resource)
      return [] unless @taskList

      filtered = filterTaskList(
        @taskList.dup, resource,
        @report.get('hideTask'),
        @report.get('rollupTask'),
        @report.get('openNodes')
      )
      return [] if filtered.empty?

      rows = []
      filtered.each do |task|
        load_data = {}
        @scenarios.each do |idx|
          sc_id = @project.scenario(idx).id
          buckets = collect_load_buckets(task, resource, idx, ['busy', 'free'])
          load_data[sc_id] = {
            'categories' => ['busy', 'free'],
            'buckets'    => buckets
          }
        end

        rows << {
          'rowType'  => 'nested-task',
          'id'       => task.fullId,
          'name'     => task.name,
          'scopeId'  => resource.fullId,
          'level'    => task.level,
          'isLeaf'   => task.children.empty?,
          'loadData' => load_data
        }
      end
      rows
    end

  end

end
