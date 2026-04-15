#!/usr/bin/env ruby -w
# frozen_string_literal: true
# encoding: UTF-8
#
# = CursorServlet.rb -- The TaskJuggler III Project Management Software
#
# Copyright (c) 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014
#               by Chris Schlaeger <cs@taskjuggler.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of version 2 of the GNU General Public License as
# published by the Free Software Foundation.
#

require 'webrick'
require 'json'

class TaskJuggler

  # Serves the /cursor endpoint for two-way task highlighting between the
  # browser and an external editor (e.g. taskjuggler-mode.el).
  #
  # The servlet maintains a single in-memory cursor state with a source tag
  # so each consumer can ignore events it originated.
  #
  # POST /cursor         -- Set the active task.  Body: {"id":"...", "source":"browser"|"editor"}
  # GET  /cursor/events  -- SSE stream.  Pushes {"id":..., "ts":N, "source":"..."} on every POST.
  # GET  /cursor/state   -- Poll the current cursor state (for editors that cannot use SSE).
  class CursorServlet < WEBrick::HTTPServlet::AbstractServlet

    # In-memory cursor state (replaces tj-cursor.js file).
    @@state       = { id: nil, ts: 0, source: nil }
    @@state_mutex = Mutex.new

    # All active SSE writer ends; guarded by @@writers_mutex.
    @@writers       = []
    @@writers_mutex = Mutex.new

    # WEBrick logger — set in initialize so class methods can use it.
    @@logger = nil

    def initialize(config, options)
      super
      @@logger = config[:Logger]
    end

    def self.get_instance(config, options)
      new(config, options)
    end

    # Route GET requests to sub-paths.
    def do_GET(req, res)
      case req.path
      when '/cursor/events'
        serve_events(req, res)
      when '/cursor/state'
        serve_state(req, res)
      else
        res.status = 404
        res['Content-Type'] = 'text/plain'
        res.body = 'Not Found'
      end
    end

    # Update cursor state and broadcast to all SSE clients.
    def do_POST(req, res)
      begin
        body = JSON.parse(req.body.to_s)
      rescue JSON::ParserError
        res.status = 400
        res['Content-Type'] = 'text/plain'
        res.body = 'Bad JSON'
        return
      end

      task_id = body['id'].to_s
      source  = body['source'].to_s
      unless %w[browser editor].include?(source)
        res.status = 400
        res['Content-Type'] = 'application/json'
        res.body = '{"error":"source must be browser or editor"}'
        return
      end

      ts = Time.now.to_i

      @@state_mutex.synchronize do
        @@state[:id]     = task_id
        @@state[:ts]     = ts
        @@state[:source] = source
      end

      self.class.broadcast(task_id, ts, source)

      res.status = 200
      res['Content-Type'] = 'application/json'
      res.body = JSON.generate({ 'ok' => true, 'ts' => ts })
    end

    # Close all open SSE pipes.  Called by WebServer#stop so WEBrick's
    # connection threads see EOF and can join.
    def self.shutdown
      @@writers_mutex.synchronize do
        @@writers.each { |wr| wr.close rescue nil }
        @@writers.clear
      end
    end

    private

    # SSE stream: register a pipe and hold the connection open.
    def serve_events(_req, res)
      res['Content-Type']      = 'text/event-stream'
      res['Cache-Control']     = 'no-cache'
      res['X-Accel-Buffering'] = 'no'

      rd, wr = IO.pipe
      res.body = rd

      @@writers_mutex.synchronize { @@writers << wr }
    end

    # Return current cursor state as JSON.
    def serve_state(_req, res)
      snapshot = @@state_mutex.synchronize { @@state.dup }

      res.status = 200
      res['Content-Type'] = 'application/json'
      res.body = JSON.generate({
        'id'     => snapshot[:id],
        'ts'     => snapshot[:ts],
        'source' => snapshot[:source]
      })
    end

    # Send a cursor SSE event to every registered writer, pruning dead ones.
    def self.broadcast(id, ts, source)
      payload = JSON.generate({ 'id' => id, 'ts' => ts, 'source' => source })
      event   = "event: cursor\ndata: #{payload}\n\n"

      @@writers_mutex.synchronize do
        @@writers.reject! do |wr|
          begin
            wr.write(event)
            false
          rescue Errno::EPIPE, IOError
            wr.close rescue nil
            true
          end
        end
      end
    end

  end

end
