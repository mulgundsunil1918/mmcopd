# CureDesk — Troubleshooting Guide

Practical fixes for the things that actually go wrong. Start with the symptom.

---

## Quick triage

| Symptom | Go to |
|---|---|
| Cabin PC says "Disconnected" | [LAN: cabin can't reach host](#lan-cabin-cant-reach-the-host) |
| App frozen / spinning forever | [App hangs](#app-hangs-or-spins-forever) |
| Join code doesn't work | [Pairing fails](#pairing-join-code-fails) |
| Cabins can't find the host at all | [Discovery fails](#discovery-no-servers-found) |
| Locked out of admin | [Admin password](#locked-out-of-admin) |
| WhatsApp messages not arriving | [WhatsApp relay](#whatsapp-inbound-messages-not-arriving) |
| Everything is broken, need to get working NOW | [Emergency reset](#emergency-get-working-now) |

**First move for any network issue:** Settings → System → Network Mode → **Run full diagnostics**. It tests each layer in order and tells you which one broke and how to fix it. Use **Copy report** to share it.

---

## LAN: cabin can't reach the host

The cabin shows a red "Disconnected" pill. **Your data is safe** — records live on the host, and the cabin retries automatically (every 5s, backing off to 60s). It reconnects on its own once the host is reachable.

Work through these in order:

**1. Is the host PC awake and running CureDesk?**
Sleep is the most common cause. On the host: Control Panel → Power Options → set "Put the computer to sleep" to **Never**. A clinic host should never sleep.

**2. Did the host's IP change?**
DHCP hands out a new address after a router reboot, and the cabin is still pointing at the old one. Two fixes:
- *Quick:* on the host, Settings → Network Mode → read the current address, then re-pair the cabin with a fresh join code.
- *Permanent:* give the host a **DHCP reservation** (static IP) in your router. Do this once and this class of problem disappears. Strongly recommended.

**3. Is the firewall blocking it?**
On the host, Windows Defender may have reset the rule after an update. Settings → Network Mode → **Reconnect** re-adds it. If the UAC prompt appears, click **Allow access** and tick both *Private* and *Public*.

**4. Wired and Wi-Fi mixed up?**
See [wired LAN setup](#wired-lan-recommended) below.

**5. Still stuck?**
Settings → Network Mode → **Forget this server**. The cabin drops to Local mode and stays usable. Re-pair with a fresh join code when the host is back.

---

## Wired LAN (recommended)

Ethernet is more reliable than Wi-Fi for a clinic — no roaming, no interference, no signal drops. CureDesk supports both, but wired is the better choice for the host.

**If the host PC has both a network cable and Wi-Fi**, it has two addresses, and the join code may advertise the wrong one — cabins then can't connect even though everything "looks" fine.

**Fix:** Host → Settings → System → Network Mode → **Network adapter other PCs should use**. Adapters are labelled:
- 🔌 **wired LAN (most reliable)** — pick this one
- 📶 **Wi-Fi**

Click the wired adapter to **pin** it. The join code and discovery now always advertise that address. Click it again to go back to automatic.

CureDesk prefers wired automatically, but pinning makes it explicit and survives adapter changes.

**Ideal clinic setup:** host + all cabins into the same network switch with cables. No Wi-Fi involved anywhere.

---

## Discovery: "no servers found"

The cabin's auto-discovery lists nothing.

- **Different networks.** Host on wired, cabin on Wi-Fi, and the router keeps them separate. Diagnostics catches this ("Host PC is on the same network"). Put both on the same router/switch.
- **Guest Wi-Fi / AP isolation.** Many routers block device-to-device traffic on guest networks. Move both PCs to the main network.
- **Host not in Server mode.** Check host → Settings → Network Mode shows *Server* and "Hosting on port 4321".
- **Discovery blocked entirely.** Skip it — use **Advanced → enter address manually**: `http://<host-ip>:4321`, with the secret from the host.

---

## Pairing (join code) fails

- **Code expired.** Codes last **10 minutes**. Generate a fresh one on the host.
- **Wrong characters.** Codes never contain `0`, `O`, `1`, `I`, or `L` — if you read one of those, it's a lookalike (`0`→`O` is really `Q` or `D`; check the host screen).
- **"Invalid join code" but it looks right.** Regenerate on the host — the code rotates and an old screenshot may be stale.
- **"Pairing not active".** The host left Server mode. Set it back to Server and save.

---

## App hangs or spins forever

Previously, a cabin whose host went to sleep would freeze completely — including Settings, so there was no way out except editing the database by hand. **This is fixed.** Calls now time out after 15 seconds with a clear error, and Settings always opens using the local copy of your settings.

If you're on an older build and it hangs:
1. Close CureDesk.
2. Reopen it — Settings loads from local values even when the host is down.
3. Settings → Network Mode → **Local** → Save.

Manual escape hatch (only if the app won't start at all):
```bash
sqlite3 "$HOME/Library/Application Support/CureDesk HMS/caredesk.sqlite" "UPDATE settings SET value='local' WHERE key='network_mode';"
```
On Windows the database is at `%APPDATA%\CureDesk HMS\caredesk.sqlite`.

---

## Locked out of admin

The old hardcoded master password has been **removed** — it was readable by anyone who opened the app file, which meant it unlocked every clinic.

- **Default password is `1234`** until you change it (first unlock converts it to a secure hash automatically).
- **New passwords need 8+ characters.**
- **Too many wrong attempts** → a lockout that grows: 10s, 30s, 2min, 5min, up to 15min. Wait it out; it clears on the next correct entry.
- **Genuinely forgotten?** There is no backdoor by design. Recover from a backup, or reset the stored password directly:
```bash
sqlite3 "$HOME/Library/Application Support/CureDesk HMS/caredesk.sqlite" "UPDATE settings SET value='1234' WHERE key='admin_password';"
```
Then unlock with `1234` and immediately set a real password.

**First login as `admin`** now forces a password change if the account is still on `admin123`. It can't be skipped — this is deliberate.

---

## WhatsApp: inbound messages not arriving

Patients' replies don't show in the WhatsApp inbox.

**1. Check the relay is healthy and protected:**
```bash
curl -s https://curedesk-relay.curedesk.workers.dev/health
```
`protections` should read `verifyToken: true, signature: true, pollAuth: true`. Anything `false` means that protection isn't active yet — see [relay setup](#relay-setup-cloudflare).

**2. Check the poll secret matches.** Settings → Communication → the relay secret must be identical to the Worker's `POLL_SECRET`. A mismatch returns 401 and messages silently stop.

**3. Check Meta's webhook config** points at `https://curedesk-relay.curedesk.workers.dev/webhook` and is subscribed to the **messages** field.

**4. Events arriving but no conversations?** Older Worker versions sent events in a shape the app couldn't classify, so messages were stored but never became conversations. Redeploy the Worker (below) to fix.

---

## Relay setup (Cloudflare)

The relay is a Cloudflare Worker (`caredesk-relay-worker/`), not Railway.

```bash
cd caredesk-relay-worker
npx wrangler secret put POLL_SECRET
npx wrangler secret put META_APP_SECRET
npx wrangler secret put RELAY_VERIFY_TOKEN
npx wrangler deploy
```

- `POLL_SECRET` — must equal Settings → Communication → relay secret in the app.
- `META_APP_SECRET` — Meta dashboard → your app → Settings → Basic → App Secret.
- `RELAY_VERIFY_TOKEN` — the verify token you entered in Meta's webhook config.

Each protection activates only once its secret exists, so you can deploy first and lock down after without dropping messages. Verify with the `/health` call above.

---

## Backups

- **Where:** Settings → Backup → the configured folder. Bundles contain the database, an Excel export, and patient documents.
- **Restore:** Settings → Backup → Restore. A pre-restore snapshot is taken automatically, so a bad restore is undoable.
- **Test it.** An untested backup is not a backup. Once a month, restore into a spare folder and confirm patient counts look right.
- **Keep one copy off the PC.** A USB drive or cloud folder. A backup on the same disk doesn't survive a disk failure or ransomware.

---

## Emergency: get working NOW

Patients waiting, nothing else matters:

1. **Any cabin → Settings → Network Mode → Local → Save.** That PC now runs standalone on its own data and is immediately usable.
2. Do the day's work. Register patients, bill, dispense.
3. Fix the network afterwards.

⚠️ Records created in Local mode live on **that PC only** and won't appear on the host. Note down what was entered so it can be reconciled. For a single busy morning this is the right trade — an unusable system is worse.

---

## Getting help

Settings → Network Mode → **Run full diagnostics** → **Copy report**. It includes adapters, connection state, latency, and every check with its result — no patient data. Paste it into WhatsApp or email.
