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
  # GET  /cursor  -- Server-Sent Event stream.  Watches tj-cursor.js for
  #                  changes and pushes {"cursorId":..., "cursorTs":N} to the
  #                  browser whenever the editor pipe (_tjCursorTaskId /
  #                  _tjCursorTs) advances.
  #
  # POST /cursor  -- Receives a clicked task ID from the browser, writes it
  #                  into the browser pipe (_tjClickTaskId / _tjClickTs) of
  #                  tj-cursor.js while preserving the editor pipe fields so
  #                  the SSE watcher does not fire a spurious cursor update.
  #
  # tj-cursor.js format (all four fields always present):
  #
  #   window._tjCursorTaskId = "foo.bar";   # editor pipe: cursor position
  #   window._tjCursorTs     = 1712844002;  # editor pipe: Unix timestamp
  #   window._tjClickTaskId  = "baz.qux";  # browser pipe: clicked task
  #   window._tjClickTs      = 1712844000; # browser pipe: Unix timestamp
  #
  # The editor tracks _tjClickTs and only navigates when it increases.
  # The browser tracks _tjCursorTs and only highlights when it increases.
  # This prevents both sides from acting on events they themselves wrote.
  class CursorServlet < WEBrick::HTTPServlet::AbstractServlet

    # Protects concurrent POST read-modify-write sequences.
    @@post_mutex = Mutex.new

    # All active SSE writer ends; guarded by @@writers_mutex.
    @@writers       = []
    @@writers_mutex = Mutex.new

    # The single shared watcher thread (started once, never restarted).
    @@watcher_thread = nil

    def initialize(config, options)
      super
      @cursorFile = options[0]
    end

    def self.get_instance(config, options)
      new(config, options)
    end

    # SSE stream: watch tj-cursor.js and push cursor-pipe changes to the browser.
    # Registers the writer end of an IO pipe; the class-level watcher broadcasts
    # to all registered writers so only one inotifywait/fswatch process is needed
    # regardless of how many SSE connections are open.
    def do_GET(req, res)
      res['Content-Type']      = 'text/event-stream'
      res['Cache-Control']     = 'no-cache'
      res['X-Accel-Buffering'] = 'no'

      rd, wr = IO.pipe
      res.body = rd

      @@writers_mutex.synchronize { @@writers << wr }

      # Start the shared watcher the first time a client connects.
      @@writers_mutex.synchronize do
        if @@watcher_thread.nil? || !@@watcher_thread.alive?
          @@watcher_thread = self.class.start_watcher(@cursorFile)
        end
      end
    end

    # Write a clicked task ID into the browser pipe of tj-cursor.js.
    # Serialised with @@post_mutex so concurrent POSTs don't clobber each other.
    def do_POST(req, res)
      begin
        body = JSON.parse(req.body.to_s)
      rescue JSON::ParserError
        res.status = 400
        res['Content-Type'] = 'text/plain'
        res.body = 'Bad JSON'
        return
      end

      task_id  = body['id'].to_s
      click_ts = Time.now.to_i

      @@post_mutex.synchronize do
        current      = (File.read(@cursorFile) rescue '')
        cursor_id    = parse_field(current, '_tjCursorTaskId')
        cursor_id_js = cursor_id ? cursor_id.inspect : 'null'
        cursor_ts    = parse_field(current, '_tjCursorTs')&.to_i || 0

        content = "window._tjCursorTaskId = #{cursor_id_js};\n"   \
                  "window._tjCursorTs     = #{cursor_ts};\n"        \
                  "window._tjClickTaskId  = #{task_id.inspect};\n"  \
                  "window._tjClickTs      = #{click_ts};\n"

        # Atomic write via rename so neither the editor nor the SSE watcher
        # ever reads a partially-written file.
        tmp = @cursorFile + '.tmp'
        File.write(tmp, content)
        File.rename(tmp, @cursorFile)
      end

      res.status = 200
      res['Content-Type'] = 'application/json'
      res.body = '{"ok":true}'
    end

    # Spawns (once) the shared file-watcher thread that broadcasts cursor events
    # to every registered writer.  Returns the Thread.
    def self.start_watcher(cursor_file)
      Thread.new do
        begin
          watcher_loop(cursor_file)
        rescue => e
          # Watcher died unexpectedly — will be restarted on next GET.
          $stderr.puts "CursorServlet watcher error: #{e}"
        end
      end
    end

    private

    # Class-level watcher loop: runs once and fans out to all registered writers.
    def self.watcher_loop(cursor_file)
      dir  = File.dirname(File.expand_path(cursor_file))
      base = File.basename(cursor_file)

      if tool_available?('inotifywait')
        IO.popen(['inotifywait', '-m', '-q',
                  '-e', 'close_write,moved_to',
                  '--format', '%f', dir]) do |io|
          io.each_line do |name|
            broadcast(cursor_file) if name.chomp == base
          end
        end

      elsif tool_available?('fswatch')
        IO.popen(['fswatch', File.expand_path(cursor_file)]) do |io|
          io.each_line { broadcast(cursor_file) }
        end

      else
        last_mtime = nil
        loop do
          mtime = (File.mtime(cursor_file) rescue nil)
          if mtime && mtime != last_mtime
            last_mtime = mtime
            broadcast(cursor_file)
          end
          sleep 0.1
        end
      end
    end

    # Sends a cursor SSE event to every registered writer, pruning dead ones.
    def self.broadcast(cursor_file)
      content   = (File.read(cursor_file) rescue '')
      cursor_id = parse_field_s(content, '_tjCursorTaskId')
      cursor_ts = parse_field_s(content, '_tjCursorTs')&.to_i || 0
      payload   = JSON.generate({ 'cursorId' => cursor_id, 'cursorTs' => cursor_ts })
      event     = "event: cursor\ndata: #{payload}\n\n"

      @@writers_mutex.synchronize do
        @@writers.reject! do |wr|
          begin
            wr.write(event)
            false
          rescue Errno::EPIPE, IOError
            wr.close rescue nil
            true   # prune this writer
          end
        end
      end
    end

    # Extract the JS-assigned value for +name+ from the file content.
    # Handles string values ("foo.bar") and integer values (1234567890).
    # Returns a Ruby String in both cases, or nil if not found.
    def self.parse_field_s(content, name)
      pattern = /window\.#{Regexp.escape(name)}\s*=\s*/
      if (m = content.match(/#{pattern}"([^"]*)"/))
        return m[1]
      end
      if (m = content.match(/#{pattern}(\d+)/))
        return m[1]
      end
      nil
    end

    def parse_field(content, name)
      self.class.parse_field_s(content, name)
    end

    def self.tool_available?(name)
      system('which', name, out: File::NULL, err: File::NULL)
    end

  end

end
