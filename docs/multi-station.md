# CureDesk HMS — Multi-Station Setup & Recovery

Field reference for running reception, doctor cabins and pharmacy off one clinic
database over your own network — **network cable (best), Wi-Fi, or one cable
between two computers**. Windows & macOS. There's an illustrated, printable
version at `/multi-station.html` (deployed to GitHub Pages) and inside the app
at **Settings → Computers & staff → Connect the computers — step by step**. That
guide also covers the **Windows settings** every computer needs (network set to
Private, the firewall question, never sleep, a fixed address, date & time), what
to buy, and a **Check this computer** button.

## How it works

One PC runs as the **Host (Server)** and holds the entire clinic database. Every
other PC runs as a **Cabin (Client)** and works off the host over the network —
cabins keep **no** data of their own. Data never leaves the clinic; there is no
cloud in the middle.

```
 Host (Server) ── router / switch ── Cabins (Clients)
 holds all data    same Wi-Fi/LAN    doctor rooms, pharmacy, billing
 port 4321         no internet       open the same live data
```

**Before you start:** put every PC on the **same router/switch** (avoid "Guest"
Wi-Fi — it isolates devices), connect the host by **network cable** if you can,
and keep the host **awake** (disable sleep). One host, any number of cabins.

## Set it up

### On the HOST PC (Server) — do this first

1. Open **Settings → Computers & staff → Connecting the Computers → Network Mode**, choose **Server**, and Save.
2. When Windows/macOS asks, click **Allow access** so the firewall doesn't block
   the port.
3. Confirm the green banner: **"✓ other PCs can reach this host at
   `http://<ip>:4321`"**. If it's amber, fix the firewall / pick the wired
   adapter, then **Re-check**.
4. Note the **join code** — 5 letters and numbers, capital and small letters are different (valid 10 minutes; **New code** for another). Read out
   the code *and* the host address shown next to it.

### On each CABIN (Client)

1. Make sure it's on the **same network** as the host.
2. Open **Settings → Computers & staff → Connecting the Computers → Network Mode** and choose **Client** (on a fresh install: **"This computer joins a clinic that is already set up"** in the Setup guide).
3. Pick the host under **"Servers found on your network"**, *or* type the
   **5-character join code** from the host.
4. It connects and reloads. The sidebar shows a **connected** pill — you're now
   on the shared data.

To take a PC back to standalone, set its Network Mode to **Local**.

## Recovery & troubleshooting

| Symptom | Most likely cause | What to do |
|---|---|---|
| Cabin: "server not reachable" | Host off / not in Server mode / firewall | Check the host is **running** and set to **Server**; **Allow access** on the firewall. Re-check the host's green banner. |
| Host banner is amber | Firewall block, or wrong adapter pinned | Allow CureDesk through the firewall; under **Troubleshoot** pin the wired/Wi-Fi adapter the clinic uses; press **Re-check**. |
| Worked yesterday, dead today | Host's IP changed (DHCP) | **Cabins now find the host again automatically.** If one doesn't, re-pair with a fresh **join code**. Prevent it → Golden Rule #1. |
| Cabin screen frozen | Host asleep / lost power | The app times out to a clear error instead of hanging. **Wake the host**, or switch the cabin to **Local** to keep working, then back to Client. |
| Some PCs can't see the host | Different networks — Guest Wi-Fi, or one wired + one Wi-Fi kept apart | Put everyone on the **same router/switch**. Avoid "Guest" networks and AP-isolation. Wired for the host is most reliable. |

**Always available:** **Settings → Computers & staff → Check this computer** and **Troubleshoot** runs a
step-by-step check (adapter → same network → port open → server answering →
token accepted) and tells you, in plain words, which step failed and how to fix
it.

## Golden rules (do these once)

1. **Give the host a fixed IP** — add a **DHCP reservation** for the host on your
   router (or set a static IP). This stops the address ever changing — the single
   biggest cause of "it stopped working".
2. **Back up the host** — only the host holds data. Turn on cloud backup:
   **Settings → Backup → "Back up to my Google Drive"**. Cabins need no backup.
3. **Keep the host awake & wired** — disable sleep on the host and connect it by
   cable. If the host is off, the whole clinic is off.
4. **Same clinic, same code** — cabins only join a host whose access code they
   were paired with; they'll never latch onto a neighbouring clinic's PC.

---

*Default port `4321` · Host + unlimited cabins · offline-first, data stays on your PCs.*
