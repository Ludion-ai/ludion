set -e
cd /w
tar -xf /t/head.tar -C /w
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
node -e 'console.log("semver", require("/w/node_modules/semver/package.json").version)'
