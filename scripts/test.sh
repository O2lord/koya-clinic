#!/usr/bin/env bash
# Usage: BASE=http://localhost:3000 KEY=your-api-key ./scripts/test.sh
# Runs every level against a running server. It calls /reset, so it wipes data.
BASE="${BASE:-http://localhost:3000}"
KEY="${KEY:?set KEY to your API key}"
pass=0; fail=0

req() { curl -s -w '\n%{http_code}' -H "X-API-Key: $KEY" -H 'Content-Type: application/json' "$@"; }
code() { tail -n1 <<<"$1"; }
body() { sed '$d' <<<"$1"; }
check() { # name expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1 (expected $2, got $3)"; fi
}
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }

FUTURE="2030-01-01T09:00:00Z"; FUTURE_END="2030-01-01T09:30:00Z"
PAST="2020-01-01T09:00:00Z";   PAST_END="2020-01-01T09:30:00Z"
SLOTS='{"slots":[
 {"id":"s1","provider":"Dr Ade","start":"'$FUTURE'","end":"'$FUTURE_END'"},
 {"id":"s2","provider":"Dr Ade","start":"2030-01-01T10:00:00Z","end":"2030-01-01T10:30:00Z"},
 {"id":"s3","provider":"Dr Bola","start":"2030-01-01T08:00:00Z","end":"2030-01-01T08:30:00Z"},
 {"id":"s4","provider":"Dr Bola","start":"2030-01-02T08:00:00Z","end":"2030-01-02T08:30:00Z"},
 {"id":"s5","provider":"Dr Bola","start":"2030-01-03T08:00:00Z","end":"2030-01-03T08:30:00Z"},
 {"id":"s6","provider":"Dr Cole","start":"2030-01-04T08:00:00Z","end":"2030-01-04T08:30:00Z"},
 {"id":"s7","provider":"Dr Cole","start":"2030-01-05T08:00:00Z","end":"2030-01-05T08:30:00Z"},
 {"id":"s8","provider":"Dr Cole","start":"2030-01-06T08:00:00Z","end":"2030-01-06T08:30:00Z"},
 {"id":"past","provider":"Dr Ade","start":"'$PAST'","end":"'$PAST_END'"}]}'

echo "== Level 2: API key"
r=$(curl -s -w '\n%{http_code}' "$BASE/slots"); check "no key -> 401" 401 "$(code "$r")"
r=$(curl -s -w '\n%{http_code}' -H 'X-API-Key: wrong' "$BASE/slots"); check "wrong key -> 401" 401 "$(code "$r")"

echo "== Level 1: reset, list, book, lookup"
r=$(req -X POST "$BASE/reset" -d "$SLOTS"); check "reset 200" 200 "$(code "$r")"
r=$(req "$BASE/slots"); check "list 200" 200 "$(code "$r")"
check "slots sorted by start" "past s3 s1 s2 s4 s5 s6 s7 s8" "$(body "$r" | python3 -c "import sys,json; print(' '.join(s['id'] for s in json.load(sys.stdin)['slots']))")"
r=$(req "$BASE/slots?provider=Dr%20Bola"); check "provider filter" 3 "$(body "$r" | jget "['slots'].__len__()")"
r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"s1","name":"  Ada Obi ","email":" ADA@Example.com "}')
check "book 201" 201 "$(code "$r")"
ID=$(body "$r" | jget "['id']")
check "email lowercased" "ada@example.com" "$(body "$r" | jget "['email']")"
check "name trimmed" "Ada Obi" "$(body "$r" | jget "['name']")"
check "status confirmed" confirmed "$(body "$r" | jget "['status']")"
r=$(req "$BASE/bookings/$ID"); check "lookup 200" 200 "$(code "$r")"
r=$(req "$BASE/bookings/nope"); check "lookup missing 404" 404 "$(code "$r")"
r=$(req "$BASE/slots"); check "s1 unavailable" False "$(body "$r" | python3 -c "import sys,json; print([s for s in json.load(sys.stdin)['slots'] if s['id']=='s1'][0]['available'])")"

echo "== Level 2: validation"
for payload in '{"name":"A","email":"a@b.co"}' '{"slot_id":"s2","name":"","email":"a@b.co"}' '{"slot_id":"s2","name":"A","email":"not-an-email"}' '{"slot_id":"s2","name":"   ","email":"a@b.co"}'; do
  r=$(req -X POST "$BASE/bookings" -d "$payload"); check "invalid -> 400" 400 "$(code "$r")"
done
r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"zzz","name":"A","email":"v1@b.co"}'); check "unknown slot -> 404" 404 "$(code "$r")"
r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"past","name":"A","email":"v2@b.co"}'); check "past slot -> 400" 400 "$(code "$r")"

echo "== Level 3: double booking and cancel"
r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"s1","name":"B","email":"b@b.co"}'); check "taken -> 409" 409 "$(code "$r")"
r=$(req -X DELETE "$BASE/bookings/$ID"); check "cancel 200" 200 "$(code "$r")"
check "cancelled status" cancelled "$(body "$r" | jget "['status']")"
r=$(req -X DELETE "$BASE/bookings/$ID"); check "cancel again -> 409" 409 "$(code "$r")"
r=$(req -X DELETE "$BASE/bookings/nope"); check "cancel missing -> 404" 404 "$(code "$r")"
r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"s1","name":"B","email":"b@b.co"}'); check "rebook freed slot 201" 201 "$(code "$r")"

echo "== Level 3: 20 simultaneous requests for one slot"
tmp=$(mktemp -d)
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
    -X POST "$BASE/bookings" -d "{\"slot_id\":\"s2\",\"name\":\"T$i\",\"email\":\"race$i@x.co\"}" > "$tmp/$i" &
done; wait
check "exactly one 201" 1 "$(cat "$tmp"/* | grep -c 201)"
check "nineteen 409" 19 "$(cat "$tmp"/* | grep -c 409)"
rm -rf "$tmp"

echo "== Level 4: idempotency"
b='{"slot_id":"s3","name":"Idem","email":"idem@x.co"}'
r1=$(req -X POST "$BASE/bookings" -H 'Idempotency-Key: k-1' -d "$b")
r2=$(req -X POST "$BASE/bookings" -H 'Idempotency-Key: k-1' -d "$b")
check "first 201" 201 "$(code "$r1")"; check "replay same status" 201 "$(code "$r2")"
check "replay same id" "$(body "$r1" | jget "['id']")" "$(body "$r2" | jget "['id']")"
r=$(req -X POST "$BASE/bookings" -H 'Idempotency-Key: k-1' -d '{"slot_id":"s3","name":"Other","email":"idem@x.co"}')
check "same key, different body -> 422" 422 "$(code "$r")"
r=$(req "$BASE/bookings?email=IDEM@x.co"); check "only one booking made" 1 "$(body "$r" | jget "['bookings'].__len__()")"
tmp=$(mktemp -d)
for i in $(seq 1 10); do
  curl -s -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -H 'Idempotency-Key: k-2' \
    -X POST "$BASE/bookings" -d '{"slot_id":"s4","name":"Par","email":"par@x.co"}' > "$tmp/$i" &
done; wait
check "10 parallel same-key -> one booking id" 1 "$(cat "$tmp"/* | python3 -c "import sys,re; print(len(set(re.findall(r'\"id\":\"([^\"]+)\"', sys.stdin.read()))))")"
rm -rf "$tmp"

echo "== Level 4: paging"
r=$(req "$BASE/bookings?email=b@b.co&limit=0"); check "limit 0 -> 400" 400 "$(code "$r")"
r=$(req "$BASE/bookings?email=b@b.co&limit=51"); check "limit 51 -> 400" 400 "$(code "$r")"
r=$(req "$BASE/bookings?email=b@b.co&limit=abc"); check "limit abc -> 400" 400 "$(code "$r")"
# Three bookings for one person, made in order s6, s7, s8
ids=""
for s in s6 s7 s8; do
  r=$(req -X POST "$BASE/bookings" -d "{\"slot_id\":\"$s\",\"name\":\"Pager\",\"email\":\"Pager@x.co\"}")
  ids="$ids $(body "$r" | jget "['id']")"
done
ids=$(echo $ids)
r=$(req "$BASE/bookings?email=PAGER@x.co&limit=2")
check "page 1 has 2" 2 "$(body "$r" | jget "['bookings'].__len__()")"
check "page 1 has next_cursor" True "$(body "$r" | jget "['next_cursor'] is not None")"
p1=$(body "$r" | jget "['bookings'][0]['id'] + ' ' + d['bookings'][1]['id']")
CUR=$(body "$r" | jget "['next_cursor']")
r=$(req "$BASE/bookings?email=pager@x.co&limit=2&cursor=$CUR")
check "page 2 has 1" 1 "$(body "$r" | jget "['bookings'].__len__()")"
check "last page cursor null" True "$(body "$r" | jget "['next_cursor'] is None")"
p2=$(body "$r" | jget "['bookings'][0]['id']")
check "oldest first, no repeats" "$ids" "$p1 $p2"
r=$(req "$BASE/bookings?email=pager@x.co")
check "default limit returns all 3" 3 "$(body "$r" | jget "['bookings'].__len__()")"
check "no cursor when all fit" True "$(body "$r" | jget "['next_cursor'] is None")"
r=$(req "$BASE/bookings?email=nobody@x.co")
check "unknown email -> empty list" 0 "$(body "$r" | jget "['bookings'].__len__()")"
r=$(req "$BASE/bookings"); check "missing email -> 400" 400 "$(code "$r")"

echo "== Level 5: rate limit"
codes=""
for i in 1 2 3 4 5 6; do
  r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"zzz","name":"A","email":"spam@x.co"}'); codes="$codes $(code "$r")"
done
check "5 attempts then 429" "404 404 404 404 404 429" "$(echo $codes)"
hdr=$(curl -s -D - -o /dev/null -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -X POST "$BASE/bookings" -d '{"slot_id":"zzz","name":"A","email":"spam@x.co"}' | grep -i '^retry-after' | tr -d '\r' | awk '{print $2}')
check "Retry-After is whole seconds" True "$([[ "$hdr" =~ ^[0-9]+$ ]] && echo True || echo False)"
r=$(req -X POST "$BASE/bookings" -d '{"slot_id":"zzz","name":"A","email":"other@x.co"}'); check "other email unaffected" 404 "$(code "$r")"

echo; echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
