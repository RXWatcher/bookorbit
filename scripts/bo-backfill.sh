#!/bin/sh
# Drain the catalog-detail backfill for one media type.
#   usage: bo-backfill.sh audiobooks|ebooks
#
# Reuses its access token. The first version re-logged in every batch, and
# since a batch takes ~4s that hit the login endpoint's 5-per-minute throttle
# and the drain shot itself in the head after three batches. Tokens last 15
# minutes, so it refreshes on a schedule and on an auth failure instead.
#
# Stops on `stalled` — details fetched but no item gained a facet means
# something is silently dropping the data, and continuing would hide it.
MEDIA=${1:-audiobooks}
LOG=/var/log/bo-backfill.log
API=http://127.0.0.1:3000
MAX_STALLS=8               # consecutive barren batches before giving up
REFRESH_AFTER=100          # batches per token; ~7 min at 4s/batch, well inside 15
login() {
  curl -s --max-time 20 -X POST "$API/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"Amsterdam123!"}' \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}
TOK=$(login); N=0; STALLS=0
[ -z "$TOK" ] && { echo "$(date -Is) [$MEDIA] initial login failed" >> "$LOG"; exit 1; }
echo "$(date -Is) [$MEDIA] backfill starting" >> "$LOG"
while : ; do
  if [ "$N" -ge "$REFRESH_AFTER" ]; then
    sleep 15                                   # stay clear of the login throttle
    NEW=$(login); [ -n "$NEW" ] && { TOK=$NEW; N=0; }
  fi
  R=$(curl -s --max-time 900 -X POST -H "Authorization: Bearer $TOK" \
      "$API/api/v1/admin/warehouse/catalog-detail-backfill/$MEDIA?limit=200")
  N=$((N+1))
  case "$R" in
    *'"stalled":true'*)    STALLS=$((STALLS+1))
                           echo "$(date -Is) [$MEDIA] $R (stall $STALLS/$MAX_STALLS)" >> "$LOG"
                           # One barren batch is not a fault. Ebook genre
                           # coverage upstream is sparse — roughly one in eight
                           # carries any — so 200 consecutive items with
                           # nothing to add is ordinary. Only a sustained run
                           # of them means something is being dropped.
                           if [ "$STALLS" -ge "$MAX_STALLS" ]; then
                             echo "$(date -Is) [$MEDIA] STALLED x$MAX_STALLS - stopping" >> "$LOG"; break
                           fi ;;
    *'"remaining":false'*) echo "$(date -Is) [$MEDIA] $R" >> "$LOG"
                           echo "$(date -Is) [$MEDIA] COMPLETE" >> "$LOG"; break ;;
    *'"examined"'*)        STALLS=0
                           [ $((N % 25)) -eq 0 ] && echo "$(date -Is) [$MEDIA] $R" >> "$LOG" ;;
    *)                     sleep 15             # auth lapse or a blip: re-auth once
                           NEW=$(login)
                           [ -z "$NEW" ] && { echo "$(date -Is) [$MEDIA] cannot re-auth - stopping" >> "$LOG"; break; }
                           TOK=$NEW; N=0 ;;
  esac
done
