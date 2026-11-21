#!/usr/bin/env bash
# Full QA run: build -> API tests -> browser tests -> report.  Usage: npm test
set -u
cd "$(dirname "$0")/.."
rm -rf tests/.artifacts && mkdir -p tests/.artifacts
node tests/support/build.mjs || exit 1
echo "▶ API tests"
node --test --test-reporter=spec --test-reporter-destination=stdout \
     --test-reporter=junit --test-reporter-destination=tests/.artifacts/api.xml tests/api.test.mjs
echo "▶ Browser tests"
python3 -m pytest tests/e2e -q -p no:cacheprovider --junitxml=tests/.artifacts/e2e.xml -o junit_family=xunit2
echo "▶ Report"
python3 tests/report.py > tests/.artifacts/summary.md
status=$?
cat tests/.artifacts/summary.md | head -20
echo "full report: tests/reports/latest.html"
exit $status
