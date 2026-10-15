#!/usr/bin/env node
// Writes docs/fa4/FIELD_COVERAGE_MATRIX.md from the compiled engine (run `npm run build --workspace=shared/fa-public-engine` first).
const fs = require('node:fs'); const path = require('node:path');
const { renderCoverageMarkdown } = require('../shared/fa-public-engine/dist/cjs/index.js');
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'fa4', 'FIELD_COVERAGE_MATRIX.md'), renderCoverageMarkdown());
console.log('wrote docs/fa4/FIELD_COVERAGE_MATRIX.md');
