# ibr justfile

browser-install:
    npm run browser:install

test:
    npm test

test-watch:
    npm run test:watch

test-unit:
    npm run test:unit

test-integration:
    npm run test:integration

test-e2e:
    npm run test:e2e

test-e2e-fast:
    npm run test:e2e:fast

test-coverage:
    npm run test:coverage

judge-e2e:
    npm run judge:e2e

build:
    node scripts/build.mjs && node scripts/sea.mjs

build-bundle:
    node scripts/build.mjs

build-sea:
    node scripts/sea.mjs

bench *args:
    node bench/run.js {{args}}

bench-report *args:
    node bench/report.js {{args}}
