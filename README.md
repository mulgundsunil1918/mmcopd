# CareDesk HMS — Mulgund Multispeciality Clinic

OPD management desktop app built with Electron + Vite + React + TypeScript + SQLite.

## Run (development)

```bash
npm install
npm start
```

The Vite renderer dev server runs at http://127.0.0.1:1918 and is loaded inside the Electron window. The SQLite database lives at Electron's `userData` path (Windows: `%APPDATA%/CareDesk HMS/caredesk.sqlite`).

## Package (Windows)

```bash
npm run make
```

Produces a Squirrel installer in `out/`.

## Routes

| Route | Purpose |
|---|---|
| `/reception` | Patient search + registration (Ctrl+N = new) |
| `/appointments` | Board view, book (Ctrl+B), per-doctor queues |
| `/doctor-select` | Pick a doctor |
| `/doctor/:id` | Per-doctor live queue + patient detail |
| `/billing` | Billing queue + invoice generator + history |
| `/notifications` | Notification log + provider settings |
| `/settings` | Clinic info + doctor management |

## Roadmap

- Stage 1 — Core offline (done)
- Stage 2 — Dashboards & billing (done)
- Stage 3 — Notifications & polish (done, providers stubbed)
- Stage 4 — Cloud/web/mobile (later)
