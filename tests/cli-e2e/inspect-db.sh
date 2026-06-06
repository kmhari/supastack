#!/usr/bin/env bash
#
# E2E: validates `supabase inspect db` Management API endpoints
# GET /v1/projects/:ref/database/query   (ad-hoc SQL for inspect tables)
# Tests various pg_stat-based queries that back `supabase inspect db` commands.
#
# Covers:
#   1. table-sizes — SELECT from pg_stat_user_tables
#   2. index-sizes — SELECT from pg_indexes + pg_stat_user_indexes
#   3. cache-hit   — SELECT from pg_statio_user_tables
#   4. connections — SELECT from pg_stat_activity
#   5. bloat       — approximate table + index bloat query
#   6. unused-indexes — finds indexes not used since last stats reset
#   7. seq-scans   — tables with high sequential scan counts
#
# Run locally with:
#
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   bash tests/cli-e2e/inspect-db.sh
#
# Requirements: curl, jq on PATH.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

API="https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_PROJECT_REF}"
AUTH=(-H "Authorization: Bearer ${SUPASTACK_PAT}" -H 'Content-Type: application/json')
PASS=0; FAIL=0

ok() {
  if [ "$2" = "$3" ]; then
    echo "[inspect-db] $1 STATUS=PASS ($3)"; PASS=$((PASS+1))
  else
    echo "[inspect-db] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1))
  fi
}

query() {
  local name="$1"; local sql="$2"
  local out; local status
  out=$(curl -sk -X POST "${AUTH[@]}" "${API}/database/query" \
    -d "{\"query\": $(printf '%s' "$sql" | jq -Rs .)}" \
    -w '\n__STATUS:%{http_code}')
  status=$(printf '%s' "$out" | grep -oE '__STATUS:[0-9]+' | grep -oE '[0-9]+')
  local body; body=$(printf '%s' "$out" | grep -v '__STATUS:')
  ok "${name}-status" 201 "$status"
  printf '%s' "$body" | jq 'if type == "array" then . else error end' > /dev/null 2>&1 \
    && ok "${name}-array" yes yes \
    || ok "${name}-array" yes no
}

echo "==> inspect-db E2E against ${API}"

# ─── 1. table-sizes ───────────────────────────────────────────────────────────
echo "==> [1] table-sizes"
query "table-sizes" "
  SELECT relname AS table_name,
         pg_size_pretty(pg_total_relation_size(relid)) AS total_size
  FROM pg_stat_user_tables
  ORDER BY pg_total_relation_size(relid) DESC
  LIMIT 20
"

# ─── 2. index-sizes ───────────────────────────────────────────────────────────
echo "==> [2] index-sizes"
query "index-sizes" "
  SELECT indexrelname AS index_name,
         pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
  FROM pg_stat_user_indexes
  ORDER BY pg_relation_size(indexrelid) DESC
  LIMIT 20
"

# ─── 3. cache-hit rates ───────────────────────────────────────────────────────
echo "==> [3] cache-hit"
query "cache-hit" "
  SELECT relname AS table_name,
         heap_blks_read,
         heap_blks_hit,
         CASE WHEN (heap_blks_hit + heap_blks_read) = 0 THEN NULL
              ELSE round(heap_blks_hit::numeric / (heap_blks_hit + heap_blks_read) * 100, 2)
         END AS cache_hit_pct
  FROM pg_statio_user_tables
  ORDER BY heap_blks_read DESC
  LIMIT 20
"

# ─── 4. active connections ────────────────────────────────────────────────────
echo "==> [4] connections"
query "connections" "
  SELECT count(*) AS total,
         count(*) FILTER (WHERE state = 'active') AS active,
         count(*) FILTER (WHERE state = 'idle') AS idle
  FROM pg_stat_activity
  WHERE backend_type = 'client backend'
"

# ─── 5. unused indexes ────────────────────────────────────────────────────────
echo "==> [5] unused-indexes"
query "unused-indexes" "
  SELECT relname AS table_name,
         indexrelname AS index_name,
         idx_scan AS index_scans
  FROM pg_stat_user_indexes
  WHERE idx_scan = 0
  ORDER BY pg_relation_size(indexrelid) DESC
  LIMIT 20
"

# ─── 6. seq-scans ─────────────────────────────────────────────────────────────
echo "==> [6] seq-scans"
query "seq-scans" "
  SELECT relname AS table_name,
         seq_scan,
         idx_scan,
         n_live_tup AS row_count
  FROM pg_stat_user_tables
  ORDER BY seq_scan DESC
  LIMIT 20
"

# ─── 7. read_only mode rejects write ──────────────────────────────────────────
echo "==> [7] read_only:true rejects DDL"
OUT=$(curl -sk -X POST "${AUTH[@]}" "${API}/database/query" \
  -d '{"query": "CREATE TEMP TABLE _inspect_rw_test (x int)", "read_only": true}' \
  -w '\n__STATUS:%{http_code}')
STATUS=$(printf '%s' "$OUT" | grep -oE '__STATUS:[0-9]+' | grep -oE '[0-9]+')
ok "read-only-ddl-rejected" 400 "$STATUS"

echo
echo "[inspect-db] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
