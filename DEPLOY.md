# Deploying a VGPT.IL demo

The tool is a single Node server (Express + built-in SQLite) that, in production,
also serves the built React app — one process, one URL.

## Why Render (or Railway/Fly) and not Vercel

Vercel runs code as **serverless functions**: no persistent process, no writable
disk. This app needs both —

- the SQLite price history is a **file** that must live between requests;
- auto price capture runs on a **timer** inside the server process;
- the polite-scraping layer (2.5s per-host spacing, daily budgets, back-off)
  keeps its state **in the process**. On serverless, every invocation starts
  fresh, which would silently drop the rate-limit guarantees we make to the
  Israeli stores — not acceptable.

A classic free web service (Render / Railway / Fly.io) runs the server exactly
like your machine does. **Render is the path of least resistance** and has a
`render.yaml` blueprint in this repo.

## Steps (Render, free)

1. Push this repo to GitHub (`game-price-il` is already a git repo with the
   right `.gitignore` — your price data and API keys are never committed).
2. In https://dashboard.render.com → **New → Blueprint** → pick the repo.
   Render reads `render.yaml` and creates the service.
3. Deploy. First build takes a few minutes; you get
   `https://<name>.onrender.com` to share.

Manual alternative (no blueprint): New → Web Service → repo →
Build command `npm install && npm run build`, Start command `npm start`,
add env vars `NODE_VERSION=24.4.1` and **`NODE_ENV=production`**.

> `NODE_ENV=production` is what tells the server to take the platform's `PORT`
> and bind a public interface. Locally it deliberately ignores `PORT` and stays
> on loopback `5174`, so a stray `PORT` in a dev environment can never move the
> API away from the port the web app proxies to.

### Optional: GG.deals / ITAD keys

Add `GG_DEALS_API_KEY` / `ITAD_API_KEY` as environment variables in the Render
dashboard (the keys are personal — don't commit them). Without them the demo
simply runs without those two PC-deal sources; everything else works.

## Demo caveats (free tier)

- **One shared database**: every visitor sees and edits the same tracking list.
  Fine for showing friends; not a multi-user product.
- **Data resets**: the free tier's disk is ephemeral — history is lost on
  redeploy or after the service spins down from idle (~15 min). A paid
  persistent disk (mount it and set `VGPT_DATA_DIR` to the mount path) makes it
  survive.
- **Cold start**: after idle, the first visit takes ~30–60s to wake.
- **Israeli store scraping from a datacenter IP** can occasionally be served a
  challenge page; the UI's source-status notice reports any store that didn't
  answer. The scraper stays polite from any location (same budgets and spacing).

## Local production run (sanity check)

```bash
npm run build && NODE_ENV=production PORT=8790 npm start
```

Then open http://localhost:8790 — same single-process setup the host runs.
(`VGPT_PORT=8790` works too, in either mode.)
