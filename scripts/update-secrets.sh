#!/bin/sh
# Обновляет/дополняет мастер-копию секретов на сервере (~/task-board.secrets.env)
# и синхронизирует её в ~/task-board/.env. Запускается на сервере:
#   scp scripts/update-secrets.sh bibza@host:update-secrets.sh && ssh ... 'sh update-secrets.sh'
# Текущее состояние: POSTGRES_PASSWORD, JWT_SECRET, COOKIE_DOMAIN=bibza.ru,
# ORIGIN=https://bibza.ru, SITE_ADDRESS="bibza.ru, www.bibza.ru" (пробел после запятой обязателен).
cd ~/task-board || exit 1
M=~/task-board.secrets.env
if ! grep -q '^SITE_ADDRESS=' "$M"; then
  printf 'SITE_ADDRESS=bibza.ru, www.bibza.ru\n' >> "$M"
fi
cp "$M" .env
awk -F= '{print $1}' "$M"
