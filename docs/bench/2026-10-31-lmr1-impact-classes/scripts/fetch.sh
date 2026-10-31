#!/bin/sh
# Download OSV's npm and Packagist bulk exports into /w/osv (network on, no credentials, every capability dropped).
# Writes /w/osv/fetch.json: per zip its URL, UTC time fetched, HTTP Last-Modified, bytes and sha256.
set -eu
mkdir -p /w/osv
node /scripts/fetch.mjs /w/osv
