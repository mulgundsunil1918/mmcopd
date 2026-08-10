# CureDesk HMS — Online Activation Server (Phase 2)

Turns licensing into self-service. You issue short **activation codes**; a clinic
types a code into the app; this server signs a machine-bound licence on the spot
and hands it back. The app installs it exactly like a pasted licence.

**Offline activation still works without this server** — `tools/license-gen.mjs`
generates a licence you email; the clinic pastes it. This server just removes the
manual per-customer step.

- **Zero dependencies** — Node built-ins only (`node activation-server.mjs`).
- **Byte-identical tokens** to `tools/license-gen.mjs`, so the app verifies them unchanged.
- **The private key lives ONLY here.** No patient data ever touches this server —
  the worst case if it's breached is forged licences, which you recover from by
  rotating the key and shipping an app update with a new public key.

---

## 1. Configure (environment variables)

| Var | Required | Purpose |
|-----|----------|---------|
| `ADMIN_TOKEN` | ✅ | Bearer token protecting the code-issuing endpoints. Use a long random string. |
| `LICENSE_PRIVATE_KEY` | ✅¹ | The Ed25519 private key **PEM** (paste the whole `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----`). Preferred on hosted platforms — store it as a **secret**. |
| `LICENSE_PRIVATE_KEY_FILE` | ✅¹ | …or a path to the `.pem` file instead (defaults to `./license-keys/private.pem` for local runs). |
| `PORT` | – | Listen port (default `8787`). Most hosts inject their own `PORT`. |
| `DATA_FILE` | – | Where issued codes are stored (default `./server/data/codes.json`). Put this on a **persistent disk** in production. |
| `CONTACT_PHONE`, `CONTACT_EMAIL` | – | Renewal contact stamped into licences (defaults: `8073935006` / `mulgundsunil@gmail.com`). |

¹ Provide **either** `LICENSE_PRIVATE_KEY` or `LICENSE_PRIVATE_KEY_FILE`.

## 2. Run locally

```bash
ADMIN_TOKEN=dev-admin \
LICENSE_PRIVATE_KEY_FILE=./license-keys/private.pem \
node server/activation-server.mjs
```

## 3. Point the app at it

In `src/main/licensing/activationConfig.ts`, set:

```ts
const HARDCODED_ACTIVATION_URL = 'https://YOUR-SERVER-URL';
```

Rebuild the app. When this URL is set the activation screen shows **Activate
online** (code box); when it's empty, only the paste-a-licence path appears.

---

## Endpoints

### `POST /activate`  (public, rate-limited)
```json
{ "code": "CURE-XXXX-XXXX-XXXX", "machineId": "<32-hex from the app>" }
```
- First use → signs a machine-bound licence, returns `{ ok, token, expires_at }`.
- Same machine again → returns the **same** licence (`reused: true`) — reinstall-safe.
- Different machine → `409` (one licence per computer).
- Unknown/revoked code → `404`.

### `POST /admin/issue`  (header: `Authorization: Bearer <ADMIN_TOKEN>`)
```json
{ "clinic": "Gadag Clinic", "modules": ["reception","opd","pharmacy","ipd","lab","peds"],
  "days": 365, "customer": "Dr X", "count": 1 }
```
Returns `{ ok, codes: ["CURE-…"] }`. Valid modules:
`reception, opd, pharmacy, ipd, lab, peds, whatsapp, analytics`.

### `GET /admin/codes`  (Bearer)
Lists every code with its status (`unused` / `activated` / `revoked`), bound
machine, and expiry.

### `POST /admin/revoke`  (Bearer)  `{ "code": "CURE-…" }`
Blocks future activations of that code.

### `GET /health`
Liveness (`{ ok, codes }`).

---

## Issue → activate, by hand

```bash
# 1) Issue a code for a customer
curl -X POST https://YOUR-SERVER/admin/issue \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"clinic":"Gadag Clinic","modules":["reception","opd","pharmacy","ipd"],"days":365}'
# → { "ok": true, "codes": ["CURE-4EPC-YXAU-R2ZH"] }

# 2) The clinic enters CURE-4EPC-YXAU-R2ZH in the app → activated.
```

**Renewal:** issue a fresh code for the same clinic; the customer enters it and
gets a licence dated one year from that activation.

---

## Deploy to Railway (5 minutes)

Railway needs *your* login, so run these on your Mac (the repo already carries
`server/railway.json` + `server/package.json`, so the service is pre-shaped).

```bash
# 1. Install + log in (opens your browser once)
npm i -g @railway/cli
railway login

# 2. From the SERVER folder, create the project/service
cd ~/caredesk/mmcopd/server
railway init            # name it e.g. curedesk-activation

# 3. Add a persistent disk (so issued codes survive restarts/redeploys)
railway volume add --mount-path /data

# 4. Set the secrets  (ADMIN_TOKEN below is pre-generated — or make your own)
railway variables --set "ADMIN_TOKEN=3c68807e50efd3b9fd48c87fb291a230e0bdd8dbf24f7d8c" \
                  --set "DATA_FILE=/data/codes.json"

# 5. Set the signing key from your LOCAL private key (never leaves your machine → Railway secret)
railway variables --set "LICENSE_PRIVATE_KEY=$(cat ../license-keys/private.pem)"

# 6. Deploy, then get the public URL
railway up
railway domain          # → https://curedesk-activation-production.up.railway.app

# 7. Smoke-test it
curl https://<your-domain>/health
```

Then put that domain in `src/main/licensing/activationConfig.ts`
(`HARDCODED_ACTIVATION_URL`) and rebuild the app → the "Activate online" box
lights up. Verify by issuing a code (`POST /admin/issue` with the Bearer token)
and activating it in the app.

> **Root directory:** because you run `railway init`/`railway up` from inside
> `server/`, Railway builds just this folder (it sees `server/package.json`, not
> the Electron app). If you instead connect the repo from the Railway dashboard,
> set the service **Root Directory = `server`**.

## Deploying (any other always-on Node host)

Works on Render / Railway / Fly.io / a small VPS — anything that runs Node and
gives a **persistent disk** for `DATA_FILE`. Set the env vars above (private key
as a **secret**), start command `node activation-server.mjs`. Put it behind HTTPS
(every platform above terminates TLS for you).

> Fully serverless platforms (Vercel/Cloudflare) have an ephemeral filesystem —
> `DATA_FILE` won't persist there. Use a host with a disk, or swap the JSON store
> for the platform's KV/DB.
