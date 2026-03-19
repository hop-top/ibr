# 017 - Exit Code Contract

**Persona:** [Automated Workflow](../personas/automated-workflow.md)

## Goal

Predictable exit codes so orchestrators (cron, CI, Make) can branch on
success vs. failure without parsing output.

## Stories

- As an automated workflow, idx exits 0 on full success and non-zero on any
  unrecovered error, enabling `&&` chaining in shell scripts.
- As an automated workflow, I can distinguish fatal errors from soft warnings
  (e.g., loop cap hit) via exit code.

## Acceptance Criteria

- Exit 0: all instructions completed, extraction returned.
- Exit 1: any unrecovered runtime error (element not found, timeout, AI error).
- Exit 2: configuration error (missing key, unknown provider).
- Loop cap reached (soft): exit 0 with warning on stderr.
