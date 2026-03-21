# Automated Workflow

## Description

Scheduled or event-driven process (cron job, CI step, n8n node, Make scenario,
etc.) running ibr unattended. Cares about reliable exit codes, idempotent
execution, timeout control, and no dependency on a display server.

## Stories

- [014 - Headless Execution](../stories/014-headless-execution.md)
- [017 - Exit Code Contract](../stories/017-exit-code-contract.md)
- [018 - Execution Timeout](../stories/018-execution-timeout.md)
