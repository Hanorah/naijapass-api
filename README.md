# NaijaPass API

Express + **MySQL (XAMPP)** + **Redis (WSL Ubuntu on this machine)**.

Uploads are stored **in MySQL** (`file_uploads` table), not on disk.

## Local setup

1. **XAMPP** → Start MySQL  
2. **WSL** → Redis already running (`redis-cli ping` → `PONG`)  
3. `cp .env.example .env`  
4. `npm install && npm run db:migrate && npm run db:seed && npm run dev`

- API: http://localhost:4000  
- Health: http://localhost:4000/health  
- Admin: `admin@naijapass.ng` / `AdminPass123!`

## Notes

- Redis is only for local caching via WSL — we are **not** deploying this app to Ubuntu.
- File URLs look like `/api/uploads/<id>` and stream bytes from MySQL.
