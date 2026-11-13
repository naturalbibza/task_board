#!/bin/sh
# Разовое выравнивание пароля БД с текущим .env (том инициализирован раньше).
cd ~/task-board || exit 1
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
docker exec task-board-db-1 psql -U postgres -c "ALTER USER postgres PASSWORD '$PW';"
echo '== verify from another container =='
docker run --rm --network task-board_default -e PGPASSWORD="$PW" postgres:16-alpine psql -h db -U postgres -d task_board -c 'select 1' 2>&1 | tail -2
