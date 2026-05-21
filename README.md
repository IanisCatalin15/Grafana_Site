# Grafana_site

Frontend Aurora Incidents + nginx (:3004) + backend API (structură ca `Grafana/`).

```
Grafana_site/
├── index.html, script.js, style.css, css/, js/, modules/
├── nginx.conf, docker-compose.yml
├── backend/
│   ├── app/main.py
│   ├── sql/init.sql
│   ├── Dockerfile
│   └── requirements.txt
└── .env.example
```

## UI (port 3004)

```bash
docker compose up -d
```

`https://ia.aurora.direct` → proxy la `:3004`.

## Backend

API: `/incidents-api/` (nginx) → `gfn_api:4100`. Prometheus: `/prom/`.  
Backend rulează din `Grafana/` (`docker compose up -d api`) sau copie locală în `backend/`.

## GitHub

[IanisCatalin15/Grafana_Site](https://github.com/IanisCatalin15/Grafana_Site)

```bash
./push-to-github.sh "mesaj commit"
```

Necesită deploy key SSH sau `GITHUB_TOKEN` cu acces `repo`.

## Internet Down (router cards)

Pe carduri (ex. **AR0045**), când:

| Primary | Backup | Afișare |
|---------|--------|---------|
| Down | Down | **Internet Down** |
| Down | None | **Internet Down** |
| None | Down | **Internet Down** |

Altfel: pill-uri `P …` / `B …` (ex. P Down + B Up = pe backup).

Logică: `modules/parsers.js` → `isInternetDownRouter()`.
