#!/bin/bash
# Double-click in Finder to start PodEcho and open it in the browser (the same as `bin/podecho start`).
cd "$(dirname "$0")" && exec bin/podecho start
