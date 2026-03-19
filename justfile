# idx justfile

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

test-coverage:
    npm run test:coverage
