# Tappy — Vercel deploy

## What's in here
- `public/index.html` — the app (same UI as before, now syncs to a cloud database)
- `api/expenses.js` — saves/reads/deletes expenses in Upstash Redis
- `api/settings.js` — saves/reads app settings (currently just the report email) in Upstash Redis
- `api/cron-report.js` — runs daily, and on the last day of the month (IST) emails you a report
- `vercel.json` — schedules the cron job

## Multiple people using the same deployed app

If you share this app's URL with other people, **each of them gets their own private data automatically** — no login required. The first time the app loads in a browser, it generates a random device ID and stores it in that browser's localStorage. Every expense, setting, and the report-email address is saved in the cloud keyed to that ID (`tappy:expenses:<id>`, `tappy:settings:<id>`), so:

- Your expenses are never visible to, or mixed with, anyone else's
- The monthly cron job loops over every device ID that has ever saved data, and sends **each person their own report, to their own email, with only their own expenses**
- If someone never sets a report email in their Settings, they just don't get a monthly email — no error, no data leak

The one caveat: this ID lives in browser storage, not a real login. If someone clears their browser data or switches browsers/phones, they'll start fresh with a new empty set of data (there's no password-based account to recover it with). If you want proper accounts later (so the same person can log in from multiple phones and see the same data), that would need real authentication — let me know if you want that added.

## Setting the report email address from the app

Open the ⚙️ gear (History or Analytics tab) → **"Monthly email report sent to"** → type the address(es), comma-separated for more than one → tap away from the field to save. This is stored under your device's own key in the cloud database, so it only affects your own reports.

The `REPORT_EMAIL` environment variable is no longer used at all now that each device has its own stored email — it's kept only as dead code for reference and has no effect.

## One-time setup (about 5 minutes)

### 1. Create the database (free)
1. Go to https://vercel.com/dashboard → your project → **Storage** tab → **Create Database** → choose **Upstash Redis** (Marketplace)
   - Alternative: create one directly at https://console.upstash.com (free tier), then add its REST URL/token as env vars manually (names below)
2. Vercel will auto-add two environment variables to your project: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN` — if you see those names instead, just rename them to match, or edit `api/*.js` to use those names).

### 2. Create a Resend account (free, for sending the email)
1. Sign up at https://resend.com (free tier: 3,000 emails/month) — use `[Your Email]` to sign up, see note below
2. Go to **API Keys** → create one → copy it
3. In Vercel → your project → **Settings → Environment Variables**, add:
   - `RESEND_API_KEY` = the key you copied

   Note: without verifying your own domain in Resend, the sandbox sender (`onboarding@resend.dev`) can only deliver to **the email address you signed up to Resend with**. That means, until you verify a domain in Resend, the monthly report will only actually land for whichever person set *that* address as their report email in the app — everyone else's reports will be generated but fail to deliver. Verifying a domain in Resend (free, just a DNS record) removes this limit entirely if multiple people need real delivery.

### 3. Deploy
```bash
npm i -g vercel
cd tappy-vercel
vercel deploy --prod
```
Or drag the whole `tappy-vercel` folder into Vercel's dashboard (Add New → Project → deploy without Git).

### 4. Test the email without waiting for month-end
Visit `https://<your-app>.vercel.app/api/cron-report?force=1` in a browser — it'll loop through every device that has ever saved data and send each one their report immediately, so you can confirm it works. To test just your own device without emailing everyone else who's used the app, open your Settings sheet in the app, note that your device ID is stored in your browser's localStorage under the key `tappy_device_uid` (view it via your browser's dev tools), then visit `https://<your-app>.vercel.app/api/cron-report?force=1&uid=<that-id>`.

## App icon / "Add to Home Screen"

The project now includes a logo and full PWA icon set (`public/icon-*.png`, `apple-touch-icon.png`, `favicon.ico`, `manifest.webmanifest`), wired up in `index.html`'s `<head>`. Once deployed:
- **iPhone (Safari):** open the site → Share → **Add to Home Screen** — it'll use the logo automatically, open full-screen with no browser bar, and show a black status bar.
- **Android (Chrome):** open the site → menu → **Add to Home screen / Install app** — same deal, using the manifest.

Want a different logo design? Send me a description (or an image to base it on) and I'll regenerate the icon files.

## Notes
- The app still keeps a local copy in your phone's browser (works offline), and syncs to the cloud database in the background whenever it can reach the network.
- The cron job runs daily at 18:00 UTC (11:30 PM IST) but only actually sends an email on the last calendar day of the month (checked in Asia/Kolkata time).
- Nothing here touches your Claude artifact — this is a fully separate, self-hosted copy.
