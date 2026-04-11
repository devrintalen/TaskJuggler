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

    def initialize(config, options)
      super
      @cursorFile = options[0]
    end

    def self.get_instance(config, options)
      self.new(config, options)
    end

    # SSE stream: watch tj-cursor.js and push cursor-pipe changes to the browser.
    def do_GET(req, res)
      res['Content-Type']      = 'text/event-stream'
      res['Cache-Control']     = 'no-cache'
      res['X-Accel-Buffering'] = 'no'   # prevent proxy/nginx buffering

      rd, wr = IO.pipe
      res.body = rd   # WEBrick reads from rd and streams bytes to the client

      Thread.new do
        begin
          watch_loop(wr)
        rescue Errno::EPIPE, IOError
          # Client disconnected — exit cleanly
        ensure
          wr.close
        end
      end
    end

    # Write a clicked task ID into the browser pipe of tj-cursor.js.
    # Reads the current file first so the editor pipe fields are preserved;
    # this keeps _tjCursorTs unchanged so the SSE watcher does not trigger
    # a spurious highlight update in the browser.
    def do_POST(req, res)
      begin
        body = JSON.parse(req.body.to_s)
      rescue JSON::ParserError
        res.status = 400
        res['Content-Type'] = 'text/plain'
        res.body = 'Bad JSON'
        return
      end

      current      = File.read(@cursorFile) rescue ''
      cursor_id    = parse_field(current, '_tjCursorTaskId')
      cursor_id_js = cursor_id ? cursor_id.inspect : 'null'
      cursor_ts    = parse_field(current, '_tjCursorTs')&.to_i || 0

      task_id  = body['id'].to_s
      click_ts = Time.now.to_i

      content = "window._tjCursorTaskId = #{cursor_id_js};\n"      \
                "window._tjCursorTs     = #{cursor_ts};\n"           \
                "window._tjClickTaskId  = #{task_id.inspect};\n"     \
                "window._tjClickTs      = #{click_ts};\n"

      # Atomic write via rename so neither the editor nor the SSE watcher
      # ever reads a partially-written file.
      tmp = @cursorFile + '.tmp'
      File.write(tmp, content)
      File.rename(tmp, @cursorFile)

      res.status = 200
      res['Content-Type'] = 'application/json'
      res.body = '{"ok":true}'
    end

    private

    # Watch @cursorFile for changes and push an SSE event to +wr+ on each
    # change.  Uses kernel-level file notifications where available; falls
    # back to 100 ms mtime polling on all other platforms.
    #
    # Priority:
    #   1. inotifywait (Linux, inotify-tools)  -- kernel push, zero CPU
    #   2. fswatch     (macOS/Linux, fswatch)   -- kernel push, zero CPU
    #   3. mtime poll  (100 ms)                 -- universal fallback
    def watch_loop(wr)
      dir  = File.dirname(File.expand_path(@cursorFile))
      base = File.basename(@cursorFile)

      if tool_available?('inotifywait')
        # -m : monitor continuously  -q : no startup banner
        # -e close_write,moved_to : covers both in-place writes and atomic renames
        # --format %f : print only the changed filename
        IO.popen(['inotifywait', '-m', '-q',
                  '-e', 'close_write,moved_to',
                  '--format', '%f', dir]) do |io|
          io.each_line do |name|
            push_cursor_event(wr) if name.chomp == base
          end
        end

      elsif tool_available?('fswatch')
        IO.popen(['fswatch', File.expand_path(@cursorFile)]) do |io|
          io.each_line { push_cursor_event(wr) }
        end

      else
        last_mtime = nil
        loop do
          mtime = File.mtime(@cursorFile) rescue nil
          if mtime && mtime != last_mtime
            last_mtime = mtime
            push_cursor_event(wr)
          end
          sleep 0.1
        end
      end
    end

    def push_cursor_event(wr)
      content   = File.read(@cursorFile) rescue ''
      cursor_id = parse_field(content, '_tjCursorTaskId')
      cursor_ts = parse_field(content, '_tjCursorTs')&.to_i || 0
      payload   = JSON.generate({ 'cursorId' => cursor_id, 'cursorTs' => cursor_ts })
      wr.write("event: cursor\ndata: #{payload}\n\n")
    end

    # Extract the JS-assigned value for +name+ from the file content.
    # Handles string values ("foo.bar") and integer values (1234567890).
    # Returns a Ruby String in both cases, or nil if not found.
    def parse_field(content, name)
      pattern = /window\.#{Regexp.escape(name)}\s*=\s*/
      # String value: window._tjXxx = "value";
      if (m = content.match(/#{pattern}"([^"]*)"/))
        return m[1]
      end
      # Integer value: window._tjXxx = 123;
      if (m = content.match(/#{pattern}(\d+)/))
        return m[1]
      end
      nil
    end

    def tool_available?(name)
      system("which #{name} > /dev/null 2>&1")
    end

  end

end
