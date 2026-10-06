# HW Tracker for Canvas

All your Canvas homework, pre-class prep, and exams in one app on your phone, with reminders before things are due.

- **Upcoming:** everything due, grouped by day, with overdue work at the top
- **Prep:** pre-class lessons, reading quizzes, prelabs, and module readings in their own list
- **Courses:** your current grade in each class, what's open, and recently graded work (new grades are marked)
- **Done:** everything you've finished in the last two weeks, with scores once they're graded. Tap a check to put something back on your list.
- **Reminders:** a push notification before anything unfinished is due (you choose how early), a nightly "due by end of tomorrow" summary, and an alert when a new assignment is posted
- **Your own tasks:** add readings or to-dos your professor only mentions in lecture
- **Updates itself:** your copy picks up new versions automatically

It works with any school that uses Canvas. You don't need a Canvas API token, so it works even if your school has those turned off. It runs free on your own Cloudflare account, so your data never goes through anyone else's server.

<p align="center">
  <img src="docs/upcoming.png" width="250" alt="Upcoming view">
  <img src="docs/courses.png" width="250" alt="Courses view with grades">
  <img src="docs/done.png" width="250" alt="Done view">
</p>

## Set it up (about 5 minutes, no coding)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and a free [GitHub account](https://github.com/signup).

### 1. Deploy your own copy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ishaanmakam/canvas-hw-tracker)

Click the button, sign in to Cloudflare and GitHub when it asks, and click **Create and deploy**. Cloudflare copies this project into your GitHub, creates the storage the app needs, and gives you a link like `https://canvas-hw-tracker.yourname.workers.dev`.

If Cloudflare asks you to choose a `workers.dev` subdomain, pick any name. It becomes part of your link.

### 2. Connect Canvas

Open your new link on a computer. It shows a setup page.

1. In another tab, open your school's Canvas and click **Calendar** in the left menu.
2. At the bottom right of the calendar, click **Calendar Feed** and copy the link. It ends in `.ics`.
3. Paste it into the setup page, check that your time zone is right, and click **Connect Canvas**.

Do this right after deploying. Whoever finishes setup first owns that tracker, and after that it's locked.

### 3. Put it on your iPhone

1. The setup page shows a QR code. Scan it with your iPhone camera. Your tracker opens in Safari, already signed in.
2. Tap **Share**, then **Add to Home Screen**.
3. Open **HW** from your home screen, go to **Settings**, tap **Turn on notifications**, then **Send test**.

iPhones only allow notifications from web apps that are on the home screen, and need iOS 16.4 or newer. On Android, open the link in Chrome and choose **Install app**.

The setup page also shows your **app key**. Save it in your password manager. You only need it if a device ever gets signed out.

### 4. (Optional) The Sync bookmark

The calendar feed tells the app what's due, but not what you've already turned in or your grades. The Sync bookmark fills those in, and it also pulls readings from your courses' Modules pages.

1. In the app, open **Settings** and tap **Copy bookmark code**.
2. In Safari, bookmark any page and name it **Sync HW**.
3. Edit that bookmark and replace its address with the code you copied.
4. While you're on Canvas, open your bookmarks and tap **Sync HW**. A banner confirms the sync.

Run it whenever you want submitted work checked off and grades updated. Without it, you can still tick items off by hand. You only set the bookmark up once: it loads the latest sync code from your tracker each time.

## Questions

**Is my Canvas data private?**
Your feed link and assignments are stored only in your own Cloudflare account. Treat your Calendar Feed link like a password, since anyone who has it can see your assignment list. The same goes for the tracker's QR code and sign-in link.

**What does it cost?**
Nothing for one person. It fits well inside Cloudflare's free Workers plan.

**How often does it update?**
Due dates refresh every 30 minutes on their own, or whenever you tap the refresh arrow. Submissions and grades update when you tap Sync HW on Canvas.

**Where do grades come from?**
From Canvas, through the Sync HW bookmark, using your normal Canvas login. If a professor hides course totals in Canvas, the app can't show them either.

**I checked something off by mistake.**
Tap the check again, or tap Undo on the message that pops up. Anything you've finished is also in the Done tab, where you can uncheck it. This works even for work Canvas shows as submitted.

**Something is tagged wrong (Prep vs. homework vs. exam).**
The tags come from assignment names. Edit the patterns at the top of `src/model.js` in your copy of the project to match how your professors name things.

**I switched schools or my feed stopped working.**
Go to Settings, then Canvas feed, paste a new Calendar Feed link, and save.

**How do I start over completely?**
In the Cloudflare dashboard, open Workers & Pages, then your tracker, then its KV storage, and delete the `config` key. The next visit shows the setup page again.

## Known limits

- Work outside Canvas, such as completion on Ed, Gradescope, or WebAssign, isn't visible. If the assignment is listed in Canvas it still shows up with its due date, but you tick it off yourself.
- Module readings appear only when a professor posts them as Canvas module pages or files with a completion requirement.
- Without the Sync bookmark, the app doesn't know what you've submitted, so reminders can fire for work you already turned in.

## Getting updates

Your copy updates itself. Once a day, a GitHub Action in your copy (`.github/workflows/auto-update.yml`) downloads the newest version of this project and commits it to your repo. Cloudflare then redeploys automatically. Your worker name and storage id in `wrangler.toml` are kept, and so is all your data. When an update arrives, the app shows a short note about what changed.

- **Turn it off:** in your repo, go to Settings → Secrets and variables → Actions → Variables and add `AUTO_UPDATE` with the value `off`. You can also disable the workflow in the Actions tab. Turn it off if you've edited the code yourself, because updates replace the app's files.
- **Update right now:** Actions tab → Auto-update → Run workflow.

### Set it up before October 6, 2026?

Copies made before version 1.1 don't have the auto-updater yet. Adding it takes about two minutes and only has to be done once:

1. Open [the auto-update file](https://raw.githubusercontent.com/ishaanmakam/canvas-hw-tracker/main/.github/workflows/auto-update.yml) and copy everything on the page.
2. On GitHub, open **your** copy of the project. Click **Add file**, then **Create new file**.
3. For the file name, type `.github/workflows/auto-update.yml` exactly. Typing the slashes creates the folders.
4. Paste what you copied, then click **Commit changes**.
5. Go to the **Actions** tab. If GitHub asks, click to enable workflows. Then open **Auto-update** and click **Run workflow** to update right away instead of waiting a day.

Cloudflare redeploys a minute or two later. Open the app and you'll see a note about what's new. Then re-copy the Sync bookmark from Settings once, so it can pull grades. Your old bookmark still works without them.
- **Public repos:** GitHub pauses scheduled workflows in public repos after 60 days with no activity. If that happens, re-enable it in the Actions tab. Private repos aren't affected.
- **Deployed from the command line instead of the button?** Your copy isn't connected to Cloudflare, so pulls don't redeploy on their own. In the Cloudflare dashboard, open Workers & Pages → your tracker → Settings → Build → Connect, and pick your repo. After that it works like the button version.

## For developers

```bash
git clone https://github.com/ishaanmakam/canvas-hw-tracker.git
cd canvas-hw-tracker
npm install
npm run deploy        # logs you in to Cloudflare, creates the KV storage, deploys
npm test              # parser, merge and push-encryption tests
npm run dev           # local server at http://localhost:8787
```

How it fits together:

```
Canvas calendar feed ──(every 30 min)──▶ Worker ──▶ KV storage ◀── web app (installable PWA)
Sync bookmark on Canvas ──(POST /api/sync)──▶ Worker
Worker cron ──(Web Push: VAPID + aes128gcm)──▶ Apple / Google push ──▶ your phone
```

| File | What it does |
| --- | --- |
| `src/index.js` | API, first-run setup, sign-in, the 30-minute cron, reminders, digest, new-assignment alerts |
| `src/model.js` | Calendar feed parsing (with time zones), Canvas planner mapping, merging |
| `src/push.js` | Web Push encryption and signing with WebCrypto, no dependencies |
| `public/` | The app: HTML, CSS, JS, service worker, icons, vendored QR code generator |
| `public/sync.js` | What the Sync bookmark runs on Canvas: planner, submissions, module readings, grades |
| `.github/workflows/auto-update.yml` | Daily self-update for each user's copy |

Reminder defaults are in `DEFAULT_PREFS` at the top of `src/index.js`. Each user can change them in Settings.

**Releasing an update:** push to `main` here and bump `version` in `package.json`. Add a line for that version to `WHATS_NEW` in `public/app.js` and to `CHANGELOG.md`. Every copy picks it up within a day. Keep `wrangler.toml` changes backwards compatible: updates keep each copy's `name` and KV `id` and take everything else from here. Stored data has no migrations, so new code has to handle items and settings saved by older versions.

Settings live in KV under `config`. Older installs that set `APP_KEY`, `CANVAS_ICS_URL` and `VAPID_*` as Worker secrets keep working, because secrets take priority over KV.

## License

MIT. See [LICENSE](LICENSE). The bundled QR code generator (`public/vendor/qrcode.js`) is MIT, © Kazuhiko Arase.

Not affiliated with Instructure or Canvas.
