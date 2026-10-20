#!/usr/bin/env bash
# NaijaPass API — Ubuntu host setup (no Docker)
set -euo pipefail

echo "==> Installing MySQL + Redis + Node 20"
sudo apt update
sudo apt install -y mysql-server redis-server curl ca-certificates

# Node 20 via NodeSource if missing
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

sudo systemctl enable --now redis-server
sudo systemctl enable --now mysql

echo "==> Create MySQL database/user (edit password!)"
read -r -s -p "MySQL password for naijapass user: " DB_PASS
echo
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS naijapass CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'naijapass'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON naijapass.* TO 'naijapass'@'localhost';
FLUSH PRIVILEGES;
"

echo "==> Done. Copy .env.production.example → .env, set secrets, then:"
echo "    npm ci && npm run db:migrate && ADMIN_PASSWORD='…' npm run db:seed"
echo "    NODE_ENV=production npm run build && npm start"
echo "Put Nginx in front with HTTPS (see deploy/nginx.conf.example)."
