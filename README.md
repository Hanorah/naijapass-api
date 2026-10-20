# NaijaPass API

Express + **MySQL (XAMPP)** + **Redis (WSL Ubuntu on this machine)**.

Uploads are stored **in MySQL** (`file_uploads` table), not on disk.

## Local setup

1. **XAMPP** → Start MySQL  
2. **WSL** → Redis already running (`redis-cli ping` → `PONG`)  
3. `cp .env.example .env`  
4. `npm install && npm run db:migrate && npm run db:seed && npm run dev`
5. (Optional) Re-import former Supabase dumps:

```bash
npm run db:import-supabase
```

CSVs are in `data/supabase-export/` (`profiles`, `projects`, `tenders`, `state_content`, `field_reports`).  
Override path with `CSV_DIR=...`.

- API: http://localhost:4000  
- Health: http://localhost:4000/health  
- Admin: `admin@naijapass.ng` / `AdminPass123!`  
- State govt (after import): `*@govt.naijapass.ng` / `GovtPass123!`

## Deploy on Render

**You do not need nginx** on Render. TLS and reverse-proxy are handled for you.  
`deploy/nginx.conf.example` is only for a VPS (Ubuntu + Certbot) setup.

| Setting | Value |
|---|---|
| Runtime | Node |
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Health check | `/health` |

Set env vars from `.env.production.example`. Critical ones:

- `TRUST_PROXY=1`
- `JWT_SECRET` (≥32 random chars)
- `CORS_ORIGINS` = your frontend URL(s)
- `API_PUBLIC_URL` = `https://<your-api>.onrender.com`
- `APP_PUBLIC_URL` = frontend URL (password-reset links)
- MySQL host/user/password from a **managed MySQL** (not XAMPP)

Redis is optional; the API falls back to in-memory cache if `REDIS_URL` is missing.

After first deploy, run migrate/seed once (Render Shell or local against prod DB):

```bash
npm run db:migrate
npm run db:seed
# optional: npm run db:import-supabase
```
