# Quickstart: T078 — Master Key Rotation

**Target**: `supaviser.dev` (test VM at `ubuntu@148.113.1.164`)
**Duration**: ~5 minutes (no wall-clock wait)
**Prerequisites**: SSH access to the VM, a project already provisioned and running

## Step 1 — Dry-run (no writes)

```bash
# On the VM
cd /opt/selfbase
OLD=$(grep ^MASTER_KEY infra/.env | cut -d= -f2)
NEW=$(openssl rand -hex 32)
echo "NEW KEY: $NEW"   # save this

DRY_RUN=1 \
OLD_MASTER_KEY=$OLD \
NEW_MASTER_KEY=$NEW \
DATABASE_URL=$(grep ^DATABASE_URL infra/.env | cut -d= -f2) \
node scripts/rekey-master.mjs
```

Expected output: one `[rekey] <table>.<col>: N row(s) would be rotated` line per table with data, then `DRY-RUN complete`.

## Step 2 — Live re-key

```bash
OLD_MASTER_KEY=$OLD \
NEW_MASTER_KEY=$NEW \
DATABASE_URL=$(grep ^DATABASE_URL infra/.env | cut -d= -f2) \
node scripts/rekey-master.mjs
```

Expected final line: `[rekey] COMMITTED — N blob(s) rotated to new master key`

## Step 3 — Swap the key and restart

```bash
sed -i "s/^MASTER_KEY=.*/MASTER_KEY=$NEW/" infra/.env
sudo docker compose -f infra/docker-compose.yml restart api worker
```

Wait ~10 seconds for restart. Confirm with:

```bash
sudo docker compose -f infra/docker-compose.yml ps api worker
```

Both should show `Up`.

## Step 4 — Verify decryption (api-keys check)

```bash
# Get a project ref
REF=$(curl -sk -H "Authorization: Bearer <your-PAT>" https://api.supaviser.dev/v1/projects \
  | jq -r '.[0].ref')

# Confirm api-keys decrypt correctly with the new key
curl -sk -H "Authorization: Bearer <your-PAT>" \
  https://api.supaviser.dev/v1/projects/$REF/api-keys | jq .
```

Expected: `anon_key` and `service_role_key` present and non-empty.

## Step 5 — Pause/restore a project

```bash
PAT=<your-PAT>

# Pause
curl -sk -X POST -H "Authorization: Bearer $PAT" \
  https://api.supaviser.dev/v1/projects/$REF/pause | jq .status

# Wait for inactive
sleep 15

# Restore
curl -sk -X POST -H "Authorization: Bearer $PAT" \
  https://api.supaviser.dev/v1/projects/$REF/restore | jq .status

# Wait for active (check every 10s, up to 5 min)
for i in $(seq 1 30); do
  STATUS=$(curl -sk -H "Authorization: Bearer $PAT" \
    https://api.supaviser.dev/v1/projects/$REF | jq -r '.status')
  echo "$STATUS"
  [[ "$STATUS" == "ACTIVE_HEALTHY" ]] && break
  sleep 10
done
```

## Closing issue #54 T078

Paste the `[rekey] COMMITTED` line plus the final `ACTIVE_HEALTHY` confirmation as a comment on issue #54 and tick the T078 acceptance checkbox.
