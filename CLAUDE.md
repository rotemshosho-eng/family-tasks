# קופצי — notes for Claude Code

Hebrew, RTL family chores app with points ("קופצי"). Installed as a PWA on the family's phones.
Owner and admin: Rotem (rotemshosho@gmail.com). Rotem is **not** a parent; he's the "king" (admin), and the parents are regular members with the `parent` role.

- Live: https://rotemshosho-eng.github.io/family-tasks/ (GitHub Pages, deploys on every push to `main`, ~1 minute)
- Data: Firebase project `family-tasks-b0fa7` (Firestore, Auth: Anonymous + Google, FCM push)
- Notifications: `notify/notify.mjs` runs on GitHub Actions every 5 minutes (`.github/workflows/notify.yml`, secret `FIREBASE_SERVICE_ACCOUNT`)

## Files
- `index.html`: all screens (tabs: בית / משימות / ארנק / משפחה / ניהול), splash, sheets (chat, profile, complaints, dev notes)
- `app.js`: one ES module, no build step. `h()` DOM helper, global state `S`, `render()` re-renders everything on every Firestore snapshot.
- `style.css`: design tokens at the top, later sections append overrides (newest at the bottom win).
- `firestore.rules`: **all** permission enforcement. `'ADMIN_EMAIL'` placeholder is replaced when printed for pasting.
- `sw.js`: network-first service worker. **Bump `CACHE` (`family-tasks-vNN`) on every push** or phones keep the old version.
- `notify/notify.mjs`: push notifications, streak bonus, Saturday-night winner, weekly summary, challenge bonus.
- `tests/`: smoke test (see below).

## Deploy routine
1. `node --check` on app.js (copy to `.mjs` first) and notify.mjs
2. Run the smoke test in all modes
3. Bump the version in `sw.js`, commit, push to `main`
4. If `firestore.rules` changed, the rules must be **pasted by Rotem** into Firebase → Firestore → Rules → Publish. Give him the full file with the email filled in and comment lines removed:
   `sed "s/'ADMIN_EMAIL'/'rotemshosho@gmail.com'/" firestore.rules | grep -v "^ *//"`
   Remind him that line 1 must be `rules_version = '2';` without `//` (it once got commented out and broke everything).

## Smoke test
Loads the real app in headless Chromium with Firebase faked and family data mocked, clicks every tab, fails on any script error.
```
npm i -D playwright   # once
for m in "kid x" "admin x" "admin plain" "parent x"; do node tests/run2.mjs $m && node tests/page2.mjs "$m" || break; done
```
It caught a real blank-screen bug (using `store` before it was defined). Run it before every push.

## Concepts worth knowing
- Roles: `admin` (only Rotem), `parent`, `child`. Admin = Google email OR admin code (`adminSessions/<uid>` matches `private/admin`).
- A phone is bound to a member by a 4-digit code (`bindings/<uid>` + `pins/<member>`), or a Google account linked on the member doc.
- Admin "plain mode" (`ft-plain` in localStorage): regular look, admin powers kept. "View as" = look-only preview of another member.
- Logs: kinds `task`, `timed`, `bonus`, `redeem`. `approved`: missing/true = counted, `false` = waiting, `'rejected'`.
  `by` = a parent acted for someone else. `watch: true` on a member = every action they take waits for the **admin**.
  `canMarkFor` on a parent = who they may mark for (default: children).
- Tasks: fixed points, timed (`ratePerMin`, `maxMinutes`), quantity (`qtyPer`, `qtyUnit`), boss (×3, once), `assignee` = member id / `all` / `each` / `rotate`, optional `untilTime`, optional `check` (needs approval).
- Splash/home jokes: `SPLASH_JOKES` (set-up + twist, `'k'` = kids only), `SILLY_NAMES` + `SILLY_INTROS`; 50/50 between them. Admin gets `PRAISE_POOL`.
- Settings docs: `settings/goal`, `settings/challenge`, `settings/money`, `settings/perms` (`parentPoints`).
- Challenge: its own task list `settings/challenge.items` (`{id,title}`, max 30), separate from regular tasks. Done marks in `challengeItems/<itemId>` (`key` = `start|title`, `memberId`, optional `by`). Bonus paid by notify.mjs when all items are done.

## Working with Rotem
- He writes in Hebrew (sometimes typed on an English keyboard layout — decode it).
- His standing style rules: don't open by agreeing; challenge first; tag claims [בטוח]/[סביר]/[ניחוש]; put the unpleasant truth first; no flattery; hold your position unless he gives new information.
- He tests on real phones (Samsung/Android and iPhone). After a push, tell him to fully close and reopen the app.
- Never paste the service account JSON anywhere; it lives only in the GitHub secret.
