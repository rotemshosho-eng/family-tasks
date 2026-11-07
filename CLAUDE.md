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
- `functions/index.js`: **real-time** pushes as Firebase Cloud Functions (v2 Firestore triggers): chat, new task, approvals/redeem, complaints (+handled, +comments), dev notes (+status), nudges, new challenge, new monthly goal. Deployed by `.github/workflows/deploy-functions.yml` (on push to `functions/**`, or Run workflow). The region follows the Firestore location. After a successful deploy the workflow writes `system/functions`; from then `notify.mjs` skips its real-time sections and only does the scheduled ones (evening reminder, streaks, challenge bonus, Saturday winner, weekly summary).
  Needs the Blaze plan, and the service account (FIREBASE_SERVICE_ACCOUNT) with roles: Editor, Cloud Functions Admin, Project IAM Admin (Google Cloud → IAM).
  Why: GitHub's 5-minute cron really runs every ~35-45 minutes, so pushes from notify.mjs arrived late.

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
Animation work: `tests/film.mjs` captures a contact sheet of a kitchen animation at chosen times (see its header); look at the frames, a clean run proves nothing about how it looks.

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
- Challenge: its own task list `settings/challenge.items` (`{id,title}`, max 30), separate from regular tasks. Done marks in `challengeItems/<itemId>` (`key` = `cid`, or `start|title` for older challenges; editing keeps `cid`, `memberId`, optional `by`). Bonus paid by notify.mjs when all items are done.
- Kitchen (button "חמם לי" in the bottom bar: it opens the kitchen sheet, it is not a tab; a red badge counts dishes waiting for you): the animations are front-end only (sending a dish uses Firestore, see Dishes below). `KITCHEN` in app.js maps each food to an action (`heat` microwave, `cut` board, `toasting` toaster, `pour` glass, `fry` pan, `blend` blender, `bake` oven); each action is an SVG scene plus an async timeline, so a new food is one line. `KSCENE[action](food)` returns the scene's SVG markup (a tiled wall, wood counter and appliance, built fresh on every pick: `kReset` mounts it into `#kScene`), `kHeat/kCut/kToast/kPour/kFry/kBlend/kBake(food, c)` play it with `c = kTools(T, run)` (`a` animates an element with the Web Animations API and waits, `z` waits, `loop` repeats; `alive()` turns false when another food is picked, so every `await` is followed by a check), and particles (steam, juice, sparks, crumbs, bubbles) are drawn on the canvas `#kFx` (`kPuff`, `kDrops`, `kSparkle`, `kCrumbs`, `kBubble`, `kFlourish`). All sound is synthesized (`kSND`, WebAudio, no files). There are no state classes any more, state lives in the DOM of the SVG, so the old class-collision trap (`done`, `toast`) is gone; the `#kScene` mode class is only a hook for tests, and every scene keeps a text `#kFood` with the food's emoji. Tricks worth knowing: slicing measures the emoji's real pixel bounds on an offscreen canvas (`kInk`) and clips one copy per strip; the food is drawn twice (`kFoodLayers`: pale and toasted) and cross-faded; an SVG `transform` set by an animation overrides the attribute, so animate wrapper groups, not elements that carry a static transform. A new action = `KSCENE.x`, `async function kX`, an entry in `KRUN` and `KACTIONS`.
- Dishes (kitchen → send to a family member): `dishes/<from>__<to>__<w>` where `w` = floor(at / 10 min), so the id itself caps it at one dish per pair per 10 minutes (the rule checks `w` with integer maths only). Fields `{from,to,e,n,a,c?,at,w}`; the recipient adds `eaten` + `ateAt`; the sender cannot delete. Pushes come from `functions/index.js` (`onDish`, `onDishEaten`; the dish push links to `?kitchen=1`, which opens the kitchen, also from an already-open app via a service-worker message). `notify.mjs` deletes dishes older than 3 days. Rules for `dishes` were never run against the emulator.
- Bump (הקפצה): the admin bumps people or a task (auto-id docs in `nudges`, pushed by `onNudge`). Members the admin ticked "יכול להקפיץ" (`canNudge`, optional `nudgeLimited` + `nudgeEveryMin`, default in `settings/perms`) can bump the challenge (`nudges/challenge`) or one task: the 📣 on a task card writes `nudges/bump__<member>` `{by,taskId,at}`, rewritten each time, so the rule can enforce the time limit from the document's own `at`; `onBump` pushes. The button shows only on a task that is due today and not that member's own turn. `notify.mjs` has a fallback for when the functions are not deployed.

## Working with Rotem
- He writes in Hebrew (sometimes typed on an English keyboard layout — decode it).
- His standing style rules: don't open by agreeing; challenge first; tag claims [בטוח]/[סביר]/[ניחוש]; put the unpleasant truth first; no flattery; hold your position unless he gives new information.
- He tests on real phones (Samsung/Android and iPhone). After a push, tell him to fully close and reopen the app.
- Never paste the service account JSON anywhere; it lives only in the GitHub secret.
- Push delivery report: `onDish` and `onBump` write `pushed` (count sent), `phones` (registered tokens for the target) and, for bumps, `to` back onto their own doc (`at`/`eaten` unchanged, so no loop). The app shows it: `kPushNote` in the outbox row, a toast in `kDishesIn` when a dish gets `pushed:0`, and `bumpFeedback` after a bump. A phone registers push only as its own member (profile panel is shown only for `S.boundId`, or the unbound admin's own member), with a "רישום מחדש" button; the old behaviour let the admin register his phone under someone else's profile, so their dishes/bumps went to the wrong phone.
- Kitchen send popup (`#kPop`, `kRenderPop`): the send row is one button; the popup holds "send the picked food to X" chips and "🍽️ בואו לאכול!" (`kCallAll`), which writes a normal dish named exactly `בואו לאכול!` (action `heat`) to every other member; `onDish` recognises that name and pushes "X קורא: בואו לאכול!". No rules change needed (same dish rules, 10-minute cap per pair).
- Dish time limit is `settings/perms.dishEveryMin` (admin screen, default 10): the window `w` = floor(at / (N min)); `dishMs()` in the rules and app.js must agree, so changing the rules needs a paste by Rotem. Emulator-tested (34/34).
- The free-text field and the food list live in the popup `#kFoodPop` (button `#kFoodOpen`); `kPick` closes it. Admin dish limit is in `#dishPop` (button `#dishLimitOpen`).
- A dish may carry `call: true` ("🍽️ בואו לאכול!" with the food; rules allow only `true`): the push then reads "X קורא: בואו לאכול! 🧆 קציצות". The send popup can send the picked food to one person or to everyone (`kSendAll`), with or without the call, or a plain call to everyone (`kCallAll`, no food). Adding this key needed a rules paste.
- "I'm coming" reply: on a dish with `call: true` the recipient taps 🏃 בדרך → `coming: true, comingAt` (the rules allow that update only on its own, separate from `eaten`); `onDishComing` pushes only to the caller (`d.from`), and the caller's outbox shows "X בדרך 🏃". Needs the rules paste. Smoke fixture `d4` is a call dish.
- The reply button exists on every received dish (same `coming`/`comingAt` fields, no extra rules): "🏃 בדרך" on a come-and-eat call, "✅ מוכן לאכילה" on a plain dish; `onDishComing` words the push accordingly.
- The kitchen is part of the page, not an overlay window: `#kitchenSheet` sits above the bottom bar (which stays usable; other tabs close the kitchen), and the three former popups (`#kFoodPop`, `#kPop`, `#dishPop`) are inline `.kpop` sections that open in place under their buttons (the button toggles them).
