# CureDesk HMS — Install & Update Guide

## What never gets touched

Your clinic data lives at:

```
%APPDATA%\CureDesk HMS\caredesk.sqlite
%APPDATA%\CureDesk HMS\backups\
%APPDATA%\CureDesk HMS\documents\
```

Updates only replace app code in `Program Files`. **Patient records, bills, EMR, settings, logo, signatures, backups — none of it is ever overwritten by an update.**

---

## ONE-TIME SETUP — first install on the clinic PC

1. On your developer PC, build the installer:
   ```
   npm install
   npm run make
   ```
2. Find the file:
   ```
   out\make\squirrel.windows\x64\CareDesk-HMS-Setup.exe
   ```
3. Copy it to the clinic PC (USB stick, network share, whatever).
4. Double-click `CareDesk-HMS-Setup.exe`. It installs silently — no prompts. Creates a Start menu shortcut + Desktop shortcut. Launches automatically.

That's it. The clinic uses the app daily.

---

## ONE-TIME SETUP — auto-update over GitHub

You only do this on YOUR developer PC, once.

1. Create a GitHub Personal Access Token with **repo** scope:
   - Go to https://github.com/settings/tokens/new
   - Note: "CareDesk releases", Expiration: No expiration
   - Tick `repo` (full control of private repositories)
   - Generate, **copy the token**
2. Set it as an environment variable on your dev PC:
   ```
   setx GITHUB_TOKEN "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```
   Close + reopen your terminal so the new variable loads.

---

## EVERY UPDATE — push a new version

On your developer PC:

1. Make whatever code changes.
2. **One command does everything:**
   ```
   npm run release
   ```
   This bumps the version (1.0.0 → 1.0.1), commits the bump, tags it, pushes to GitHub, builds the installer, and uploads it to GitHub Releases as a **draft**.
3. Open https://github.com/mulgundsunil1918/mmcopd/releases — you'll see a new draft release with the installer attached.
4. Click **Edit** → **Publish release**.

Done from your side.

---

## ON THE CLINIC PC — what happens automatically

- The installed app checks GitHub every 1 hour (and on startup).
- When it sees a newer release, it downloads silently in the background.
- Once downloaded, a Windows notification appears: **"A new version of CureDesk HMS has been downloaded. Restart the app to apply the updates."**
- User clicks **Restart** → 5 seconds later, new version is running.
- All patient data is exactly as before.

---

## EMERGENCY: rollback to a previous version

If a release breaks things:

1. Mark the bad release as **Pre-release** on GitHub (so the auto-updater stops offering it)
2. On the clinic PC, install the old `.exe` from the prior release — Squirrel will downgrade in place
3. Data is fine because it lives in `%APPDATA%`

---

## CHECKLIST before every release

- [ ] All changes tested on dev PC (`npm start`)
- [ ] If you changed the database schema, you added a migration in `src/db/migrations.ts` (existing patients' data must keep working)
- [ ] Bumped meaningful change in `CHANGELOG.md` (optional but recommended)
- [ ] Ran `npm run release`
- [ ] Reviewed + Published the draft release on GitHub

---

## Folder structure after install

```
C:\Program Files\CureDesk HMS\         ← app code (replaced by updates)
%APPDATA%\CureDesk HMS\
   caredesk.sqlite                     ← all clinic data (PRESERVED)
   caredesk.sqlite-wal                 ← write-ahead log
   backups\                            ← daily auto-backups
   documents\<patient_id>\             ← uploaded EMR files
```

You can copy `%APPDATA%\CureDesk HMS\` to a USB stick anytime — that's a complete backup.
