#!/usr/bin/env bash
# bench/docker-run.sh — build ibr-bench image, run benchmark, copy results back
#
# Usage:
#   ./bench/docker-run.sh [--count N] [--concurrency C]
#
# Results are copied to bench/results/ after the run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE="ibr-bench:latest"
RESULTS_DIR="$SCRIPT_DIR/results"

# Forward all args to bench/run.js
BENCH_ARGS=("$@")

echo "==> Building Docker image $IMAGE"
docker build \
  -f "$SCRIPT_DIR/Dockerfile" \
  -t "$IMAGE" \
  "$ROOT"

mkdir -p "$RESULTS_DIR"

echo "==> Running benchmark (args: ${BENCH_ARGS[*]:-none})"
docker run --rm \
  -v "$RESULTS_DIR:/app/bench/results" \
  "$IMAGE" \
  "${BENCH_ARGS[@]}"

echo ""
echo "==> Results available in $RESULTS_DIR"
ls -lh "$RESULTS_DIR" | tail -5
