# Deploy

API on **Render**, front end on **Vercel**, both free tier. Roughly 20 minutes, most of it
waiting for builds.

The two services need each other's URLs, so the order below is not optional — you deploy
the API, feed its URL to the front end, then feed the front end's URL back to the API.

---

## Before you start

**Rotate the Groq key.** It was pasted into a chat and `Mahantesh2104/CAT` is public. Get a
new one at [console.groq.com/keys](https://console.groq.com/keys) and revoke the old one.
The new key goes into the Render dashboard and into `starter/api/.env.local` locally —
never into a tracked file.

**Generate an admin token.** Any long random string:

```bash
python -c "import secrets; print(secrets.token_urlsafe(36))"
```

Keep it somewhere you can paste from. It never goes in the repo.

---

## Step 1 — API on Render

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect `Mahantesh2104/CAT`. Render reads `starter/render.yaml` and proposes
   **smart-rental-api** — Python, root `api`, free plan, health check `/health`.
3. It will ask for the three variables marked `sync: false`. Set:

| Variable | Value |
|---|---|
| `ADMIN_TOKEN` | the token you just generated |
| `GROQ_API_KEY` | the **rotated** Groq key |
| `ALLOWED_ORIGINS` | `*` **for now** — Step 3 replaces it |

4. Deploy. First build takes 3–5 minutes.
5. Copy the URL, e.g. `https://smart-rental-api.onrender.com`.

**Check it before moving on:**

```bash
curl -s https://YOUR-API.onrender.com/health
```

Expect `{"ok":true,"now":"2025-05-12","assets":27,"telemetry_snapshots":15144,...}`.
If `assets` is 0 the data directory did not ship — check the blueprint used `rootDir: api`
but cloned the whole repo.

---

## Step 2 — Front end on Vercel

1. [vercel.com/new](https://vercel.com/new) → import `Mahantesh2104/CAT`
2. **Root Directory: `starter/web`.** This is the one setting people get wrong. Vercel then
   picks up `vercel.json` and detects Vite automatically.
3. Environment variable — **exactly one**:

| Variable | Value |
|---|---|
| `VITE_API_URL` | your Render URL, no trailing slash |

4. Deploy, then copy the URL, e.g. `https://cat-smart-rental.vercel.app`.

> ### Do NOT set `VITE_ADMIN_TOKEN` on Vercel
>
> Vite compiles every `VITE_*` variable into the JavaScript it ships. I tested this with
> a canary value and found it in plain text inside `dist/assets/index-*.js` — anyone who
> opened DevTools on your public site would read it, and the admin guard from Step 1
> would be worth nothing.
>
> **You no longer need it.** Sign-in asks for the dealer access key at runtime and holds
> it in `sessionStorage` for that one browser tab, so the elevated role works on the
> deployed site without the key ever entering the bundle. Leave `VITE_ADMIN_TOKEN` unset
> and sign in as **Operations lead** instead.

---

## Step 3 — Point the API back at the front end

Render → **smart-rental-api** → **Environment** → change:

| Variable | Value |
|---|---|
| `ALLOWED_ORIGINS` | your Vercel URL, e.g. `https://cat-smart-rental.vercel.app` |

Save. Render restarts automatically (about a minute).

Leaving it as `*` means any web page a visitor has open can call your API in their name.
It is not catastrophic for a read-only demo, but it is one field and it takes ten seconds.

---

## Step 4 — Verify the deployment

```bash
API=https://YOUR-API.onrender.com
WEB=https://YOUR-APP.vercel.app

# the API is alive and carrying real data
curl -s $API/health
curl -s $API/forecast | head -c 200

# destructive routes refuse an anonymous caller  -> expect 401
curl -s -o /dev/null -w "reset without token: %{http_code}\n" -X POST $API/reset

# and accept yours  -> expect 200
curl -s -o /dev/null -w "reset with token:    %{http_code}\n" \
     -X POST -H "X-Admin-Token: YOUR_TOKEN" $API/reset

# CORS only answers to your front end  -> expect the header only for $WEB
curl -s -D- -o /dev/null -H "Origin: https://evil.example" $API/assets | grep -i access-control
curl -s -D- -o /dev/null -H "Origin: $WEB" $API/assets | grep -i access-control
```

Then open the site and walk the demo script end to end. Check specifically:

- [ ] `/fleet` paints — briefing, forecast, map, ledger, no red retry banner
- [ ] the assistant badge reads **grounded in the figures**, not *offline mode*
      (if it says offline, `GROQ_API_KEY` did not take)
- [ ] `/scan` opens the camera — Vercel is HTTPS, so this works on a phone with no extra setup
- [ ] the landing page animations run

---

## The one thing that will bite you on the day

**Render's free tier spins the service down after 15 minutes of inactivity, and the next
request takes 50 seconds or more to wake it.**

Your front end latches a failed query rather than spinning forever, so a cold API shows a
**Retry** button instead of a dead page — that is the designed behaviour and it is correct,
but it is not what you want a judge to see first.

**Warm it before you present:**

```bash
curl -s https://YOUR-API.onrender.com/health
```

Do that two minutes before you are called, and again if you have been idle. Or leave a
browser tab open on `/fleet` — its polling keeps the service awake.

If you would rather not think about it, deploy the API on **Fly.io** or **Railway**
instead; neither sleeps on the entry tier. `Procfile` and `runtime.txt` are already in the
repo and both platforms read them, so it is the same three environment variables.

---

## If a deploy fails

| Symptom | Cause | Fix |
|---|---|---|
| Render build fails on `pip install` | wrong Python | `PYTHON_VERSION` is pinned to 3.11.9 in `render.yaml`; confirm it applied |
| `/health` returns `assets: 0` | `data/` did not ship | the service must clone the repo root, not only `api/` |
| Vercel build fails, `vite: not found` | Root Directory wrong | set it to `starter/web` |
| Site loads, every panel shows Retry | API asleep, or `VITE_API_URL` wrong/trailing-slashed | curl `/health`; check the variable, then **redeploy** — it is baked in at build time |
| Assistant says *offline mode* | `GROQ_API_KEY` unset or revoked | set it in Render, restart |
| Browser console: CORS blocked | `ALLOWED_ORIGINS` does not match | it must be the exact origin, scheme included, no trailing slash |
| Everything works but numbers look wrong | a rehearsal left ledger rows | `POST /reset` with your token |

**`VITE_API_URL` is compiled in at build time, not read at runtime.** Changing it in the
Vercel dashboard does nothing until you redeploy. This catches everyone once.
