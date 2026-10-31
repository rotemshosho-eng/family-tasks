// Real-time push notifications for קופצי. Each function runs the moment something is written to Firestore,
// so notifications go out within seconds. (The scheduled ones — evening reminder, streak bonus, Saturday winner,
// weekly summary, challenge bonus — stay in notify/notify.mjs on GitHub Actions, where a delay doesn't matter.)
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

// The deploy workflow sets FN_REGION from the Firestore database location (triggers must run next to the database).
setGlobalOptions({ region: process.env.FN_REGION || 'us-central1', maxInstances: 5, memory: '256MiB' });
initializeApp();
const db = getFirestore();
const fcm = getMessaging();
const APP_URL = 'https://rotemshosho-eng.github.io/family-tasks/';
const TZ = 'Asia/Jerusalem';

/* ---------- shared helpers ---------- */
const all = async name => (await db.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() }));
async function family(){
  const members = await all('members');
  const name = id => members.find(m => m.id === id)?.name || 'מישהו';
  const ids = members.map(m => m.id);
  const admins = members.filter(m => m.admin === true || m.role === 'admin').map(m => m.id);
  const approvers = members.filter(m => m.admin === true || m.role === 'admin' || m.role === 'parent').map(m => m.id);
  return { members, name, ids, admins, approvers };
}
const rejected = l => l.approved === 'rejected';
function israelNow(){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, dow: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday), hm: `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}` };
}
function turnOf(t, members, logs){
  if (t.assignee === 'each') return 'all';
  if (t.assignee !== 'rotate') return t.assignee || 'all';
  const r = (t.rotation || []).filter(id => members.some(m => m.id === id));
  const done = logs.filter(l => l.taskId === t.id && (l.kind === 'task' || l.kind === 'timed') && !rejected(l)).length;
  return r.length ? r[done % r.length] : 'all';
}
// sends one notification to the phones of these members; removes tokens of phones that uninstalled
async function push(to, title, body, tag){
  to = [...new Set((to || []).filter(Boolean))]; if (!to.length) return 0;
  const toks = (await all('pushTokens')).filter(t => to.includes(t.memberId)).map(t => t.id); if (!toks.length) return 0;
  let sent = 0;
  for (let i = 0; i < toks.length; i += 500){
    const chunk = toks.slice(i, i + 500);
    const res = await fcm.sendEachForMulticast({ tokens: chunk, data: { title, body: String(body || '').slice(0, 200), tag: tag || 'kofzi', link: APP_URL }, webpush: { headers: { Urgency: 'high', TTL: '3600' } } });
    await Promise.all(res.responses.map((r, j) => {
      if (r.success){ sent++; return null; }
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'].includes(r.error?.code)) return db.doc(`pushTokens/${chunk[j]}`).delete();
      console.log('send failed:', r.error?.code); return null;
    }));
  }
  return sent;
}
const list3 = arr => arr.slice(0, 3).join(', ') + (arr.length > 3 ? ` ועוד ${arr.length - 3}` : '');

/* ---------- chat ---------- */
export const onChat = onDocumentCreated('messages/{id}', async ev => {
  const m = ev.data?.data(); if (!m) return;
  const F = await family();
  let title = "צ'אט";
  if (m.taskId && m.taskId !== 'general'){ const t = (await db.doc(`tasks/${m.taskId}`).get()).data(); if (!t) return; title = `צ'אט: ${t.title}`; }
  await push(F.ids.filter(id => id !== m.memberId), title, `${F.name(m.memberId)}: ${m.text}`, `chat-${m.taskId}`);
});

/* ---------- new task ---------- */
export const onTask = onDocumentCreated('tasks/{id}', async ev => {
  const t = ev.data?.data(); if (!t) return;
  const F = await family();
  if (t.boss) return push(F.ids, '🐉 משימת בוס חדשה!', `${t.title} · ${(t.points || 0) * 3} נקודות למי שעושה ראשון`, `task-${ev.params.id}`);
  const turn = turnOf(t, F.members, []);
  const to = (turn !== 'all' ? [turn] : F.ids).filter(id => id !== t.suggestedBy);
  const pts = t.timed ? `${t.ratePerMin} נקודות לדקה` : t.qtyPer ? `${t.points} נקודות על כל ${t.qtyPer} ${t.qtyUnit}` : `${t.points} נקודות`;
  await push(to, 'משימה חדשה', `${t.title} · ${pts}`, `task-${ev.params.id}`);
});

/* ---------- logs: waiting for approval, points spent ---------- */
export const onLog = onDocumentCreated('logs/{id}', async ev => {
  const l = ev.data?.data(); if (!l || l.auto) return;
  const F = await family();
  const actor = l.by || l.memberId;
  const watched = F.members.some(m => m.id === actor && m.watch === true);
  if (l.approved === false){
    if (l.kind === 'bonus' || watched)
      return push(F.admins.filter(id => id !== actor), l.kind === 'bonus' ? '➕➖ בקשה לשינוי נקודות' : `🚩 ${F.name(actor)} מחכה לאישור`,
        `${l.by && l.by !== l.memberId ? `${F.name(l.by)} → ` : ''}${F.name(l.memberId)}: ${l.points > 0 ? '+' : ''}${l.points} · ${l.title}`, `review-${ev.params.id}`);
    return push(F.approvers.filter(id => id !== l.memberId), l.kind === 'redeem' ? '🤝 בקשת הלוואה' : 'משימה מחכה לאישור', `${F.name(l.memberId)}: ${l.title} · ${l.points} נקודות`, `review-${ev.params.id}`);
  }
  if (l.kind === 'redeem') return push(F.approvers.filter(id => id !== l.memberId), `${F.name(l.memberId)} השתמש/ה בנקודות`, `${l.title} · ${l.points} נקודות`, `redeem-${ev.params.id}`);
});

/* ---------- complaints ---------- */
export const onComplaint = onDocumentCreated('complaints/{id}', async ev => {
  const c = ev.data?.data(); if (!c) return;
  const F = await family();
  const handlers = F.members.filter(m => m.admin === true || m.role === 'admin' || m.role === 'parent').map(m => m.id);
  await push([...handlers, ...(c.about ? [c.about] : [])].filter(id => id !== c.by), `📢 תלונה חדשה מ${F.name(c.by)}${c.about ? ` על ${F.name(c.about)}` : ''}`, c.text, `cp-${ev.params.id}`);
});
export const onComplaintHandled = onDocumentUpdated('complaints/{id}', async ev => {
  const before = ev.data?.before.data(), c = ev.data?.after.data(); if (!before || !c) return;
  if (before.status !== 'open' || c.status === 'open') return;
  const F = await family();
  const pts = c.pts ? ` · ${c.pts > 0 ? '+' : ''}${c.pts} נקודות ל${F.name(c.target)}` : '';
  await push([c.by, ...(c.target ? [c.target] : [])], c.status === 'done' ? '✓ התלונה טופלה' : '✗ התלונה נדחתה', `${String(c.text || '').slice(0, 60)}${c.reply ? ` · 👑 ${c.reply}` : ''}${pts}`, `cp-${ev.params.id}`);
});
export const onComplaintComment = onDocumentCreated('cpComments/{id}', async ev => {
  const x = ev.data?.data(); if (!x) return;
  const c = (await db.doc(`complaints/${x.cpId}`).get()).data(); if (!c) return;
  const F = await family();
  const others = (await db.collection('cpComments').where('cpId', '==', x.cpId).get()).docs.map(d => d.data().memberId);
  const to = [c.by, ...(c.about ? [c.about] : []), ...others].filter(id => id !== x.memberId);
  await push(to, `💬 תגובה על תלונה: ${String(c.text || '').slice(0, 30)}`, `${F.name(x.memberId)}: ${x.text}`, `cpc-${x.cpId}`);
});

/* ---------- notes to the developer ---------- */
const KINDS = { bug: '🐞 באג', idea: '💡 רעיון', ux: '😕 לא נוח', other: '💬 הערה' };
export const onDevNote = onDocumentCreated('devNotes/{id}', async ev => {
  const n = ev.data?.data(); if (!n) return;
  const F = await family();
  await push(F.admins.filter(id => id !== n.by), `🛠️ ${KINDS[n.kind] || 'הערה'} מ${F.name(n.by)}`, n.text, `dn-${ev.params.id}`);
});
export const onDevNoteStatus = onDocumentUpdated('devNotes/{id}', async ev => {
  const b = ev.data?.before.data(), n = ev.data?.after.data(); if (!b || !n || b.status === n.status || n.status === 'new') return;
  await push([n.by], n.status === 'doing' ? '🔧 ההערה שלך בטיפול' : '✓ ההערה שלך טופלה', n.text, `dn-${ev.params.id}`);
});

/* ---------- nudges ("הקפצות") ---------- */
async function pendingFor(F){
  const [tasks, logs] = await Promise.all([all('tasks'), all('logs')]);
  const N = israelNow(); const todays = logs.filter(l => l.day === N.day);
  const dueFor = (t, m) => {
    if (t.pending) return false;
    if (t.untilTime && t.untilTime <= N.hm) return false;
    const by = l => l.taskId === t.id && !rejected(l) && (t.assignee !== 'each' || l.memberId === m);
    if (t.type === 'once') return !logs.some(by);
    return (t.days || []).includes(N.dow) && !todays.some(by);
  };
  const ch = (await db.doc('settings/challenge').get()).data();
  const key = ch ? (ch.cid || `${ch.start}|${ch.title}`) : null;
  const items = ch && Array.isArray(ch.items) ? ch.items.filter(i => i && i.id) : [];
  const chOn = !!ch && items.length > 0 && ch.until >= N.day;
  let chLeft = [];
  if (chOn){ const marks = (await all('challengeItems')).filter(d => d.key === key); chLeft = items.filter(i => !marks.some(m => m.id === i.id)); }
  const mine = m => tasks.filter(t => { if (!dueFor(t, m)) return false; const w = turnOf(t, F.members, logs); return w === m || w === 'all' || t.boss; });
  return { tasks, logs, dueFor, mine, ch, chOn, chLeft };
}
export const onNudge = onDocumentCreated('nudges/{id}', async ev => {
  if (ev.params.id === 'challenge') return; // handled by onChallengeNudge
  const n = ev.data?.data(); if (!n) return;
  const F = await family(); const P = await pendingFor(F);
  if (n.type === 'people'){
    for (const id of (n.to || [])){
      const left = P.mine(id).map(t => t.title).concat(P.chLeft.map(i => `${i.title} (אתגר)`));
      if (left.length) await push([id], `👑 המלך מזכיר: נשארו לך ${left.length} משימות`, list3(left), `nudge-${id}`);
    }
  } else if (n.type === 'task'){
    const t = P.tasks.find(x => x.id === n.taskId);
    if (t){
      const w = turnOf(t, F.members, P.logs);
      const to = (t.boss || w === 'all') ? F.ids.filter(id => P.dueFor(t, id)) : [w];
      await push(to, t.boss ? '🐉 המלך מזכיר: משימת בוס!' : '👑 המלך מזכיר', `${t.title}${t.boss ? ` · ${(t.points || 0) * 3} נקודות למי שעושה ראשון` : ''}`, `nudge-t-${t.id}`);
    }
  }
  await ev.data.ref.delete();
});
export const onChallengeNudge = onDocumentWritten('nudges/challenge', async ev => {
  const b = ev.data?.before?.data(), n = ev.data?.after?.data(); if (!n || (b && b.at === n.at)) return;
  const F = await family(); const P = await pendingFor(F);
  if (!P.chOn || !P.chLeft.length) return;
  await push(F.ids.filter(id => id !== n.by), `⚡ ${F.name(n.by)} מזכיר/ה: אתגר ${P.ch.title}`, `נשארו ${P.chLeft.length} משימות: ${list3(P.chLeft.map(i => i.title))}`, 'nudge-challenge');
});

/* ---------- new family challenge / new monthly goal ---------- */
export const onSettings = onDocumentWritten('settings/{id}', async ev => {
  const b = ev.data?.before?.data() || null, a = ev.data?.after?.data(); if (!a) return;
  const F = await family();
  if (ev.params.id === 'challenge'){
    const key = x => x ? (x.cid || `${x.start}|${x.title}`) : null;
    const items = Array.isArray(a.items) ? a.items.filter(i => i && i.id) : [];
    if (!items.length || key(a) === key(b)) return;
    const until = String(a.until || '').split('-').reverse().slice(0, 2).join('.');
    return push(F.ids, `⚡ אתגר משפחתי חדש: ${a.title}`, `${items.length} משימות${until ? ` עד ${until}` : ''}${a.prize ? ` · פרס: ${a.prize}` : ''}`, 'new-challenge');
  }
  if (ev.params.id === 'goal'){
    if (!(a.target > 0) || (b && b.target === a.target && (b.prize || '') === (a.prize || ''))) return;
    return push(F.ids, `🎯 יעד חודשי חדש${a.prize ? `: ${a.prize}` : ''}`, `${a.target} נקודות ביחד החודש`, 'new-goal');
  }
});
