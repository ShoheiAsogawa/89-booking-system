#!/bin/bash
# 89予約 本番の簡易確認（読み取りのみ）
for u in https://www.89center.dev/ https://admin.89center.dev/ https://89center.dev/ https://www.89center.dev/cloudflare-db-client.js https://www.89center.dev/jp-custom-calendar.js https://www.89center.dev/jp-custom-calendar.css https://www.89center.dev/vendor/japanese-holidays.js https://www.89center.dev/paypay.png https://admin.89center.dev/admin.html "https://www.89center.dev/api/occupancy?date=2026-11-02"; do
  echo "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Cache-Control: no-cache' "$u") $u"; done
echo "occupancy: $(curl -s 'https://www.89center.dev/api/occupancy?date=2026-11-02' | head -c 200)"
echo "staffs: $(curl -s -X POST https://www.89center.dev/api/db -H 'Content-Type: application/json' -d '{"table":"staffs","operation":"select","columns":"*","filters":[],"or":[],"order":[]}' | head -c 160)"
echo "admin版: $(curl -s 'https://admin.89center.dev/?v='$RANDOM | grep -c 'block_day') (1なら移植版)"
