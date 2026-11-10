#!/usr/bin/env bash
# Proves the PayPal sandbox rails by hand before trusting the app code:
#   token → create AUTHORIZE order ($1.00) → PM approves in browser → authorize → capture → payout ($0.50) → poll batch.
# Usage: scripts/paypal-smoke.sh [contractor-sandbox-email]
# Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (and optionally CONTRACTOR_EMAIL, PAYPAL_ENV) from the environment or .env.local.
# Sandbox only. Never prints the access token.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi

CONTRACTOR_EMAIL="${1:-${CONTRACTOR_EMAIL:-${CONTRACTOR_EMAIL_MIKE:-}}}"
: "${PAYPAL_CLIENT_ID:?PAYPAL_CLIENT_ID is required (sandbox REST app on the platform business account)}"
: "${PAYPAL_CLIENT_SECRET:?PAYPAL_CLIENT_SECRET is required}"
if [ -z "$CONTRACTOR_EMAIL" ]; then echo "usage: $0 <contractor-sandbox-personal-email>   (or set CONTRACTOR_EMAIL)"; exit 2; fi
if [ "${PAYPAL_ENV:-sandbox}" != "sandbox" ]; then echo "Refusing to run: PAYPAL_ENV=$PAYPAL_ENV. This script moves money and is sandbox-only."; exit 2; fi

BASE="https://api-m.sandbox.paypal.com"
RUN="smoke-$(date +%s)"
CODE_FILE="$(mktemp)"; trap 'rm -f "$CODE_FILE"' EXIT
# api() runs inside $(...), a subshell, so the status code goes through a file rather than a variable.
http_code() { cat "$CODE_FILE"; }

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; exit 1; }
warn() { printf 'WARN  %s\n' "$1"; }

if command -v jq >/dev/null 2>&1; then
  jget() { jq -r "$1" ; }
else
  jget() { python3 -I -c 'import json,sys
path=sys.argv[1]; data=json.load(sys.stdin)
# minimal jq-like path: .a.b[0].c  and  .links[] | select(.rel=="x") | .href
if "|" in path:
    arr, sel, leaf = [p.strip() for p in path.split("|")]
    key=arr.strip(".").rstrip("[]"); rel=sel.split("==")[1].strip(")").strip("\"")
    out=[l.get(leaf.strip(".")) for l in data.get(key,[]) if l.get("rel")==rel]
    print(out[0] if out else "null"); sys.exit(0)
cur=data
for part in [p for p in path.strip(".").replace("]","").split(".") if p]:
    if "[" in part:
        k,i=part.split("["); cur=cur.get(k,[])
        cur=cur[int(i)] if isinstance(cur,list) and len(cur)>int(i) else None
    else:
        cur=cur.get(part) if isinstance(cur,dict) else None
    if cur is None: break
print("null" if cur is None else (json.dumps(cur) if isinstance(cur,(dict,list)) else cur))' "$1"; }
fi

# api METHOD PATH [JSON_BODY] [REQUEST_ID]  → prints body, sets HTTP_CODE
api() {
  local method="$1" path="$2" body="${3:-}" rid="${4:-}" out code
  local -a args=(-sS -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Prefer: return=representation" -w $'\n%{http_code}')
  if [ -n "$rid" ]; then args+=(-H "PayPal-Request-Id: $rid"); fi
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  out="$(curl "${args[@]}")"
  code="${out##*$'\n'}"; printf '%s' "$code" > "$CODE_FILE"
  printf '%s' "${out%$'\n'*}"
}

echo "Punchlist Pay · PayPal sandbox smoke · run $RUN"
echo "Contractor payout receiver: $CONTRACTOR_EMAIL"
echo

# 1. OAuth token (never echoed)
TOKEN="$(curl -sS -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials -H "Accept: application/json" "$BASE/v1/oauth2/token" | jget '.access_token')"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then fail "1 token: OAuth failed. Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET belong to a SANDBOX REST app."; fi
pass "1 token: client-credentials OAuth ok"

# 2. Create order, intent AUTHORIZE, $1.00
ORDER_BODY=$(cat <<JSON
{"intent":"AUTHORIZE","purchase_units":[{"reference_id":"$RUN","custom_id":"$RUN","description":"Punchlist Pay smoke test","amount":{"currency_code":"USD","value":"1.00"}}],
 "payment_source":{"paypal":{"experience_context":{"brand_name":"Punchlist Pay","user_action":"PAY_NOW","shipping_preference":"NO_SHIPPING","return_url":"${APP_URL:-http://localhost:3000}/dashboard?fixture=0","cancel_url":"${APP_URL:-http://localhost:3000}/dashboard?fixture=0"}}}}
JSON
)
ORDER_RES="$(api POST /v2/checkout/orders "$ORDER_BODY" "$RUN:order")"
ORDER_ID="$(printf '%s' "$ORDER_RES" | jget '.id')"
if [ "$(http_code)" != "201" ] && [ "$(http_code)" != "200" ] || [ -z "$ORDER_ID" ] || [ "$ORDER_ID" = "null" ]; then
  echo "$ORDER_RES" | head -c 600; echo; fail "2 create order: HTTP $(http_code)"; fi
APPROVE_URL="$(printf '%s' "$ORDER_RES" | jget '.links[] | select(.rel=="payer-action") | .href')"
if [ -z "$APPROVE_URL" ] || [ "$APPROVE_URL" = "null" ]; then APPROVE_URL="$(printf '%s' "$ORDER_RES" | jget '.links[] | select(.rel=="approve") | .href')"; fi
if [ -z "$APPROVE_URL" ] || [ "$APPROVE_URL" = "null" ]; then APPROVE_URL="https://www.sandbox.paypal.com/checkoutnow?token=$ORDER_ID"; fi
pass "2 create order: $ORDER_ID (status $(printf '%s' "$ORDER_RES" | jget '.status'))"

echo
echo "  Open this link in a browser and log in as the PM *payer* sandbox account (not the platform account):"
echo "  $APPROVE_URL"
echo
read -r -p "  Press Enter after you have approved the payment (PAY_NOW) ... " _

# 3. Authorize
AUTH_RES="$(api POST "/v2/checkout/orders/$ORDER_ID/authorize" '{}' "$RUN:authorize")"
AUTH_ID="$(printf '%s' "$AUTH_RES" | jget '.purchase_units[0].payments.authorizations[0].id')"
if [ -z "$AUTH_ID" ] || [ "$AUTH_ID" = "null" ]; then echo "$AUTH_RES" | head -c 600; echo; fail "3 authorize: HTTP $(http_code) (did the PM approve the order?)"; fi
pass "3 authorize: authorization $AUTH_ID (status $(printf '%s' "$AUTH_RES" | jget '.purchase_units[0].payments.authorizations[0].status'))"

# 4. Capture the full authorization
CAP_RES="$(api POST "/v2/payments/authorizations/$AUTH_ID/capture" '{"final_capture":true}' "$RUN:capture")"
CAP_ID="$(printf '%s' "$CAP_RES" | jget '.id')"
CAP_STATUS="$(printf '%s' "$CAP_RES" | jget '.status')"
if [ -z "$CAP_ID" ] || [ "$CAP_ID" = "null" ]; then echo "$CAP_RES" | head -c 600; echo; fail "4 capture: HTTP $(http_code)"; fi
case "$CAP_STATUS" in
  COMPLETED) pass "4 capture: $CAP_ID COMPLETED" ;;
  PENDING)   warn "4 capture: $CAP_ID PENDING (sandbox sometimes settles later; proceeding)" ;;
  *)         fail "4 capture: $CAP_ID status $CAP_STATUS" ;;
esac

# 5. Payout $0.50 to the contractor
PAYOUT_BODY=$(cat <<JSON
{"sender_batch_header":{"sender_batch_id":"$RUN:payout","email_subject":"Punchlist Pay payout","email_message":"Smoke test payout from Punchlist Pay"},
 "items":[{"recipient_type":"EMAIL","receiver":"$CONTRACTOR_EMAIL","amount":{"value":"0.50","currency":"USD"},"note":"Punchlist Pay smoke $RUN","sender_item_id":"$RUN:payout"}]}
JSON
)
PAYOUT_RES="$(api POST /v1/payments/payouts "$PAYOUT_BODY" "$RUN:payout")"
BATCH_ID="$(printf '%s' "$PAYOUT_RES" | jget '.batch_header.payout_batch_id')"
if [ -z "$BATCH_ID" ] || [ "$BATCH_ID" = "null" ]; then echo "$PAYOUT_RES" | head -c 600; echo; fail "5 payout: HTTP $(http_code) (is Payouts enabled on the sandbox business account?)"; fi
pass "5 payout: batch $BATCH_ID (batch_status $(printf '%s' "$PAYOUT_RES" | jget '.batch_header.batch_status'))"

# 6. Poll the batch up to 10 times
FINAL=""
for i in $(seq 1 10); do
  sleep 3
  BATCH_RES="$(api GET "/v1/payments/payouts/$BATCH_ID")"
  BATCH_STATUS="$(printf '%s' "$BATCH_RES" | jget '.batch_header.batch_status')"
  ITEM_STATUS="$(printf '%s' "$BATCH_RES" | jget '.items[0].transaction_status')"
  ITEM_ID="$(printf '%s' "$BATCH_RES" | jget '.items[0].payout_item_id')"
  echo "      poll $i: batch=$BATCH_STATUS item=$ITEM_STATUS"
  case "$ITEM_STATUS" in
    SUCCESS) FINAL="paid"; break ;;
    FAILED|RETURNED|BLOCKED|REFUNDED|REVERSED|CANCELED) FINAL="failed"; break ;;
  esac
  case "$BATCH_STATUS" in DENIED|CANCELED) FINAL="failed"; break ;; esac
done
case "$FINAL" in
  paid)   pass "6 payout status: item $ITEM_ID SUCCESS → check $CONTRACTOR_EMAIL's sandbox balance (+\$0.50)" ;;
  failed) fail "6 payout status: item $ITEM_ID ended $ITEM_STATUS / batch $BATCH_STATUS" ;;
  *)      warn "6 payout status: still $ITEM_STATUS after 10 polls (UNCLAIMED means the receiver email has no sandbox account; PENDING usually clears within a minute)" ;;
esac

echo
echo "Summary  order=$ORDER_ID auth=$AUTH_ID capture=$CAP_ID payout_batch=$BATCH_ID payout_item=${ITEM_ID:-?}"
echo "Rails proven: Orders v2 AUTHORIZE → approve → authorize → Payments v2 capture → Payouts v1. Idempotency via PayPal-Request-Id ($RUN:*) and sender_batch_id."
