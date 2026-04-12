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

    # Watch entries: [ { project_id:, since:, wr: }, ... ]
    @@watches       = []
    @@watches_mutex = Mutex.new

    # Single shared poller thread (started on first connection).
    @@poller_thread = nil

    # DRb connection config — same for all instances.
    @@auth_key = nil
    @@drb_host = nil
    @@drb_port = nil

    def initialize(config, options)
      super
      @@auth_key = options[0]
      @@drb_host = options[1]
      @@drb_port = options[2]
    end

    def self.get_instance(config, options)
      new(config, options)
    end

    def do_GET(req, res)
      project_id = req.query['project'].to_s
      since      = req.query['since'].to_i

      res['Content-Type']      = 'text/event-stream'
      res['Cache-Control']     = 'no-cache'
      res['X-Accel-Buffering'] = 'no'

      rd, wr = IO.pipe
      res.body = rd

      @@watches_mutex.synchronize do
        @@watches << { project_id: project_id, since: since, wr: wr }
        if @@poller_thread.nil? || !@@poller_thread.alive?
          @@poller_thread = self.class.start_poller
        end
      end
    end

    # Close all open SSE pipes and stop the poller thread.  Called by
    # WebServer#stop so WEBrick's connection threads see EOF and can join.
    def self.shutdown
      @@watches_mutex.synchronize do
        @@watches.each { |w| w[:wr].close rescue nil }
        @@watches.clear
      end
      if @@poller_thread
        @@poller_thread.kill rescue nil
        @@poller_thread = nil
      end
    end

    def self.start_poller
      Thread.new do
        begin
          poller_loop
        rescue => e
          warn "ProjectStatusServlet poller error: #{e}"
        end
      end
    end

    private

    # Polls all registered watches every POLL_INTERVAL seconds.  Fires and
    # removes a watch when its project's scheduledAt advances past its since
    # stamp.  Dead writers (client disconnected) are also pruned.
    def self.poller_loop
      loop do
        sleep POLL_INTERVAL

        # Snapshot the watch list; release the lock before doing DRb I/O.
        snapshot = @@watches_mutex.synchronize { @@watches.dup }
        next if snapshot.empty?

        to_remove = []
        snapshot.each do |w|
          begin
            at = fetch_scheduled_at(w[:project_id])
            if at && at > w[:since]
              payload = JSON.generate({ 'scheduledAt' => at })
              w[:wr].write("event: reload\ndata: #{payload}\n\n")
              w[:wr].close rescue nil
              to_remove << w
            end
          rescue Errno::EPIPE, IOError
            w[:wr].close rescue nil
            to_remove << w
          end
        end

        unless to_remove.empty?
          @@watches_mutex.synchronize { @@watches -= to_remove }
        end
      end
    end

    def self.fetch_scheduled_at(project_id)
      # Use DRbObject directly rather than DaemonConnector so we do not
      # start/stop the global DRb service on every poll iteration.
      DRb.start_service('druby://127.0.0.1:0') unless DRb.primary_server
      broker_uri = "druby://#{@@drb_host}:#{@@drb_port}"
      broker = DRbObject.new_with_uri(broker_uri)
      uri, auth_key = broker.getProject(@@auth_key, project_id)
      return nil unless uri
      ps = DRbObject.new(nil, uri)
      at = ps.getScheduledAt(auth_key)
      at.is_a?(Integer) ? at : nil
    rescue
      nil
    end

  end

end
