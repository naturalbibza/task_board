#!/usr/bin/env bash
# Подготовка VPS (rootless-режим). Запускается ОДИН раз от root:
#   Get-Content scripts\server-setup.sh -Raw | ssh root@45.81.255.219 "bash -s"
# Docker ставится пакетами, rootful-демон выключается; демон запускается
# позже под bibza как systemd --user сервис (rootless). Группа docker не используется.
set -euo pipefail

# 0. Минимум для установки Docker (curl на свежем Debian может отсутствовать)
apt-get update -y
apt-get install -y curl ca-certificates

# 1. Пакеты Docker (CLI, compose, rootless-extras)
if ! command -v docker >/dev/null 2>&1; then
  echo 'Устанавливаю пакеты Docker…'
  curl -fsSL https://get.docker.com | sh
else
  echo 'Docker уже установлен'
fi

# 2. Rootful-демон не нужен и не должен работать (rootless будет под bibza)
systemctl disable --now docker.service docker.socket 2>/dev/null || true

# 3. Зависимости rootless-режима
apt-get update -y
apt-get install -y uidmap dbus-user-session

# 4. Linger: user-сервисы bibza работают без активной SSH-сессии
loginctl enable-linger bibza 2>/dev/null || true

# 5. Rootless-демон не может слушать порты < 1024 — разрешаем от 80
echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/99-rootless-docker.conf
sysctl --system > /dev/null

# 6. Swap (900MB RAM мало для сборки Vite)
if ! swapon --show | grep -q .; then
  echo 'Создаю swap 2G…'
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo 'Swap уже есть'
fi

echo 'server-setup (root-часть): готово. Далее user-часть запускается под bibza.'
