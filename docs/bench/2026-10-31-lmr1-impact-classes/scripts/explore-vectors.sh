#!/bin/sh
# The CVSS vector shapes in the two zips (network none), read before LMR1c's vector rule was written.
set -eu
node /scripts/explore-vectors.mjs /w/osv/npm.zip /w/osv/Packagist.zip
