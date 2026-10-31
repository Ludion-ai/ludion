#!/bin/sh
# Every npm record that names one package, with its class now (network none): sh run.sh package ua-parser-js.
set -eu
node /scripts/package.mjs /w/osv /src/packages/cli/src/security/impact.ts "$1"
