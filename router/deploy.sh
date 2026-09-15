#!/bin/sh
# Spielt den Collector auf den Router. Setzt voraus, dass /etc/vanbox/lib.sh
# schon liegt, die kommt aus dem vanbox-Projekt.
# Aufruf: router/deploy.sh [ssh-ziel]
set -eu
HOST="${1:-root@192.168.2.149}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

ssh "$HOST" '[ -f /etc/vanbox/lib.sh ] || { echo "FEHLT: /etc/vanbox/lib.sh, zuerst vanbox ausrollen" >&2; exit 1; }
[ -f /etc/vanbox/secrets.env ] || { echo "FEHLT: /etc/vanbox/secrets.env" >&2; exit 1; }'

STAMP=$(date +%Y%m%d-%H%M%S)
ssh "$HOST" "mkdir -p /mnt/extroot/vanbox-backup/$STAMP && cp /root/update_location_and_sheet.sh /mnt/extroot/vanbox-backup/$STAMP/ 2>/dev/null || true"
echo "Sicherung: /mnt/extroot/vanbox-backup/$STAMP"

ssh "$HOST" 'cat > /root/update_location_and_sheet.sh && chmod +x /root/update_location_and_sheet.sh' < "$ROOT/update_location_and_sheet.sh"
ssh "$HOST" 'sh -n /root/update_location_and_sheet.sh && echo "Syntax ok"'
