#!/usr/bin/env ruby -w
# frozen_string_literal: true
# encoding: UTF-8
#
# = GanttTaskBar.rb -- The TaskJuggler III Project Management Software
#
# Copyright (c) 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014
#               by Chris Schlaeger <cs@taskjuggler.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of version 2 of the GNU General Public License as
# published by the Free Software Foundation.
#

require 'taskjuggler/reports/HTMLGraphics'

class TaskJuggler

  # The GanttTaskBar represents a normal task that is part of a GanttChart.
  class GanttTaskBar

    include HTMLGraphics

    # The size of the bar in pixels from center to top/bottom.
    @@size = 6

    # Create a GanttContainer object based on the following information: _line_
    # is a reference to the GanttLine. _xStart_ is the left edge of the task in
    # chart coordinates. _xEnd_ is the right edge.
    # _startDate_ and _endDate_ are optional TjTime objects used by to_htmljs.
    def initialize(query, lineHeight, xStart, xEnd, y, startDate = nil, endDate = nil)
      @query = query
      @lineHeight = lineHeight
      @start = xStart
      @end = xEnd
      @y = y
      @startDate = startDate
      @endDate = endDate
    end

    # Return the point [ x, y ] where task start dependency lines should start
    # from.
    def startDepLineStart
      [ @start + 1, @y + @lineHeight / 2 ]
    end

    # Return the point [ x, y ] where task start dependency lines should end at.
    def startDepLineEnd
      [ @start - 1, @y + @lineHeight / 2 ]
    end

    # Return the point [ x, y ] where task end dependency lines should start
    # from.
    def endDepLineStart
      [ @end + 1, @y + @lineHeight / 2 ]
    end

    # Return the point [ x, y ] where task end dependency lines should end at.
    def endDepLineEnd
      [ @end - 1, @y + @lineHeight / 2 ]
    end

    # Return a JSON-serializable hash for interactive chart rendering.
    def to_htmljs
      return nil unless @startDate && @endDate
      completion = 0.0
      if @query
        q = @query.dup
        q.attributeId = 'complete'
        q.process
        res = q.result
        completion = res ? res.to_f : 0.0
      end
      { 'type' => 'taskbar', 'start' => @startDate.to_i, 'end' => @endDate.to_i,
        'complete' => completion }
    end

    def addBlockedZones(router)
      # Horizontal block for whole bar.
      router.addZone(@start, @y + (@lineHeight / 2) - @@size - 1,
                     @end - @start + 1, 2 * @@size + 3, true, false)
      # Block for arrowhead.
      router.addZone(@start - 9, @y + (@lineHeight / 2) - 7, 10, 15, true, true)
      # Vertical block for end cap
      router.addZone(@start - 2, @y, 5, @lineHeight,
                     false, true)
      router.addZone(@end - 2, @y, 5, @lineHeight, false, true)
    end

    # Convert the abstact representation of the GanttTaskBar into HTML
    # elements.
    def to_html
      xStart = @start.to_i
      yCenter = (@lineHeight / 2).to_i
      width = @end.to_i - @start.to_i + 1

      html = []

      # Invisible trigger frame for tooltips.
      html << rectToHTML(xStart, 0, width, @lineHeight, 'tj_gantt_frame')

      # First we draw the task frame.
      html << rectToHTML(xStart, yCenter - @@size, width, 2 * @@size,
                         'taskbarframe')

      # The we draw the filling.
      html << rectToHTML(xStart + 1, yCenter - @@size + 1, width - 2,
                         2 * @@size - 2, 'taskbar')
      # And then the progress bar. If query is null we assume 50% completion.
      if @query
        @query.attributeId = 'complete'
        @query.process
        res = @query.result
        completion = res ? res / 100.0 : 0.0
      else
        completion = 0.5
      end
      html << rectToHTML(xStart + 1, yCenter - @@size / 2,
                         (width - 2) * completion, @@size, 'progressbar')
    end

  end

end

