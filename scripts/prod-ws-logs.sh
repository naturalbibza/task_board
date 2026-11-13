#!/bin/sh
cd ~/task-board || exit 1
echo '== последние ws-ошибки =='
docker compose logs app 2>&1 | grep -i 'ws' | tail -20
echo '== недавние unhandled =='
docker compose logs app 2>&1 | grep -i 'unhandled' | tail -10
echo '== размер логов =='
docker compose logs app 2>&1 | wc -l
