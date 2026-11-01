#!/usr/bin/env bash
# Inside the container: print a log the test script wrote, so the host keeps a copy.
cat "/w/logs/$LOG"
