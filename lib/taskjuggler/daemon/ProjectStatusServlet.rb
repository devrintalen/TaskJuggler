#!/usr/bin/env ruby -w
# frozen_string_literal: true
# encoding: UTF-8
#
# = ProjectStatusServlet.rb -- The TaskJuggler III Project Management Software
#
# Copyright (c) 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014
#               by Chris Schlaeger <cs@taskjuggler.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of version 2 of the GNU General Public License as
# published by the Free Software Foundation.
#

require 'webrick'
require 'drb'
require 'json'

class TaskJuggler

  # Serves the /project-status endpoint as a Server-Sent Event stream.
  #
  # GET /project-status?project=<id>&since=<unix_timestamp>
  #
  # Polls tj3d every POLL_INTERVAL seconds for the scheduledAt time of the
  # given project.  Pushes a single "reload" event when scheduledAt advances
  # past +since+, then closes the stream.  The browser reconnects after
  # reloading, resetting the baseline to the new stamp.
  class ProjectStatusServlet < WEBrick::HTTPServlet::AbstractServlet

    POLL_INTERVAL = 1  # seconds between broker polls

    def initialize(config, options)
      super
      @authKey = options[0]
      @host    = options[1]
      @port    = options[2]
      @uri     = options[3]
    end

    def self.get_instance(config, options)
      self.new(config, options)
    end

    def do_GET(req, res)
      project_id = req.query['project'].to_s
      since      = req.query['since'].to_i

      res['Content-Type']      = 'text/event-stream'
      res['Cache-Control']     = 'no-cache'
      res['X-Accel-Buffering'] = 'no'

      rd, wr = IO.pipe
      res.body = rd

      Thread.new do
        begin
          watch_project(wr, project_id, since)
        rescue Errno::EPIPE, IOError
          # client disconnected — exit cleanly
        ensure
          wr.close
        end
      end
    end

    private

    def watch_project(wr, project_id, since)
      loop do
        at = fetch_scheduled_at(project_id)
        if at && at > since
          payload = JSON.generate({ 'scheduledAt' => at })
          wr.write("event: reload\ndata: #{payload}\n\n")
          return
        end
        sleep POLL_INTERVAL
      end
    end

    def fetch_scheduled_at(project_id)
      # Use DRbObject directly rather than DaemonConnector so we do not
      # start/stop the global DRb service on every poll iteration.
      DRb.start_service('druby://127.0.0.1:0') unless DRb.primary_server
      broker_uri = "druby://#{@host}:#{@port}"
      broker = DRbObject.new_with_uri(broker_uri)
      uri, auth_key = broker.getProject(@authKey, project_id)
      return nil unless uri
      ps = DRbObject.new(nil, uri)
      at = ps.getScheduledAt(auth_key)
      at.is_a?(Integer) ? at : nil
    rescue
      nil
    end

  end

end
