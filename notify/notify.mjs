// Sends push notifications for the family task board. Runs every few minutes from GitHub Actions.
// Needs the secret FIREBASE_SERVICE_ACCOUNT (the JSON key from Firebase → Project settings → Service accounts).
//
// What it sends:
//   • a new chat message on a task      → everyone except whoever wrote it
//   • a new task                        → the person it's assigned to (or everyone, minus whoever added it)
//   • once a day after 19:00 (Israel)   → each person who still has tasks left today
//   • a task waiting for approval       → whoever is marked as admin
//   • 3, 7, 14, 21... days in a row      → an automatic streak bonus (added here, server-side) + a notification
//   • Saturday after 20:00               → everyone: who won the week
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const APP_URL = 'https://rotemshosho-eng.github.io/family-tasks/';
const TZ = 'Asia/Jerusalem';
const REMIND_HOUR = 19;
const MAX_LOOKBACK_MS = 60 * 60 * 1000; // never send about anything older than an hour

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT is not set; nothing to do.'); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const fcm = getMessaging();

// Same day/weekday logic the app uses, in Israel time.
const parts = d => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
  .formatToParts(d).map(p => [p.type, p.value]));
const now = new Date(); const P = parts(now);
const today = `${P.year}-${P.month}-${P.day}`;
const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(P.weekday);
const hour = Number(P.hour) % 24;

const all = async name => (await db.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const stateRef = db.doc('system/notify');
const state = (await stateRef.get()).data() || {};
const since = Math.max(state.lastRun || now.getTime() - 10 * 60 * 1000, now.getTime() - MAX_LOOKBACK_MS);

const [members, tasks, tokens] = await Promise.all([all('members'), all('tasks'), all('pushTokens')]);
const name = id => members.find(m => m.id === id)?.name || 'מישהו';
const tokensFor = ids => tokens.filter(t => ids.includes(t.memberId)).map(t => t.id);
const everyone = members.map(m => m.id);
const outbox = []; // { to: [memberIds], title, body, tag }
const allLogs = await all('logs');
const counted = l => l.approved === undefined || l.approved === true;
const rejected = l => l.approved === 'rejected';
// Rotation: same rule as the app; the turn moves on each time the task is done.
const doneCount = t => allLogs.filter(l => l.taskId === t.id && (l.kind === 'task' || l.kind === 'timed') && !rejected(l)).length;
function whoseTurn(t) {
  if (t.assignee === 'each') return 'all';
  if (t.assignee !== 'rotate') return t.assignee || 'all';
  const r = (t.rotation || []).filter(id => members.some(m => m.id === id));
  return r.length ? r[doneCount(t) % r.length] : 'all';
}
const dayStr = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
const daysAgo = n => dayStr(new Date(now.getTime() - n * 86400000));

// 1. chat messages since the last run
const msgs = (await db.collection('messages').where('at', '>', Timestamp.fromMillis(since)).get()).docs.map(d => d.data());
const byTask = new Map();
for (const m of msgs) { if (!byTask.has(m.taskId)) byTask.set(m.taskId, []); byTask.get(m.taskId).push(m); }
for (const [taskId, list] of byTask) {
  const t = tasks.find(x => x.id === taskId); if (!t) continue;
  const senders = new Set(list.map(m => m.memberId));
  const last = list.sort((a, b) => a.at.toMillis() - b.at.toMillis()).at(-1);
  const body = list.length === 1 ? `${name(last.memberId)}: ${last.text}` : `${list.length} הודעות חדשות · ${name(last.memberId)}: ${last.text}`;
  // everyone except people whose only messages are their own
  outbox.push({ to: everyone.filter(id => !(senders.size === 1 && senders.has(id))), title: `צ'אט: ${t.title}`, body: body.slice(0, 180), tag: `chat-${taskId}` });
}

// 1b. complaints: new ones -> admin, parents and whoever it's about; handled ones -> who complained
{
  const cps = await all('complaints');
  const handlers = members.filter(m => m.admin === true || m.role === 'admin' || m.role === 'parent').map(m => m.id);
  for (const c of cps.filter(c => (c.at || 0) > since)) {
    const to = [...new Set([...handlers, ...(c.about ? [c.about] : [])])].filter(id => id !== c.by);
    outbox.push({ to, title: `📢 תלונה חדשה מ${name(c.by)}${c.about ? ` על ${name(c.about)}` : ''}`, body: String(c.text || '').slice(0, 160), tag: `cp-${c.id}` });
  }
  const cms = await all('cpComments');
  for (const c of cps) {
    const fresh = cms.filter(x => x.cpId === c.id && (x.at || 0) > since).sort((a, b) => a.at - b.at); if (!fresh.length) continue;
    const last = fresh.at(-1); const writers = new Set(fresh.map(x => x.memberId));
    const people = new Set([c.by, ...(c.about ? [c.about] : []), ...cms.filter(x => x.cpId === c.id).map(x => x.memberId)]);
    const to = [...people].filter(id => !(writers.size === 1 && writers.has(id)));
    outbox.push({ to, title: `💬 תגובה על תלונה: ${String(c.text || '').slice(0, 30)}`, body: `${name(last.memberId)}: ${String(last.text).slice(0, 150)}`, tag: `cpc-${c.id}` });
  }
  for (const c of cps.filter(c => (c.handledAt || 0) > since && c.status !== 'open')) {
    const to = [...new Set([c.by, ...(c.target ? [c.target] : [])])];
    const pts = c.pts ? ` · ${c.pts > 0 ? '+' : ''}${c.pts} נקודות ל${name(c.target)}` : '';
    outbox.push({ to, title: c.status === 'done' ? '✓ התלונה טופלה' : '✗ התלונה נדחתה', body: `${String(c.text || '').slice(0, 60)}${c.reply ? ` · 👑 ${c.reply}` : ''}${pts}`, tag: `cp-${c.id}` });
  }
}

// 1c. notes to the developer -> admin only
{
  const kinds = { bug: '🐞 באג', idea: '💡 רעיון', ux: '😕 לא נוח', other: '💬 הערה' };
  for (const n of (await all('devNotes')).filter(n => (n.at || 0) > since))
    outbox.push({ to: members.filter(m => m.admin === true || m.role === 'admin').map(m => m.id).filter(id => id !== n.by), title: `🛠️ ${kinds[n.kind] || 'הערה'} מ${name(n.by)}`, body: String(n.text || '').slice(0, 170), tag: `dn-${n.id}` });
}

// 1d. a note's status changed -> tell whoever wrote it
for (const n of (await all('devNotes')).filter(n => (n.statusAt || 0) > since && n.status !== 'new'))
  outbox.push({ to: [n.by], title: n.status === 'doing' ? '🔧 ההערה שלך בטיפול' : '✓ ההערה שלך טופלה', body: String(n.text || '').slice(0, 150), tag: `dn-${n.id}` });

// 2. new tasks since the last run
for (const t of tasks.filter(t => (t.createdAt || 0) > since)) {
  const turn = whoseTurn(t);
  const to = turn !== 'all' ? [turn] : everyone.filter(id => id !== t.suggestedBy);
  const pts = t.timed ? `${t.ratePerMin} נקודות לדקה` : t.qtyPer ? `${t.points} נקודות על כל ${t.qtyPer} ${t.qtyUnit}` : `${t.points} נקודות`;
  if (t.boss) { outbox.push({ to: everyone, title: '🐉 משימת בוס חדשה!', body: `${t.title} · ${t.points * 3} נקודות למי שעושה ראשון`, tag: `task-${t.id}` }); continue; }
  outbox.push({ to: to.filter(id => id !== t.suggestedBy), title: 'משימה חדשה', body: `${t.title} · ${pts}`, tag: `task-${t.id}` });
}

// 2b. points spent on a reward since the last run -> admin and parents
const admins = members.filter(m => m.admin === true).map(m => m.id);
{
  const fresh = allLogs.filter(l => typeof l.at === 'number' && l.at > since);
  const approvers = members.filter(m => m.admin === true || m.role === 'admin' || m.role === 'parent').map(m => m.id);
  for (const l of fresh.filter(l => l.approved === false)) outbox.push({ to: approvers.filter(id => id !== l.memberId),
    title: l.kind === 'redeem' ? '🤝 בקשת הלוואה' : 'משימה מחכה לאישור', body: `${name(l.memberId)}: ${l.title} · ${l.points} נקודות`, tag: `review-${l.memberId}-${l.at}` });
  const spent = fresh.filter(l => l.kind === 'redeem' && l.approved !== false);
  for (const l of spent) outbox.push({ to: approvers.filter(id => id !== l.memberId), title: `${name(l.memberId)} השתמש/ה בנקודות`, body: `${l.title} · ${l.points} נקודות`, tag: `redeem-${l.memberId}-${l.at}` });
}

// 3. evening reminder, once a day
if (hour >= REMIND_HOUR && state.remindedDay !== today) {
  const logs = allLogs.filter(l => l.day === today);
  const hm = `${String(hour).padStart(2, '0')}:00`;
  const isDue = (t, m) => {
    if (t.pending) return false;
    if (t.untilTime && t.untilTime <= hm) return false; // its time has passed (e.g. "wake up by 07:30")
    const by = l => l.taskId === t.id && !rejected(l) && (t.assignee !== 'each' || l.memberId === m);
    if (t.type === 'once') return !allLogs.some(by);
    return (t.days || []).includes(dow) && !logs.some(by);
  };
  for (const m of members) {
    const left = tasks.filter(t => { if (!isDue(t, m.id)) return false; const w = whoseTurn(t); return w === m.id || w === 'all'; });
    if (!left.length) continue;
    const list = left.slice(0, 3).map(t => t.title).join(', ') + (left.length > 3 ? ' ועוד' : '');
    outbox.push({ to: [m.id], title: `נשארו לך ${left.length} משימות להיום`, body: list, tag: 'evening' });
  }
  state.remindedDay = today;
}

// 4. streak bonus: days in a row with at least one approved task. 3 days = 10, 7 and every 7 after = 30.
const STREAK_BONUS = n => n === 3 ? 10 : (n >= 7 && n % 7 === 0 ? 30 : 0);
for (const m of members) {
  const days = new Set(allLogs.filter(l => l.memberId === m.id && (l.kind === 'task' || l.kind === 'timed') && counted(l)).map(l => l.day));
  if (!days.has(today)) continue;
  let streak = 0; while (days.has(daysAgo(streak))) streak++;
  const pts = STREAK_BONUS(streak); if (!pts) continue;
  const already = allLogs.some(l => l.memberId === m.id && l.kind === 'bonus' && l.auto === 'streak' && l.day === today);
  if (already) continue;
  const log = { kind: 'bonus', auto: 'streak', title: `בונוס רצף: ${streak} ימים ברצף`, memberId: m.id, points: pts, day: today, at: now.getTime() };
  await db.collection('logs').add(log); allLogs.push(log);
  outbox.push({ to: [m.id], title: `🔥 ${streak} ימים ברצף!`, body: `קיבלת בונוס של ${pts} נקודות`, tag: `streak-${m.id}` });
}

// 4b. family challenge reached -> everyone gets the bonus (once per challenge)
{
  const c = (await db.doc('settings/challenge').get()).data();
  if (c && c.target > 0 && c.bonus > 0 && c.start && c.until) {
    const key = `${c.start}|${c.title}`;
    const n = allLogs.filter(l => (l.kind === 'task' || l.kind === 'timed') && counted(l) && l.day >= c.start && l.day <= c.until).length;
    const paid = allLogs.some(l => l.auto === 'challenge' && l.key === key);
    if (n >= c.target && !paid) {
      const joins = (await db.collection('challengeJoins').get()).docs.map(d => ({ id: d.id, ...d.data() }));
      const inIt = m => joins.some(j => j.id === m.id && j.key === key)
        || allLogs.some(l => l.memberId === m.id && (l.kind === 'task' || l.kind === 'timed') && counted(l) && l.day >= c.start && l.day <= c.until);
      const winners = members.filter(inIt);
      for (const m of winners) {
        const log = { kind: 'bonus', auto: 'challenge', key, title: `בונוס אתגר: ${c.title}`, memberId: m.id, points: c.bonus, day: today, at: now.getTime() };
        await db.collection('logs').add(log); allLogs.push(log);
      }
      outbox.push({ to: everyone, title: '🎉 ניצחתם באתגר!', body: `${c.title}: ${winners.map(m => m.name).join(', ')} קיבלו ${c.bonus} נקודות בונוס${c.prize ? ` · ${c.prize}` : ''}`, tag: 'challenge' });
    }
  }
}

// 5. Saturday night: who won the week (Sunday to Saturday), once a week
if (dow === 6 && hour >= 20 && state.ceremonyDay !== today) {
  const weekStart = daysAgo(6);
  const totals = members.map(m => ({ m, pts: allLogs.filter(l => l.memberId === m.id && l.kind !== 'redeem' && counted(l) && l.day >= weekStart && l.day <= today)
    .reduce((s, l) => s + (Number(l.points) || 0), 0) })).sort((a, b) => b.pts - a.pts);
  if (totals.length && totals[0].pts > 0) {
    const top = totals.filter(x => x.pts === totals[0].pts).map(x => x.m.name);
    const who = top.length === 1 ? top[0] : top.join(' ו');
    outbox.push({ to: everyone, title: `👑 ${top.length === 1 ? 'האלוף' : 'האלופים'} של השבוע: ${who}`, body: `${totals[0].pts} נקודות השבוע. שבוע חדש מתחיל מחר, בהצלחה לכולם!`, tag: 'weekly-winner' });
  }
  // personal weekly summary, compared with last week
  const prevStart = daysAgo(13), prevEnd = daysAgo(7);
  const work = l => (l.kind === 'task' || l.kind === 'timed') && counted(l);
  for (const m of members) {
    const mine = allLogs.filter(l => l.memberId === m.id && work(l));
    const now = mine.filter(l => l.day >= weekStart && l.day <= today), prev = mine.filter(l => l.day >= prevStart && l.day <= prevEnd);
    if (!now.length && !prev.length) continue;
    const pts = now.reduce((s, l) => s + (Number(l.points) || 0), 0);
    const diff = prev.length ? Math.round((now.length - prev.length) / prev.length * 100) : null;
    const cmp = diff === null ? '' : diff > 0 ? ` · ${diff}% יותר משבוע שעבר 💪` : diff < 0 ? ` · ${-diff}% פחות משבוע שעבר` : ' · בדיוק כמו שבוע שעבר';
    outbox.push({ to: [m.id], title: '📊 השבוע שלך', body: `${now.length} משימות, ${pts} נקודות${cmp}`, tag: `summary-${m.id}` });
  }
  state.ceremonyDay = today;
}

// send
let sent = 0; const dead = new Set();
for (const n of outbox) {
  const toks = tokensFor(n.to); if (!toks.length) continue;
  for (let i = 0; i < toks.length; i += 500) {
    const chunk = toks.slice(i, i + 500);
    const res = await fcm.sendEachForMulticast({
      tokens: chunk,
      data: { title: n.title, body: n.body, tag: n.tag, link: APP_URL },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } },
    });
    res.responses.forEach((r, j) => {
      if (r.success) sent++;
      else if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'].includes(r.error?.code)) dead.add(chunk[j]);
      else console.log('send failed:', r.error?.code);
    });
  }
}
for (const t of dead) await db.doc(`pushTokens/${t}`).delete();
await stateRef.set({ ...state, lastRun: now.getTime() });
console.log(`notifications: ${outbox.length} prepared, ${sent} delivered, ${dead.size} stale tokens removed`);
