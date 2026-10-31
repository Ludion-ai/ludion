#!/bin/sh
# Every CWE id in the two zips with its record count (network none). Used to write the mapping table.
set -eu
node /scripts/explore.mjs /w/osv/npm.zip /w/osv/Packagist.zip
