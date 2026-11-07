import * as cfg from './firebase-config.js';
const firebaseConfig = cfg.firebaseConfig;
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { deleteField, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, addDoc as _addDoc, updateDoc as _updateDoc, deleteDoc as _deleteDoc, setDoc as _setDoc, getDoc, writeBatch as _writeBatch, serverTimestamp, arrayUnion, arrayRemove, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithCredential } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// "View as" (admin only) is look-only: every write is refused while it is on.
const previewErr = () => Object.assign(new Error('preview'), { code:'preview' });
const addDoc = (...a) => S.viewAs ? Promise.reject(previewErr()) : _addDoc(...a);
const updateDoc = (...a) => S.viewAs ? Promise.reject(previewErr()) : _updateDoc(...a);
const deleteDoc = (...a) => S.viewAs ? Promise.reject(previewErr()) : _deleteDoc(...a);
const setDoc = (...a) => S.viewAs ? Promise.reject(previewErr()) : _setDoc(...a);
const writeBatch = d => { const b = _writeBatch(d); const c = b.commit.bind(b); b.commit = () => S.viewAs ? Promise.reject(previewErr()) : c(); return b; };

const DAYS = ['א','ב','ג','ד','ה','ו','ש'];
const COLORS = ['#2A7F9E','#C0504D','#7B5EA7','#C97F14','#3B8C4A','#C2577F','#4F6D7A','#8A6D3B'];
const S = { tokens:[], nudgePick:new Set(), nudgeCh:null, myNotes:[], myNotesFor:null, dnSeen:new Set(), openPanels:new Set(), ppOpen:false, perms:{}, actFor:null, plain:false, rankOpen:false, fabMenu:false, devNotes:[], dnOpen:false, cpComments:[], cpCm:{}, complaints:[], cpOpen:false, cpDraft:{}, cjoins:{}, citems:{}, chOpen:false, chEdit:null, kitchenOpen:false, dishes:[], dishesLoaded:false, photos:{}, challenge:null, logsLoaded:false, viewAs:null, realAdmin:false, qtyAsk:null, rewards:[], joins:[], myJoin:null, adminChecked:false, boundId:null, profiles:{}, profileOpen:null, seen:{}, binding:null, bindLoaded:false, pins:{}, loginPick:null, loginErr:'', members:[], tasks:[], logs:[], timers:[], messages:[], chatOpen:null, chatDraft:'', delAsk:null, money:{ points:100, shekels:0 }, me:'all', tab:'today', isAdmin:false, user:null,
  editTask:null, editSg:null, editMember:null, armed:null, busy:new Set(), openPick:null, memInit:false };
let db = null, unsubs = [], fbApp = null;

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs){ const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()){ if (c == null || c === false) continue; e.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return e;
}
const pad = n => String(n).padStart(2,'0');
// Phone number pads have no minus key: a ± button next to fields that take negative points flips the sign.
function signBtn(inp){
  return h('button', { type:'button', class:'btn ghost small sign-btn', 'aria-label':'פלוס או מינוס', onclick:() => {
    const v = Number(inp.value); if (inp.value === '' || !Number.isFinite(v) || v === 0){ toast('קודם כתבו מספר, ואז ± הופך אותו למינוס'); inp.focus(); return; }
    inp.value = String(-v); inp.dispatchEvent(new Event('input', { bubbles:true })); } }, '±');
}
const signed = inp => h('span', { class:'signed' }, inp, signBtn(inp));
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const dow = () => new Date().getDay();
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return dstr(d); };
const store = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} } };
S.plain = store.get('ft-plain') === '1';
S.me = store.get('ft-me') || 'all';
S.seen = (() => { try{ return JSON.parse(store.get('ft-seen') || '{}') || {}; }catch(e){ return {}; } })();

let toastT;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function fail(e){ const c = e && e.code; if (c === 'preview'){ toast('זו רק תצוגה. כדי לשנות, חוזרים לניהול.'); return; } console.error(e);
  toast(c === 'permission-denied' ? (S.isAdmin ? 'אין הרשאה. בדקו שהמייל בחוקי האבטחה נכון.' : 'אין הרשאה לפעולה הזו.')
      : c === 'unavailable' ? 'אין חיבור. זה יישמר כשהאינטרנט יחזור.' : 'השמירה לא הצליחה. נסו שוב.'); }
function status(msg){ const s = $('status'); s.textContent = msg || ''; s.hidden = !msg; }

const member = id => S.members.find(m => m.id === id);
const avatarOf = id => S.profiles[id]?.avatar || (member(id)?.name || '?').trim().charAt(0);
const ADMIN_AVATARS = ['👑','🏆','💎','🐉','🦅','🔥'];
const roleOf = id => { const m = member(id); return m?.role || (m?.admin === true ? 'admin' : 'child'); };
const isAdminMember = id => roleOf(id) === 'admin';
const isParentMember = id => roleOf(id) === 'parent';
// Who may edit the family goal: the admin, or a parent signed in on this device.
const canEditGoal = () => S.isAdmin || (S.boundId && isParentMember(S.boundId));
const adminTag = id => isAdminMember(id) ? h('span', { class:'admin-tag' }, '👑 מנהל') : (isParentMember(id) ? h('span', { class:'admin-tag parent' }, 'הורה') : null);
const AVATARS = ['🦊','🐼','🐯','🦁','🐸','🐙','🦄','🐶','🐱','🐵','🐨','🦖','🚀','⚽','🎸','🌟','🍕','🎮','🌈','🐬'];
const mName = id => id === 'all' ? 'כולם' : (member(id)?.name || 'לא משויך');
const mColor = id => member(id)?.color || '#8A9690';
const isTimed = t => t.timed === true;
// A log counts toward points only once approved (tasks marked "needs check" start unapproved).
const counted = l => l.approved === undefined || l.approved === true;
const waiting = l => l.approved === false;
const rejected = l => l.approved === 'rejected';
// Counts in the weekly race: everything earned except points the admin put straight into the wallet (wallet: true).
const inRace = l => l.kind !== 'redeem' && l.wallet !== true;
// Approvers: the admin, or a parent signed in on this device (not for their own tasks).
// points that a parent gave (kind 'bonus' waiting) are approved only by the admin
const isWatched = id => member(id)?.watch === true;
const actorOfLog = l => l.by || l.memberId;
// who a parent may mark for: the list the admin set, or (by default) the children
const markableBy = pid => { const p = member(pid); return Array.isArray(p?.canMarkFor) ? p.canMarkFor.filter(id => member(id) && id !== pid) : S.members.filter(m => roleOf(m.id) === 'child').map(m => m.id); };
const canApprove = l => S.isAdmin || (l.kind !== 'bonus' && !isWatched(actorOfLog(l)) && !!S.boundId && isParentMember(S.boundId) && l.memberId !== S.boundId);
const doneCount = t => S.logs.filter(l => l.taskId === t.id && (l.kind === 'task' || l.kind === 'timed') && !rejected(l)).length;
// Rotation: the turn moves to the next person each time the task is done.
function whoseTurn(t){
  if (t.assignee !== 'rotate') return t.assignee || 'all';
  const r = (t.rotation || []).filter(id => member(id));
  return r.length ? r[doneCount(t) % r.length] : 'all';
}
function assigneeLabel(t){
  if (t.assignee === 'each'){ const left = eachLeft(t); return left.length && left.length < S.members.length ? `כל אחד בנפרד · עוד לא: ${left.map(mName).join(', ')}` : 'כל אחד בנפרד'; }
  const w = whoseTurn(t);
  if (t.assignee === 'rotate') return w === 'all' ? 'תורנות' : `תורנות · התור של ${mName(w)}`;
  return w === 'all' ? 'מי שרוצה' : mName(w);
}
// Parents can switch between their own tasks and the whole family's (the choice is remembered on the phone).
const isParentNow = () => !S.isAdmin && !!S.boundId && isParentMember(S.boundId);
const seeAll = () => isParentNow() && !S.actFor && store.get('ft-seeall') !== '0';
// the parent picked a child at the top ("מסמן עבור"): the screen shows that child's tasks and ✓ marks for them
const plainAdmin = () => S.isAdmin && S.plain && !S.viewAs;
const actingChild = () => S.actFor && member(S.actFor) && ((isParentNow() && markableBy(S.boundId).includes(S.actFor)) || plainAdmin()) ? S.actFor : null;
const isMine = t => { const w = whoseTurn(t); return S.me === 'all' || seeAll() || w === S.me || w === 'all' || w === 'each'; };
// May this phone press "done" on the task? Only for itself (or anyone, for the admin).
const canDoTask = t => { if (pastDeadline(t)) return false; if (S.isAdmin || !S.boundId) return true; const w = whoseTurn(t); return w === 'all' || w === 'each' || w === S.boundId || isParentNow(); };
// A parent marking a task for a child (e.g. one without a phone): the log carries who marked it, and counts at once.
const actingFor = memberId => (!S.isAdmin && S.boundId && memberId !== S.boundId) ? { by: S.boundId } : null;
function renderScope(){
  const on = isParentNow();
  document.querySelectorAll('[data-scope]').forEach((el, i) => { el.hidden = !on; el.replaceChildren(); if (!on) return;
    const all = seeAll();
    const mk = (v, label) => h('label', null, h('input', { type:'radio', name:'scope' + i, checked: (v === '1') === all, onchange:() => { store.set('ft-seeall', v); render(); } }), ' ' + label);
    el.append(mk('0', 'רק שלי'), mk('1', 'כל המשפחה')); });
}
const pill = t => isTimed(t) ? `${t.ratePerMin} לדקה` : `+${t.points}`;
const shekelsFor = p => { const m = S.money; if (!m || !(m.shekels > 0) || !(m.points > 0)) return null; return p * m.shekels / m.points; };
const fmtILS = v => '₪' + (Math.round(v * 100) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 });
const timerId = (taskId, memberId) => `${taskId}__${memberId}`;
const startMs = tm => tm.startedAt && typeof tm.startedAt.toMillis === 'function' ? tm.startedAt.toMillis() : Date.now();
function timedResult(task, tm){
  const ms = Math.max(0, Date.now() - startMs(tm));
  const minutes = Math.min(task.maxMinutes, Math.floor(ms / 60000));
  return { ms, minutes, points: minutes * task.ratePerMin, capped: ms >= task.maxMinutes * 60000 };
}
const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
function recLabel(t){ if (t.type === 'once') return 'חד-פעמית'; const d = (t.days || []).slice().sort(); return d.length === 7 ? 'כל יום' : 'ימים ' + d.map(i => DAYS[i]).join(' '); }
// "each" = everyone does it for themselves; the task stays on each person's list until they did it.
function isDueFor(t, m){
  if (t.pending) return false;
  const mine = l => l.taskId === t.id && !rejected(l) && (!m || l.memberId === m);
  if (t.type === 'once') return !S.logs.some(mine);
  return (t.days || []).includes(dow()) && !S.logs.some(l => mine(l) && l.day === today());
}
const eachLeft = t => S.members.filter(m => isDueFor(t, m.id)).map(m => m.id);
function isDue(t){
  if (t.assignee !== 'each') return isDueFor(t, null);
  if (S.me !== 'all' && !seeAll()) return isDueFor(t, S.me);
  return eachLeft(t).length > 0;
}
// "Until" time (e.g. 07:30): after it, today's task can't be marked any more.
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const pastDeadline = t => !!t.untilTime && nowHM() > t.untilTime;
function arm(key, btn, fn){
  if (S.armed === key){ S.armed = null; fn(); return; }
  S.armed = key; btn.classList.add('armed'); btn.textContent = 'בטוח? שוב';
  setTimeout(() => { if (S.armed === key){ S.armed = null; render(); } }, 3000);
}
function armedBtn(key, label, fn){
  const b = h('button', { type:'button', class:'btn danger small' }, label);
  b.addEventListener('click', () => arm(key, b, fn));
  if (S.armed === key){ b.classList.add('armed'); b.textContent = 'בטוח? שוב'; }
  return b;
}

/* ---------- actions ---------- */
async function complete(t, memberId){
  if (!db || S.busy.has(t.id)) return; S.busy.add(t.id); S.openPick = null; render();
  try{
    const pts = ptsOf(t);
    const by = actingFor(memberId); const check = isWatched(by ? by.by : memberId) || (t.check && !by);
    await addDoc(collection(db,'logs'), { kind:'task', taskId:t.id, title:t.title, memberId, points:pts, ...(check ? { approved:false } : {}), ...(by || {}), day:today(), at:Date.now() });
    if (by){ toast(check ? `נשלח לאישור המנהל: ${mName(memberId)} ${pts} נקודות` : `סומן בשם ${mName(memberId)}: ${pts} נקודות`); confetti(60); return; }
    toast(t.check ? `נשלח לאישור: ${pts} נקודות יתווספו אחרי בדיקה. אפשר לצרף תמונה ב"בוצע היום" 📷` : t.boss ? `🐉 ${mName(memberId)} ניצח/ה את הבוס! ${pts} נקודות` : `${mName(memberId)} קיבל/ה ${pts} נקודות`);
    confetti(t.boss ? 200 : t.check ? 40 : 90);
  }catch(e){ fail(e); } finally{ S.busy.delete(t.id); render(); }
}
// Quantity tasks: the child types how many (e.g. 7 socks); points = full bundles x points per bundle.
async function completeQty(t, memberId, n){
  n = Math.round(Number(n));
  if (!(n >= t.qtyPer)){ toast(`צריך לפחות ${t.qtyPer} ${t.qtyUnit}`); return; }
  if (n > (t.qtyMax || 10000)){ toast(`זה יותר מדי ${t.qtyUnit}`); return; }
  if (!db || S.busy.has(t.id)) return; S.busy.add(t.id); S.qtyAsk = null; render();
  const points = qtyPoints(t, n);
  try{
    const by = actingFor(memberId);
    await addDoc(collection(db,'logs'), { kind:'task', taskId:t.id, title:t.title, memberId, points, count:n, ...(isWatched(by ? by.by : memberId) || (t.check && !by) ? { approved:false } : {}), ...(by || {}), day:today(), at:Date.now() });
    toast(t.check ? `נשלח לאישור: ${n} ${t.qtyUnit} = ${points} נקודות` : `${mName(memberId)}: ${n} ${t.qtyUnit} = ${points} נקודות`); confetti(t.check ? 40 : 90);
  }catch(e){ fail(e); } finally{ S.busy.delete(t.id); render(); }
}
function askQty(t, memberId){ S.qtyAsk = { id:t.id, m:memberId, val:'' }; S.openPick = null; render(); setTimeout(() => $('qtyIn')?.focus(), 0); }
async function startTimer(t, memberId){
  const id = timerId(t.id, memberId);
  if (!db || S.busy.has(id)) return; S.busy.add(id); S.openPick = null; render();
  try{
    await setDoc(doc(db,'timers',id), { taskId:t.id, memberId, startedAt: serverTimestamp(), ...(actingFor(memberId) || {}) });
    toast(`הטיימר של ${mName(memberId)} התחיל`);
  }catch(e){ fail(e); } finally{ S.busy.delete(id); render(); }
}
async function finishTimer(t, tm){
  if (!db || S.busy.has(tm.id)) return;
  const r = timedResult(t, tm);
  if (r.minutes < 1){ toast('צריך לפחות דקה שלמה. אפשר להמשיך או לבטל.'); return; }
  S.busy.add(tm.id); render();
  try{
    const b = writeBatch(db);
    b.set(doc(collection(db,'logs')), { kind:'timed', taskId:t.id, title:t.title, memberId:tm.memberId,
      minutes:r.minutes, points:r.points, timerId:tm.id, ...(isWatched(actingFor(tm.memberId)?.by || tm.memberId) || (t.check && !actingFor(tm.memberId)) ? { approved:false } : {}), ...(actingFor(tm.memberId) || {}), day:today(), at:Date.now() });
    b.delete(doc(db,'timers',tm.id));
    await b.commit();
    toast(`${mName(tm.memberId)}: ${r.minutes} דקות, ${r.points} נקודות`); confetti(t.check ? 40 : 90);
  }catch(e){ fail(e); } finally{ S.busy.delete(tm.id); render(); }
}
async function cancelTimer(tm){ try{ await deleteDoc(doc(db,'timers',tm.id)); toast('הטיימר בוטל'); }catch(e){ fail(e); } }
async function removeLog(l){ try{ await deleteDoc(doc(db,'logs',l.id)); dropPhoto(l.id); toast('בוטל'); }catch(e){ fail(e); } }

/* ---------- render ---------- */
function render(){
  // "View as": the admin sees the app exactly as that member does, look-only.
  if (S.viewAs && (!S.realAdmin || !member(S.viewAs))) S.viewAs = null;
  if (S.adminChecked) S.isAdmin = S.realAdmin && !S.viewAs;
  // "plain" mode: the admin keeps full powers but sees the app like everyone else (his own member, no admin tab)
  const plain = S.isAdmin && S.plain;
  renderViewAs();
  // The admin's own screen gets a gold background.
  document.body.classList.toggle('royal', !!S.isAdmin || (!!S.boundId && isAdminMember(S.boundId)));
  const typing = document.activeElement && document.activeElement.id === 'chat-input';
  const d = new Date();
  $('dateline').textContent = `יום ${DAYS[d.getDay()]}׳, ${d.getDate()}.${d.getMonth()+1}`;
  if ((!S.isAdmin || plain) && S.tab === 'admin') S.tab = 'today';
  $('tabs').hidden = !S.user;
  $('tabs').querySelector('[data-tab="admin"]').hidden = !S.isAdmin || plain;
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.kitchen ? !!S.kitchenOpen : (!S.kitchenOpen && b.dataset.tab === S.tab)));
  if (!['today','tasks','rewards','family','admin'].includes(S.tab)) S.tab = 'today';
  const VIEWS = ['today','tasks','rewards','family','admin'];
  const hideViews = () => VIEWS.forEach(v => $('view-'+v).hidden = true);
  VIEWS.forEach(v => $('view-'+v).hidden = S.tab !== v);
  // A family member's device is locked to whoever signed in with their code. Only the admin can view as anyone.
  // Who this device belongs to: a Google account linked to a member, or a member's code.
  const isGoogle = !!S.user && !S.user.isAnonymous;
  const gMember = isGoogle ? S.members.find(m => m.uid && m.uid === S.user.uid) : null;
  const ownMember = gMember ? gMember.id : (S.binding && member(S.binding.memberId) ? S.binding.memberId : null);
  const bound = S.viewAs ? S.viewAs : plain ? (ownMember || S.members.find(m => roleOf(m.id) === 'admin')?.id || null) : S.isAdmin ? null : ownMember;
  S.boundId = bound;
  const ready = S.bindLoaded && S.adminChecked;
  const needLogin = !!S.user && !S.isAdmin && ready && !bound;
  if (bound) S.me = bound;
  if (S.actFor && !actingChild()) S.actFor = null;
  if (actingChild()) S.me = S.actFor;
  else if (!S.isAdmin) S.me = 'all';
  if (S.me !== 'all' && !member(S.me) && S.members.length) S.me = 'all';
  $('login').hidden = !needLogin;
  if (needLogin){ hideViews(); $('tabs').hidden = true; S.chatOpen = null; S.profileOpen = null; renderChatSheet(); renderProfileSheet(); renderLogin(); }
  if (!S.isAdmin && !ready && S.user){ hideViews(); $('tabs').hidden = true; return; }
  renderHero(bound);
  $('who').hidden = !(S.isAdmin || isParentNow());
  $('meBar').hidden = !bound;
  { const wb = $('watchBar'); if (wb) wb.hidden = !(bound && isWatched(bound) && !S.isAdmin); }
  if (bound){ const m = member(bound); $('meName').textContent = `שלום, ${m.name}`; $('meAva').textContent = avatarOf(m.id); $('meAva').style.background = m.color; }
  const nPend = S.tasks.filter(t => t.pending || t.reviewed === false).length + (S.isAdmin ? S.joins.length : 0);
  { const nRev = S.logs.filter(l => waiting(l) && canApprove(l)).length; const tb = $('tabs').querySelector('[data-tab="tasks"]');
    tb.lastChild.textContent = nRev ? `משימות (${nRev})` : 'משימות'; }
  $('tabs').querySelector('[data-tab="admin"] .nl').textContent = nPend ? `ניהול (${nPend})` : 'ניהול';
  renderChatSheet(); renderProfileSheet(); updateSplash(); renderKitchen();
  $('sgSec').hidden = !S.user || (S.isAdmin && !plain) || !bound || needLogin;
  if (needLogin) return;
  renderWho(); renderBoard(); renderToday(); renderProgress(); renderGoal(); renderAllTasks(); renderReview(); renderRewards(); renderExchanges(); renderScope(); renderBoss(); renderChallenge(); checkNewBadges(); renderComplaints(); renderDevNotes(); renderParentPoints(); renderParentPointsAdmin(); renderNudgeAdmin(); if ($('perm-parentPts')) $('perm-parentPts').checked = parentPointsOn(); renderPending(); renderAuth(); syncSelects();
  if (S.isAdmin){ renderAdminLists(); renderJoins(); }
  renderPresets();
  const cl = $('chat-list'); if (cl) cl.scrollTop = cl.scrollHeight;
  if (typing){ const ci = $('chat-input'); if (ci){ ci.focus({ preventScroll:true }); const n = ci.value.length; try{ ci.setSelectionRange(n, n); }catch(e){} } }
  syncCollapsibles();
  syncHistory();
}
function renderViewAs(){
  const bar = $('viewAsBar'); bar.hidden = !S.viewAs;
  if (S.viewAs) $('viewAsName').textContent = `תצוגה כמו ${mName(S.viewAs)} · רק לצפייה`;
  const box = $('viewAsPick'); if (!box || !S.realAdmin) return; box.replaceChildren();
  S.members.filter(m => roleOf(m.id) !== 'admin').forEach(m => box.append(h('button', { type:'button', class:'chip', onclick:() => startViewAs(m.id) },
    h('span', { class:'dot', style:`background:${m.color}` }), m.name)));
}
function startViewAs(id){ S.viewAs = id; S.tab = 'today'; S.openPick = null; S.qtyAsk = null; S.chatOpen = null; S.profileOpen = null; render(); window.scrollTo({ top:0 }); }
function stopViewAs(){ S.viewAs = null; S.tab = 'admin'; render(); window.scrollTo({ top:0 }); }
// Nothing on screen says who manages the board: the admin entry is a hidden gesture (5 quick taps on the title).
function renderAuth(){}

/* ---------- sign in as a family member, with that member's code ---------- */
let loginGoogleHook = null, googleSignInHook = null;
function renderLogin(){
  const box = $('login-members'); box.replaceChildren();
  const isGoogle = !!S.user && !S.user.isAnonymous;
  // Signed in with Google but not on the board yet: ask for a name, or show that the request is waiting.
  $('login-join').hidden = !(isGoogle && !S.myJoin);
  $('login-wait').hidden = !(isGoogle && S.myJoin);
  if (isGoogle){
    $('login-google').hidden = true; box.hidden = true; $('login-pin').hidden = true; $('login-empty').hidden = true;
    $('login-title').textContent = S.myJoin ? 'מחכה לאישור' : 'הצטרפות ללוח';
    $('join-email').textContent = `נכנסת בתור ${S.user.email || S.user.displayName || ''}`;
    if (S.myJoin){ $('wait-name').textContent = S.myJoin.name; $('wait-link').textContent = S.myJoin.linkTo ? ` לחבר את הגוגל הזה ל${mName(S.myJoin.linkTo)}` : ''; }
    else fillJoinLink();
    if (!S.myJoin && $('join-link').value) return;
    if (!S.myJoin && !$('join-name').value && S.user.displayName && document.activeElement !== $('join-name')) $('join-name').value = S.user.displayName.split(' ')[0].slice(0, 20);
    return;
  }
  $('login-empty').hidden = S.members.length > 0;
  const pick = S.loginPick && member(S.loginPick) ? member(S.loginPick) : null;
  $('login-title').textContent = pick ? `שלום ${pick.name}` : 'מי אתה?';
  $('login-google').hidden = !!pick;
  if (!pick && loginGoogleHook && !$('login-gbtn').childElementCount) loginGoogleHook('login-gbtn');
  box.hidden = !!pick; $('login-pin').hidden = !pick;
  if (pick){ $('login-label').textContent = `הקוד של ${pick.name}`; }
  S.members.forEach(m => box.append(h('button', { type:'button', class:'chip', onclick:() => {
    S.loginPick = m.id; S.loginErr = ''; $('login-code').value = ''; render(); setTimeout(() => $('login-code').focus(), 0); } },
    h('span', { class:'dot', style:`background:${m.color}` }), m.name)));
  $('login-err').hidden = !S.loginErr; $('login-err').textContent = S.loginErr || '';
}
let loginFails = 0, loginLockUntil = 0;
async function loginGo(){
  const code = $('login-code').value.trim();
  if (!S.loginPick || !S.user) return;
  if (Date.now() < loginLockUntil){ S.loginErr = `יותר מדי ניסיונות. נסו שוב בעוד ${Math.ceil((loginLockUntil - Date.now()) / 1000)} שניות.`; render(); return; }
  if (!/^\d{4}$/.test(code)){ S.loginErr = 'הקוד הוא 4 ספרות'; render(); return; }
  const btn = $('login-go'); btn.disabled = true;
  try{
    await setDoc(doc(db,'bindings',S.user.uid), { memberId:S.loginPick, pin:code });
    loginFails = 0; S.loginErr = ''; S.loginPick = null; $('login-code').value = '';
    // The live snapshot of bindings/<uid> picks up the new sign-in and re-renders.
  }catch(e){
    console.error(e); loginFails++;
    if (loginFails >= 5){ loginLockUntil = Date.now() + 60000; loginFails = 0; }
    S.loginErr = e.code === 'permission-denied' ? 'הקוד לא נכון' : 'הכניסה לא הצליחה. בדקו את החיבור לאינטרנט.';
    $('login-code').value = ''; render();
  }finally{ btn.disabled = false; }
}
/* ---------- admin mode by code ---------- */
let agFails = 0, agLockUntil = 0;
let openAdminGateHook = null;
function openAdminGate(){ if (openAdminGateHook) openAdminGateHook(); $('adminGate').hidden = false; $('ag-err').hidden = true; $('ag-code').value = ''; setTimeout(() => $('ag-code').focus(), 30); }
function closeAdminGate(){ $('adminGate').hidden = true; $('ag-code').value = ''; }
async function adminCodeGo(){
  const code = $('ag-code').value.trim(); const err = $('ag-err');
  const show = m => { err.textContent = m; err.hidden = false; };
  if (Date.now() < agLockUntil){ show(`יותר מדי ניסיונות. נסו שוב בעוד ${Math.ceil((agLockUntil - Date.now()) / 1000)} שניות.`); return; }
  if (!/^\d{6,12}$/.test(code)){ show('הקוד הוא 6 עד 12 ספרות'); return; }
  if (!S.user){ show('אין חיבור. נסו שוב בעוד רגע.'); return; }
  const btn = $('ag-go'); btn.disabled = true;
  try{
    await setDoc(doc(db,'adminSessions',S.user.uid), { code });
    agFails = 0; closeAdminGate(); toast('נכנסת למצב מנהל');
  }catch(e){
    console.error(e); agFails++; if (agFails >= 5){ agLockUntil = Date.now() + 5 * 60000; agFails = 0; }
    show(e.code === 'permission-denied' ? 'הקוד לא נכון' : 'הכניסה לא הצליחה. בדקו את החיבור לאינטרנט.');
    $('ag-code').value = '';
  }finally{ btn.disabled = false; }
}
async function saveAdminCode(){
  const code = $('ac-code').value.trim();
  if (!/^\d{6,12}$/.test(code)){ toast('הקוד הוא 6 עד 12 ספרות'); return; }
  const btn = $('ac-save'); btn.disabled = true;
  try{
    // Two separate writes: the session rule checks the saved code, so the code must be saved first.
    await setDoc(doc(db,'private','admin'), { code });
    await setDoc(doc(db,'adminSessions',S.user.uid), { code }).catch(e => console.error(e)); // keep this device in admin mode
    $('ac-code').value = ''; toast('קוד המנהל נשמר');
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}

async function switchUser(){
  if (!S.user) return;
  S.chatOpen = null; S.openPick = null; S.profileOpen = null;
  try{
    if (!S.user.isAnonymous){ await signOut(getAuth(fbApp)); return; }
    await deleteDoc(doc(db,'bindings',S.user.uid));
  }catch(e){ fail(e); }
}

/* ---------- joining with a Google account ---------- */
// Members a Google account can be linked to: on the board already (with a code), with no Google account yet.
const linkable = () => S.members.filter(m => !m.uid && roleOf(m.id) !== 'admin');
function fillJoinLink(){
  const sel = $('join-link'); const keep = sel.value; const list = linkable();
  $('join-linkwrap').hidden = !list.length;
  if (document.activeElement !== sel){
    sel.replaceChildren(h('option', { value:'' }, 'לא, אני חדש/ה בלוח'), ...list.map(m => h('option', { value:m.id }, `כן, אני ${m.name}`)));
    sel.value = list.some(m => m.id === keep) ? keep : '';
  }
  const link = !!sel.value; $('join-namewrap').hidden = link; $('join-colorwrap').hidden = link;
  $('join-go').textContent = link ? 'חיבור הגוגל לשם הזה' : 'הצטרפות';
}
async function sendJoin(){
  const linkTo = $('join-link').value; const lm = linkTo ? member(linkTo) : null;
  const name = lm ? lm.name.slice(0, 20) : $('join-name').value.trim(); const color = lm ? lm.color : (document.querySelector('input[name=join-color]:checked') || {}).value || COLORS[0];
  if (!name){ toast('כתבו איך לקרוא לך'); $('join-name').focus(); return; }
  const btn = $('join-go'); btn.disabled = true;
  try{ await setDoc(doc(db,'joinRequests',S.user.uid), { name, color, email: S.user.email || '', ...(lm ? { linkTo } : {}), at: Date.now() }); toast(lm ? 'הבקשה נשלחה. אחרי אישור המנהל תיכנס/י עם הגוגל הזה.' : 'הבקשה נשלחה'); }
  catch(e){ fail(e); } finally{ btn.disabled = false; }
}
async function cancelJoin(){ try{ await deleteDoc(doc(db,'joinRequests',S.user.uid)); }catch(e){ fail(e); } }
// linkTo: an existing member gets this Google account (keeps its points, history and code); otherwise a new member.
async function approveJoin(j, linkTo){
  const lm = linkTo ? member(linkTo) : null;
  if (linkTo && !lm){ toast('בן המשפחה הזה כבר לא קיים'); return; }
  if (lm && lm.uid){ toast(`ל${lm.name} כבר מחובר חשבון גוגל. קודם מנתקים אותו.`); return; }
  try{
    const b = writeBatch(db);
    if (lm) b.update(doc(db,'members',lm.id), { uid: j.id, email: j.email || '' });
    else b.set(doc(collection(db,'members')), { name: j.name, color: j.color || COLORS[0], order: Date.now(), uid: j.id, email: j.email || '' });
    b.delete(doc(db,'joinRequests',j.id));
    await b.commit(); toast(lm ? `הגוגל ${j.email || ''} חובר ל${lm.name}` : `${j.name} הצטרף/ה ללוח`);
  }catch(e){ fail(e); }
}
async function unlinkGoogle(m){
  try{ await updateDoc(doc(db,'members',m.id), { uid: deleteField(), email: deleteField() }); toast(`הגוגל נותק מ${m.name}${S.pins[m.id] ? '. הכניסה עם הקוד ממשיכה לעבוד.' : '. אין לו/ה קוד, אז כרגע אי אפשר להיכנס בשמו/ה.'}`); }catch(e){ fail(e); }
}
async function rejectJoin(j){ try{ await deleteDoc(doc(db,'joinRequests',j.id)); toast('הבקשה נדחתה'); }catch(e){ fail(e); } }
function renderJoins(){
  $('joinsPanel').hidden = !S.joins.length; $('joinsCount').textContent = S.joins.length ? String(S.joins.length) : '';
  const L = $('joinsList'); L.replaceChildren();
  S.joins.slice().sort((a,b) => (a.at||0) - (b.at||0)).forEach(j => {
    // the admin decides: a new member, or this Google account goes to someone already on the board
    const sel = h('select', { 'aria-label':'חיבור ל' }, h('option', { value:'' }, 'בן משפחה חדש'),
      linkable().map(m => h('option', { value:m.id }, `לחבר ל${m.name}`)));
    if (j.linkTo && linkable().some(m => m.id === j.linkTo)) sel.value = j.linkTo;
    L.append(h('div', { class:'arow arow-wrap' },
      h('div', { class:'ava sm', style:`background:${j.color || COLORS[0]}` }, (j.name || '?').charAt(0)),
      h('div', { class:'t' }, h('strong', null, j.linkTo && member(j.linkTo) ? `${j.email || j.name} ← ${mName(j.linkTo)}` : j.name),
        h('small', null, j.linkTo && member(j.linkTo) ? 'ביקש/ה לחבר את הגוגל לשם שכבר בלוח' : (j.email || ''))),
      sel,
      h('button', { type:'button', class:'btn small', onclick:() => approveJoin(j, sel.value) }, 'אישור'),
      armedBtn('j'+j.id, 'דחייה', () => rejectJoin(j)))); });
}
function renderPending(){
  const mine = t => isMine(t) || t.suggestedBy === S.me;
  const list = S.tasks.filter(t => t.pending && mine(t)).sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  $('pendSec').hidden = !list.length; $('pendCount').textContent = list.length ? String(list.length) : '';
  const P = $('pendList'); P.replaceChildren();
  list.forEach(t => P.append(h('div', { class:'task' },
    h('div', { class:'body' }, h('span', { class:'title' }, t.title),
      h('div', { class:'meta' },
        h('span', { class:'tag' }, h('span', { class:'dot', style:`background:${whoseTurn(t) === 'all' ? 'var(--muted)' : mColor(whoseTurn(t))}` }),
          assigneeLabel(t)),
        h('span', null, '·'), h('span', null, recLabel(t)),
        t.suggestedBy && member(t.suggestedBy) ? [h('span', null, '·'), h('span', null, `נוספה ע״י ${mName(t.suggestedBy)}`)] : null)),
    S.isAdmin
      ? h('button', { type:'button', class:'btn', onclick:() => { S.tab = 'admin'; render(); editTask(t); } }, 'קביעת ניקוד')
      : h('span', { class:'pts-pill' }, 'בקרוב'))));
}
function toggleSuggest(open){
  if (!open && S.editSg) resetSgEdit();
  $('sg-panel').hidden = !open; $('sg-toggle').hidden = open; $('sg-toggle').setAttribute('aria-expanded', String(open));
  if (open && !S.editSg){ if (S.me !== 'all' && member(S.me)) $('sg-assignee').value = S.me; $('sg-title').focus(); }
}
// Who may edit a task: the admin always; a parent any task that isn't pinned; anyone the task they added themselves.
function canEditTask(t){
  if (S.isAdmin) return true;
  if (t.pinned || t.pending || !S.boundId) return false;
  return isParentMember(S.boundId) || t.suggestedBy === S.boundId;
}
function openTaskEdit(t){
  if (S.isAdmin && !S.plain){ S.tab = 'admin'; render(); editTask(t); return; }
  S.editSg = t.id; S.tab = 'tasks'; render();
  $('sgHead').textContent = 'עריכת משימה'; $('sgPresets').hidden = true; $('sg-save').textContent = 'שמירת שינויים';
  $('sg-title').value = t.title;
  const sel = $('sg-assignee'); sel.value = ['rotate','each'].includes(t.assignee) ? t.assignee : (member(t.assignee) ? t.assignee : 'all'); $('sg-until').value = t.untilTime || '';
  $('sg-rot').querySelectorAll('input').forEach(i => i.checked = (t.rotation || []).includes(i.value)); $('sg-rotwrap').hidden = sel.value !== 'rotate';
  $('sg-check').checked = !!t.check;
  setSgMode(modeOf(t)); fillQty('sg', t);
  $('sg-points').value = t.points ?? 10; $('sg-rate').value = t.ratePerMin ?? 1; $('sg-max').value = t.maxMinutes ?? 30;
  $(t.type === 'once' ? 'sg-type-once' : 'sg-type-repeat').checked = true; $('sg-dayswrap').hidden = t.type === 'once';
  DAYS.forEach((_, i) => $('sg-day-'+i).checked = (t.days || []).includes(i) || t.type === 'once');
  toggleSuggest(true);
  $('sg-panel').scrollIntoView({ behavior:'smooth', block:'start' }); $('sg-title').focus({ preventScroll:true });
}
function resetSgEdit(){
  S.editSg = null; $('sgHead').textContent = 'או משימה משלך'; $('sgPresets').hidden = false; $('sg-save').textContent = 'הוספה';
  $('sg-title').value = ''; $('sg-until').value = ''; $('sg-check').checked = false; $('sg-rot').querySelectorAll('input').forEach(i => i.checked = false); setSgMode('fixed'); fillQty('sg');
}
function setSgMode(m){ $('sg-mode-' + m).checked = true; $('sg-fixed-row').hidden = m !== 'fixed'; $('sg-timed-row').hidden = m !== 'timed'; $('sg-qty-row').hidden = m !== 'qty'; }
// Anyone can add a task with its own points or time. It is live at once; the admin sees it marked "new" and can edit or delete it.
async function saveSuggestion(){
  const title = $('sg-title').value.trim();
  const type = $('sg-type-repeat').checked ? 'repeat' : 'once';
  const days = type === 'repeat' ? DAYS.map((_, i) => i).filter(i => $('sg-day-'+i).checked) : [];
  const timed = $('sg-mode-timed').checked;
  const points = Math.round(Number($('sg-points').value));
  const ratePerMin = Math.round(Number($('sg-rate').value)), maxMinutes = Math.round(Number($('sg-max').value));
  if (!title){ toast('כתבו מה צריך לעשות'); $('sg-title').focus(); return; }
  if (type === 'repeat' && !days.length){ toast('בחרו לפחות יום אחד'); return; }
  const q = radioMode('sg') === 'qty' ? readQty('sg') : null; if (typeof q === 'string'){ toast(q); return; }
  if (!timed && !q && (!Number.isFinite(points) || points < 0 || points > 1000)){ toast('נקודות: מספר בין 0 ל-1000'); return; }
  if (timed && (!(ratePerMin >= 1) || ratePerMin > 100)){ toast('נקודות לדקה: מספר בין 1 ל-100'); return; }
  if (timed && (!(maxMinutes >= 1) || maxMinutes > 240)){ toast('תקרה: בין 1 ל-240 דקות'); return; }
  const assignee = $('sg-assignee').value || 'all';
  const rotation = assignee === 'rotate' ? [...$('sg-rot').querySelectorAll('input:checked')].map(i => i.value) : [];
  if (assignee === 'rotate' && rotation.length < 2){ toast('בתורנות צריך לפחות שני בני משפחה'); return; }
  const btn = $('sg-save'); btn.disabled = true;
  if (S.editSg){
    const old = S.tasks.find(x => x.id === S.editSg);
    if (!old){ toast('המשימה כבר לא קיימת'); resetSgEdit(); toggleSuggest(false); btn.disabled = false; return; }
    try{
      await updateDoc(doc(db,'tasks',old.id), { title, assignee, type, days, timed, check: $('sg-check').checked,
        rotation: assignee === 'rotate' ? rotation : deleteField(),
        points: timed ? deleteField() : (q ? q.points : points), ratePerMin: timed ? ratePerMin : deleteField(), maxMinutes: timed ? maxMinutes : deleteField(),
        qtyPer: q ? q.qtyPer : deleteField(), qtyUnit: q ? q.qtyUnit : deleteField(), qtyMax: deleteField(), untilTime: $('sg-until').value || deleteField(),
        reviewed: !!S.isAdmin, editedBy: S.boundId });
      toast('המשימה עודכנה'); toggleSuggest(false);
    }catch(e){ fail(e); } finally{ btn.disabled = false; }
    return;
  }
  try{
    await addDoc(collection(db,'tasks'), { title, assignee, type, days, timed, check: $('sg-check').checked, ...($('sg-until').value ? { untilTime: $('sg-until').value } : {}),
      ...(assignee === 'rotate' ? { rotation } : {}),
      ...(timed ? { ratePerMin, maxMinutes } : q ? q : { points }), reviewed:false,
      suggestedBy: S.boundId || (S.me !== 'all' && member(S.me) ? S.me : null), createdAt: Date.now() });
    toast('המשימה נוספה');
    $('sg-title').value = ''; $('sg-check').checked = false; $('sg-rot').querySelectorAll('input').forEach(i => i.checked = false); setSgMode('fixed'); fillQty('sg'); toggleSuggest(false);
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
async function markSeen(t){ try{ await updateDoc(doc(db,'tasks',t.id), { reviewed:true }); }catch(e){ fail(e); } }

/* ---------- pin & delete (admin) ---------- */
async function togglePin(t){
  try{ await updateDoc(doc(db,'tasks',t.id), { pinned: !t.pinned }); toast(t.pinned ? 'הנעיצה בוטלה' : 'המשימה ננעצה. אי אפשר למחוק אותה עד שמבטלים נעיצה.'); }
  catch(e){ fail(e); }
}
const taskLogs = t => S.logs.filter(l => l.taskId === t.id);
// Deletes the task with its chat and running timers; withPoints also removes every point it ever gave.
async function deleteTask(t, withPoints){
  if (t.pinned){ toast('המשימה נעוצה. קודם מבטלים נעיצה.'); return; }
  const refs = [doc(db,'tasks',t.id),
    ...S.messages.filter(m => m.taskId === t.id).map(m => doc(db,'messages',m.id)),
    ...S.timers.filter(tm => tm.taskId === t.id).map(tm => doc(db,'timers',tm.id)),
    ...(withPoints ? taskLogs(t).map(l => doc(db,'logs',l.id)) : [])];
  try{
    for (let i = 0; i < refs.length; i += 450){ const b = writeBatch(db); refs.slice(i, i + 450).forEach(r => b.delete(r)); await b.commit(); }
    S.delAsk = null; if (S.editTask === t.id) resetTaskForm();
    toast(withPoints ? 'המשימה והנקודות שלה נמחקו' : 'המשימה נמחקה, הנקודות נשארו');
  }catch(e){ fail(e); }
}

/* ---------- chat ---------- */
const chatCount = t => S.messages.filter(m => m.taskId === t.id).length;
/* ---------- profiles ---------- */
function memberStats(id){
  const ws = weekStart(), td = today();
  const mine = S.logs.filter(l => l.memberId === id);
  let week = 0, total = 0, done = 0; const days = new Set();
  for (const l of mine){ if (l.kind === 'redeem' || !counted(l)) continue; const p = Number(l.points) || 0; total += p; if (l.day >= ws) week += p; if (l.kind === 'task' || l.kind === 'timed'){ done++; days.add(l.day); } }
  // streak: consecutive days, ending today (or yesterday if nothing yet today), with at least one finished task
  let streak = 0; const d = new Date(); if (!days.has(td)) d.setDate(d.getDate() - 1);
  while (days.has(dstr(d))){ streak++; d.setDate(d.getDate() - 1); }
  return { week, total, done, streak, recent: mine.slice().sort((a,b) => b.at - a.at).slice(0, 15) };
}
const canEditProfile = id => S.isAdmin || S.boundId === id;
function openProfile(id){ S.profileOpen = id; render(); }
function closeProfile(){ S.profileOpen = null; render(); }
async function setAvatar(id, a){
  try{ await setDoc(doc(db,'profiles',id), { avatar:a }); toast('התמונה עודכנה'); }catch(e){ fail(e); }
}
function renderProfileSheet(){
  const m = S.profileOpen ? member(S.profileOpen) : null;
  const sheet = $('profileSheet');
  if (!m){ S.profileOpen = null; sheet.hidden = true; if (!S.chatOpen) document.body.classList.remove('locked'); return; }
  sheet.hidden = false; document.body.classList.add('locked');
  const st = memberStats(m.id); const own = canEditProfile(m.id);
  const ils = v => shekelsFor(v) != null ? fmtILS(shekelsFor(v)) : null;
  const tile = (label, value, sub) => h('div', { class:'stat' }, h('span', { class:'stat-v' }, value), h('span', { class:'stat-l' }, label), sub ? h('span', { class:'stat-s' }, sub) : null);
  const body = $('profileBody'); body.replaceChildren(...[
    h('div', { class:'prof-hero' + (isAdminMember(m.id) ? ' royal' : ''), style:`--m:${m.color}` },
      h('div', { class:'prof-ava' }, avatarOf(m.id)),
      h('div', { class:'prof-name-wrap' }, h('h2', { class:'prof-name' }, m.name), adminTag(m.id))),
    h('div', { class:'stats' },
      tile('השבוע', st.week, ils(st.week)),
      tile('סה״כ נקודות', st.total, ils(st.total)),
      tile('משימות שבוצעו', st.done),
      tile('ימים ברצף', st.streak)),
    badgePanel(m.id),
    own ? h('section', { class:'panel' }, h('h2', null, 'בחירת תמונה'),
      h('div', { class:'ava-grid' },
        (isAdminMember(m.id) ? ADMIN_AVATARS : []).map(a => h('button', { type:'button', class:'ava-pick special', title:'תמונה של מנהל', 'aria-pressed':String(S.profiles[m.id]?.avatar === a), onclick:() => setAvatar(m.id, a) }, a)),
        AVATARS.map(a => h('button', { type:'button', class:'ava-pick', 'aria-pressed':String(S.profiles[m.id]?.avatar === a), onclick:() => setAvatar(m.id, a) }, a)))) : null,
    (S.boundId === m.id || (S.isAdmin && !S.boundId && m.id === myMemberId())) ? notifPanel(m.id) : null,
    h('section', { class:'panel' }, h('h2', null, 'מה נעשה לאחרונה'),
      st.recent.length ? h('div', null, st.recent.map(l => { const p = Number(l.points) || 0; const [, mo, da] = (l.day || '--').split('-');
        return h('div', { class:'arow' }, h('div', { class:'t' }, h('strong', null, l.kind === 'bonus' ? `עדכון: ${l.title}${l.by ? ` (ע״י ${mName(l.by)})` : ''}${l.flag ? ' 🚩' : ''}` : l.title), h('small', null, `${+da}.${+mo}${l.minutes ? ` · ${l.minutes} דק׳` : ''}${l.count ? ` · ${l.count} יח׳` : ''}`)),
          h('span', { class:'num ' + (p < 0 ? 'neg' : 'gold') }, (p > 0 ? '+' : '') + p)); }))
      : h('p', { class:'sub' }, 'עוד לא בוצעו משימות.'))].filter(Boolean));
}

/* ---------- push notifications (this device) ---------- */
const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function notifPanel(memberId){
  const token = store.get('ft-push-token');
  let note = '', btn = null;
  if (!cfg.vapidKey || String(cfg.vapidKey).startsWith('PASTE')) note = 'ההתראות עוד לא הוגדרו בשרת.';
  else if (!pushSupported()) note = isIOS() && !isStandalone()
    ? 'באייפון, התראות עובדות רק אחרי שמוסיפים את האפליקציה למסך הבית (Safari ← שיתוף ← הוסף למסך הבית) ופותחים אותה משם.'
    : 'הדפדפן הזה לא תומך בהתראות.';
  else if (Notification.permission === 'denied') note = 'ההתראות חסומות בהגדרות הטלפון. כדי לקבל אותן, מאפשרים התראות לאפליקציה בהגדרות.';
  else if (token && Notification.permission === 'granted'){
    note = 'התראות פעילות בטלפון הזה, בשם ' + (member(memberId)?.name || '') + ': הודעות בצ\'אט, משימות חדשות, מנות מהמטבח, הקפצות ותזכורת בערב. אם התראות לא מגיעות, "רישום מחדש" קושר את הטלפון הזה אליך.';
    btn = h('div', { class:'row' }, h('button', { type:'button', class:'btn ghost', onclick:() => disablePush() }, 'כיבוי התראות'), h('button', { type:'button', class:'btn ghost', onclick:() => enablePush(memberId) }, 'רישום מחדש בשם ' + (member(memberId)?.name || '')));
  } else {
    note = 'קבלת התראה על הודעות בצ\'אט, משימות חדשות ותזכורת בערב על מה שנשאר.';
    btn = h('button', { type:'button', class:'btn', onclick:() => enablePush(memberId) }, 'הפעלת התראות');
  }
  return h('section', { class:'panel' }, h('h2', null, 'התראות'), h('p', { class:'sub' }, note), btn);
}
async function enablePush(memberId){
  try{
    const perm = await Notification.requestPermission();
    if (perm !== 'granted'){ toast('ההתראות לא אושרו'); render(); return; }
    const M = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js');
    if (!(await M.isSupported())){ toast('הדפדפן הזה לא תומך בהתראות'); return; }
    const reg = await navigator.serviceWorker.ready;
    const token = await M.getToken(M.getMessaging(fbApp), { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
    if (!token){ toast('לא הצלחנו להפעיל התראות'); return; }
    await setDoc(doc(db,'pushTokens',token), { memberId, uid: S.user.uid, at: Date.now() });
    store.set('ft-push-token', token); toast('ההתראות הופעלו'); render();
  }catch(e){ console.error(e); toast('לא הצלחנו להפעיל התראות'); }
}
async function disablePush(){
  const token = store.get('ft-push-token');
  try{
    if (token){ await deleteDoc(doc(db,'pushTokens',token)).catch(() => {});
      const M = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js'); await M.deleteToken(M.getMessaging(fbApp)).catch(() => {}); }
    store.set('ft-push-token', ''); toast('ההתראות כובו'); render();
  }catch(e){ fail(e); }
}

// Unread = messages from others after the last time this device opened that task's chat.
const unreadFor = t => S.messages.filter(m => m.taskId === t.id && m.memberId !== S.me && msgMs(m) > (S.seen[t.id] || 0)).length;
function markSeen_chat(taskId){
  const last = S.messages.filter(m => m.taskId === taskId).reduce((x, m) => Math.max(x, msgMs(m)), 0);
  if (last > (S.seen[taskId] || 0)){ S.seen[taskId] = last; store.set('ft-seen', JSON.stringify(S.seen)); }
}
function chatButton(t){
  const n = chatCount(t), u = unreadFor(t);
  return h('button', { type:'button', class:'chatbtn' + (u ? ' unread' : ''), onclick:() => openChat(t.id),
    'aria-label': u ? `צ'אט, ${u} הודעות חדשות` : `צ'אט${n ? `, ${n} הודעות` : ''}` },
    h('span', { 'aria-hidden':'true' }, '💬'), u ? String(u) : (n ? String(n) : null));
}
function openChat(id){ S.chatOpen = id; S.chatDraft = ''; render(); setTimeout(() => $('chat-input')?.focus(), 30); }
function closeChat(){ if (S.chatOpen) markSeen_chat(S.chatOpen); S.chatOpen = null; S.chatDraft = ''; render(); }
// The open task's chat fills the screen, like a messaging app.
function renderChatSheet(){
  const t = S.chatOpen ? S.tasks.find(x => x.id === S.chatOpen) : null;
  const sheet = $('chatSheet');
  if (!t){ if (S.chatOpen) S.chatOpen = null; sheet.hidden = true; document.body.classList.remove('locked'); return; }
  markSeen_chat(t.id);
  sheet.hidden = false; document.body.classList.add('locked');
  $('chatTitle').textContent = t.title;
  $('chatSub').textContent = `${assigneeLabel(t)} · ${recLabel(t)}`;
  const body = $('chatBody'); body.replaceChildren(chatPanel(t));
}
const msgMs = m => m.at && typeof m.at.toMillis === 'function' ? m.at.toMillis() : Date.now();
function msgTime(m){ const d = new Date(msgMs(m)); const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`; return dstr(d) === today() ? t : `${d.getDate()}.${d.getMonth()+1} ${t}`; }
function chatPanel(t){
  const msgs = S.messages.filter(m => m.taskId === t.id).sort((a,b) => msgMs(a) - msgMs(b));
  const canWrite = S.me !== 'all' && member(S.me);
  const list = h('div', { class:'chat-list', id:'chat-list' },
    msgs.length ? msgs.map(m => h('div', { class:'msg' + (m.memberId === S.me ? ' mine' : '') },
      h('div', { class:'msg-head' }, h('span', { class:'dot', style:`background:${mColor(m.memberId)}` }), h('strong', null, mName(m.memberId)), isAdminMember(m.memberId) ? h('span', { title:'מנהל' }, '👑') : null, h('span', { class:'msg-time' }, msgTime(m))),
      h('div', { class:'msg-text' }, m.text),
      S.isAdmin ? h('button', { type:'button', class:'msg-del', 'aria-label':'מחיקת הודעה', onclick:() => deleteDoc(doc(db,'messages',m.id)).catch(fail) }, 'מחיקה') : null))
    : h('p', { class:'sub' }, 'עוד אין הודעות. אפשר לסכם כאן מי עושה מה.'));
  const input = h('input', { type:'text', id:'chat-input', maxlength:'1000', placeholder: canWrite ? `כתיבה בתור ${mName(S.me)}` : 'בחרו למעלה מי משתמש עכשיו', disabled: !canWrite });
  input.value = S.chatDraft;
  input.addEventListener('input', () => { S.chatDraft = input.value; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); sendMessage(t); } });
  return h('div', { class:'chat' }, list,
    h('div', { class:'chat-send' }, input, h('button', { type:'button', class:'btn small', disabled: !canWrite, onclick:() => sendMessage(t) }, 'שליחה')));
}
async function sendMessage(t){
  const text = S.chatDraft.trim();
  if (!(S.me !== 'all' && member(S.me))){ toast('בחרו למעלה מי משתמש עכשיו'); return; }
  if (!text) return;
  S.chatDraft = ''; const inp = $('chat-input'); if (inp) inp.value = '';
  try{ await addDoc(collection(db,'messages'), { taskId:t.id, memberId: isParentNow() ? S.boundId : S.me, text:text.slice(0,1000), at: serverTimestamp() }); }
  catch(e){ S.chatDraft = text; fail(e); render(); }
}
function renderWho(){
  const w = $('who');
  if (isParentNow() || plainAdmin()){
    // a parent marks for a child (e.g. one without a phone); only children are listed. The admin in plain mode can pick anyone.
    w.replaceChildren(h('span', { class:'lbl' }, 'מסמן עבור:'));
    const mk = (id, label, color) => h('button', { type:'button', class:'chip', 'aria-pressed':String((S.actFor || null) === id),
      onclick:() => { S.actFor = id; S.openPick = null; S.qtyAsk = null; render(); } }, color ? h('span', { class:'dot', style:`background:${color}` }) : null, label);
    w.append(mk(null, `אני (${mName(S.boundId)})`));
    const allowed = plainAdmin() ? null : new Set(markableBy(S.boundId));
    S.members.filter(m => m.id !== S.boundId && (!allowed || allowed.has(m.id))).forEach(m => w.append(mk(m.id, m.name, m.color)));
    return;
  }
  w.replaceChildren(h('span', { class:'lbl' }, 'מי משתמש עכשיו:'));
  const mk = (id, label, color) => h('button', { type:'button', class:'chip', 'aria-pressed':String(S.me === id),
    onclick:() => { S.me = id; store.set('ft-me', id); S.openPick = null; render(); } },
    color ? h('span', { class:'dot', style:`background:${color}` }) : null, label);
  w.append(mk('all','כולם'));
  S.members.forEach(m => w.append(mk(m.id, m.name, m.color)));
}
function renderBoard(){
  const b = $('board'); b.replaceChildren();
  if (!S.members.length){
    b.append(h('div', { class:'empty', style:'grid-column:1/-1' }, h('strong', null, 'עדיין אין בני משפחה'),
      S.isAdmin ? 'הוסיפו אותם בלשונית ניהול, ואז כל אחד יקבל כאן את הנקודות שלו.' : 'עוד לא נוספו בני משפחה ללוח.'));
    return;
  }
  const ws = weekStart();
  const rows = S.members.map(m => { let wk = 0, tot = 0;
    for (const l of S.logs){ if (l.memberId !== m.id || l.kind === 'redeem' || !counted(l)) continue; const p = Number(l.points) || 0; tot += p; if (l.day >= ws && inRace(l)) wk += p; }
    return { m, wk, tot }; }).sort((a,b) => b.wk - a.wk);
  const top = rows[0].wk;
  rows.forEach(r => { const lead = top > 0 && r.wk === top;
    const wkILS = shekelsFor(r.wk), totILS = shekelsFor(r.tot);
    b.append(h('button', { type:'button', class:'score' + (lead ? ' lead' : '') + (isAdminMember(r.m.id) ? ' royal' : ''), style:`--m:${r.m.color}`, 'aria-label':`הפרופיל של ${r.m.name}`, onclick:() => openProfile(r.m.id) },
      h('div', { class:'ava', style:`background:${r.m.color}` }, avatarOf(r.m.id)),
      h('div', { class:'info' },
        lead ? h('span', { class:'crown' }, 'מוביל/ה השבוע') : null,
        h('span', { class:'name' }, r.m.name),
        adminTag(r.m.id),
        h('span', { class:'pts' }, r.wk),
        wkILS != null ? h('span', { class:'money' }, `${fmtILS(wkILS)} השבוע`) : null,
        h('span', { class:'tot' }, `סה״כ ${r.tot}` + (totILS != null ? ` · ${fmtILS(totILS)}` : ''))))); });
}
function renderToday(){
  const mine = isMine;
  const due = S.tasks.filter(t => isDue(t) && mine(t) && !t.boss).sort((a,b) => (!!b.pinned - !!a.pinned) || (a.type === 'once') - (b.type === 'once') || ((b.points||0) - (a.points||0)));
  $('todoTitle').textContent = S.me === 'all' || seeAll() ? 'מה נשאר להיום' : `מה נשאר ל${mName(S.me)} היום`;
  $('todoCount').textContent = due.length ? `${due.length} משימות` : '';
  const L = $('todo'); L.replaceChildren();
  if (!S.tasks.length) L.append(h('div', { class:'empty' }, h('strong', null, 'אין עדיין משימות'),
    S.isAdmin ? 'הוסיפו משימה בלשונית ניהול: שם, כמה נקודות, של מי, ובאילו ימים.' : 'עוד לא נוספו משימות ללוח.'));
  else if (!due.length) L.append(h('div', { class:'empty' }, h('strong', null, 'הכל בוצע להיום'), 'משימות חוזרות יופיעו שוב ביום שלהן.'));
  due.forEach(t => L.append(taskCard(t, canDoTask(t))));
  const td = today();
  const done = S.logs.filter(l => (l.kind === 'task' || l.kind === 'timed') && !rejected(l) && l.day === td).sort((a,b) => b.at - a.at);
  $('doneSec').hidden = !done.length;
  $('doneCount').textContent = done.length ? `${done.length} משימות` : '';
  const D = $('doneList'); D.replaceChildren();
  done.forEach(l => D.append(h('div', { class:'done' + (counted(l) ? '' : ' waiting') },
    h('span', { class:'dot', style:`background:${mColor(l.memberId)}` }),
    h('span', { class:'t' }, h('strong', { class:'done-who' }, mName(l.memberId)), ` · ${l.title}` + (l.minutes ? ` · ${l.minutes} דק׳` : '') + (l.count ? ` · ${l.count} יח׳` : '') + (l.by ? ` (סומן ע״י ${mName(l.by)})` : '')),
    counted(l) ? h('span', { class:'num gold' }, `+${l.points}`) : h('span', { class:'wait-tag' }, 'מחכה לאישור'),
    waiting(l) ? (photoThumb(l) || ((S.isAdmin || l.memberId === S.boundId) ? h('button', { type:'button', class:'btn ghost small', 'aria-label':'צירוף תמונה', onclick:() => attachPhoto(l) }, '📷') : null)) : null,
    (S.isAdmin || l.memberId === S.boundId) ? h('button', { type:'button', class:'btn ghost small', onclick:() => removeLog(l) }, 'ביטול')
      : isParentNow() ? armedBtn('nd' + l.id, 'לא בוצע', () => removeLog(l)) : null)));
}


/* ---------- home: greeting, progress, task cards ---------- */
function greeting(){ const hr = new Date().getHours(); return hr < 5 ? 'לילה טוב' : hr < 12 ? 'בוקר טוב' : hr < 17 ? 'צהריים טובים' : hr < 21 ? 'ערב טוב' : 'לילה טוב'; }
function renderHero(bound){
  const who = bound || (S.me !== 'all' ? S.me : null);
  const m = who ? member(who) : null;
  $('appTitle').textContent = m ? `${greeting()}, ${m.name}!` : `${greeting()}!`;
  const hr = $('heroRoast'); const king = S.isAdmin || (!!m && roleOf(m.id) === 'admin');
  hr.hidden = !m && !king;
  if (king){ const pj = praiseJokeOf(); hr.replaceChildren(h('span', { class:'hr-setup' }, '👑 ' + pj.setup + ' '), h('span', { class:'hr-punch praise' }, pj.punch)); }
  else if (m){ const j = jokeFor(m); hr.replaceChildren(j.setup ? h('span', { class:'hr-setup' }, j.setup + ' ') : `${greeting()} ${m.name}, `, h('span', { class:'hr-punch' }, j.punch)); }
  const btn = $('heroMe'); btn.hidden = !m;
  if (m){ $('heroAva').textContent = avatarOf(m.id); $('heroAva').style.background = m.color; btn.onclick = () => openProfile(m.id); }
}
// Today's progress for whoever is shown: tasks finished today vs. finished + still due today.
// Family goal for the month: everyone's task points together.
const monthStart = () => { const d = new Date(); return dstr(new Date(d.getFullYear(), d.getMonth(), 1)); };
function renderGoal(){
  $('goalEditor').hidden = !canEditGoal();
  const g = S.goal; const on = g && g.target > 0;
  document.querySelectorAll('[data-goal]').forEach(el => {
    el.hidden = !on; el.replaceChildren(); if (!on) return;
    const ms = monthStart();
    const sum = S.logs.filter(l => (l.kind === 'task' || l.kind === 'timed') && counted(l) && l.day >= ms).reduce((s, l) => s + (Number(l.points) || 0), 0);
    const pct = Math.min(100, Math.round(sum / g.target * 100)); const done = sum >= g.target;
    el.classList.toggle('reached', done);
    el.append(
      h('div', { class:'goal-head' }, h('span', { class:'goal-e', 'aria-hidden':'true' }, done ? '🎉' : '🎯'),
        h('div', { class:'goal-t' }, h('strong', null, done ? `הגעתם ליעד! ${g.prize || ''}`.trim() : `יעד משפחתי: ${g.prize || `${g.target} נקודות`}`),
          h('span', { class:'sub' }, done ? 'כל הכבוד לכולם. היעד מתאפס בתחילת החודש הבא.' : `עוד ${g.target - sum} נקודות ביחד החודש`)),
        h('span', { class:'progress-pct' }, `${pct}%`)),
      h('div', { class:'progress-bar' }, h('span', { style:`width:${pct}%` })),
      h('p', { class:'sub' }, `${sum} מתוך ${g.target} נקודות`));
  });
}
async function saveGoal(){
  const target = Math.round(Number($('gl-target').value)); const prize = $('gl-prize').value.trim();
  if (!(target >= 0)){ toast('יעד: מספר נקודות'); return; }
  if (!canEditGoal()){ toast('רק הורה או מנהל יכולים לשנות את היעד'); return; }
  const data = { target, prize, ...(S.isAdmin ? {} : { by: S.boundId }) };
  try{ await setDoc(doc(db,'settings','goal'), data); toast(target ? 'היעד נשמר' : 'היעד בוטל'); }catch(e){ fail(e); }
}
// Home: this week's standings (task points + bonuses, approved only), with medals for the top three.
function renderProgress(){
  const L = $('rankList'); L.replaceChildren();
  $('progress').hidden = !S.members.length;
  const ws = weekStart();
  const rows = S.members.map(m => ({ m, pts: S.logs.filter(l => l.memberId === m.id && inRace(l) && counted(l) && l.day >= ws).reduce((s, l) => s + (Number(l.points) || 0), 0) }))
    .sort((a, b) => b.pts - a.pts || (a.m.name || '').localeCompare(b.m.name || '', 'he'));
  const top = rows.length ? rows[0].pts : 0;
  // the first view shows the top 3; tapping the table (or the button under it) shows everyone
  $('rankHint').hidden = rows.length <= 3; $('rankHint').textContent = S.rankOpen ? 'סגירה ▲' : `הטבלה המלאה (${rows.length}) ▼`;
  let place = 0, prev = null;
  rows.forEach((r, i) => {
    if (r.pts !== prev){ place = i + 1; prev = r.pts; }   // ties share a place
    if (i >= 3 && !S.rankOpen) return;
    const medal = r.pts > 0 ? ({ 1:'🥇', 2:'🥈', 3:'🥉' })[place] : null;
    const me = r.m.id === S.boundId || r.m.id === S.me;
    L.append(h('li', null, h('button', { type:'button', class:'rank' + (me ? ' me' : '') + (isAdminMember(r.m.id) ? ' royal' : ''), onclick:() => openProfile(r.m.id), 'aria-label':`מקום ${place}: ${r.m.name}, ${r.pts} נקודות` },
      h('span', { class:'rank-n' }, medal || String(place)),
      h('span', { class:'ava sm', style:`background:${r.m.color}` }, avatarOf(r.m.id)),
      h('span', { class:'rank-name' }, r.m.name),
      h('span', { class:'rank-bar', 'aria-hidden':'true' }, h('span', { style:`width:${top > 0 ? Math.round(r.pts / top * 100) : 0}%;background:${r.m.color}` })),
      h('span', { class:'rank-pts' }, String(r.pts)))));
  });
}
const ICONS = [[/זבל|פח/, '🗑️'], [/כלים|מדיח/, '🍽️'], [/כביס|לתלות|לקפל/, '🧺'], [/מיטה|חדר|לסדר|מדפ/, '🛏️'], [/כלב/, '🐕'], [/חתול/, '🐈'],
  [/לקרוא|ספר/, '📚'], [/שיעורי|ללמוד|מבחן/, '✏️'], [/להשקות|גינה|עציצ|צמח/, '🪴'], [/לבשל|ארוחה|מטבח|אוכל|שולחן/, '🍳'], [/שיניים|מקלחת|אמבט/, '🪥'],
  [/שואב|לטאטא|לנקות|ניקיון|אבק/, '🧹'], [/רצפה|לשטוף/, '🧽'], [/קניות|סופר/, '🛒'], [/נגינה|לנגן|פסנתר|גיטרה/, '🎵'], [/ספורט|ריצה|אימון|כדור/, '⚽']];
const taskIcon = t => (ICONS.find(([re]) => re.test(t.title || '')) || [null, '📋'])[1];
// One task as a card. canAct: show the finish/start control (tasks due today).
function taskCard(t, canAct){
  const turn = whoseTurn(t); const timed = isTimed(t);
  const who = (turn === 'all' || turn === 'each') ? (S.me !== 'all' && !(isParentNow() && !actingChild()) ? S.me : null) : turn;
  const running = timed ? S.timers.filter(tm => tm.taskId === t.id && member(tm.memberId) && (S.me === 'all' || seeAll() || tm.memberId === S.me)) : [];
  const whoRunning = who && running.some(tm => tm.memberId === who);
  const busy = S.busy.has(t.id) || (who && S.busy.has(timerId(t.id, who)));
  const act = timed ? (m => startTimer(t, m)) : t.qtyPer ? (m => askQty(t, m)) : (m => complete(t, m));
  const go = () => { if (who && member(who)) act(who); else { S.openPick = S.openPick === t.id ? null : t.id; render(); } };
  const meta = [h('span', { class:'ptspill' + (t.boss ? ' boss' : '') }, '★ ', timed ? `${t.ratePerMin} לדקה` : t.qtyPer ? `${t.points} על כל ${t.qtyPer}` : String(ptsOf(t)))];
  if (timed) meta.push(h('span', { class:'pts-note' }, `עד ${t.maxMinutes} דק׳`)); else if (t.qtyPer) meta.push(h('span', { class:'pts-note' }, t.qtyUnit)); else if (t.boss) meta.push(h('span', { class:'pts-note' }, 'פי 3'));
  const sub = [assigneeLabel(t), recLabel(t)];
  if (t.check) sub.push('צריך אישור');
  if (t.untilTime) sub.push(pastDeadline(t) ? `⏰ עבר ${t.untilTime}, פספסת` : `⏰ עד ${t.untilTime}`);
  if (t.pinned) sub.unshift('נעוצה');
  let control = null;
  if (canAct && !whoRunning){
    control = timed
      ? h('button', { type:'button', class:'btn small start', disabled: busy || !S.members.length, onclick: go }, busy ? 'שומר…' : 'התחלתי')
      : h('button', { type:'button', class:'donecheck', 'aria-label':`סיימתי: ${t.title}`, disabled: busy || !S.members.length, onclick: go }, busy ? '…' : '');
  }
  if (t.boss) sub.unshift('🐉 משימת בוס · הראשון שעושה מנצח');
  const card = h('div', { class:'task' + (t.pinned ? ' pinned' : '') + (t.boss ? ' boss' : '') },
    h('div', { class:'ticon', 'aria-hidden':'true' }, taskIcon(t)),
    h('div', { class:'body' }, h('span', { class:'title' }, t.title), h('div', { class:'meta' }, meta),
      h('span', { class:'task-sub' }, sub.join(' · '))),
    control,
    // secondary buttons go on their own row under the title, so the title keeps the full width
    h('div', { class:'tools' },
      chatButton(t),
      canEditTask(t) ? h('button', { type:'button', class:'chatbtn editbtn', 'aria-label':`עריכה: ${t.title}`, title:'עריכה', onclick:() => openTaskEdit(t) }, '✏️') : null,
      canEditTask(t) ? h('button', { type:'button', class:'chatbtn editbtn', 'aria-label':`שכפול: ${t.title}`, title:'שכפול', onclick:() => duplicateTask(t) }, '⧉') : null,
      canBump(t) ? h('button', { type:'button', class:'chatbtn editbtn', 'aria-label':`הקפצה: ${t.title}`, title:'הקפצה', onclick:() => nudgeTask(t) }, '📣') : null,
      (S.isAdmin && S.plain && !t.pinned) ? (() => { const b = h('button', { type:'button', class:'chatbtn editbtn', 'aria-label':`מחיקה: ${t.title}`, title:'מחיקה' }, '🗑️');
        b.addEventListener('click', () => arm('dt' + t.id, b, () => deleteTask(t, false))); if (S.armed === 'dt' + t.id){ b.classList.add('armed'); b.textContent = 'בטוח?'; } return b; })() : null));
  running.forEach(tm => {
    const r = timedResult(t, tm); const b = S.busy.has(tm.id);
    card.append(h('div', { class:'running' },
      h('span', { class:'pulse', 'aria-hidden':'true' }),
      h('span', { class:'who-run' }, h('span', { class:'dot', style:`background:${mColor(tm.memberId)}` }), mName(tm.memberId)),
      h('span', { class:'clock', 'data-timer':tm.id }, clock(r.ms)),
      h('span', { class:'earn', 'data-earn':tm.id }, `+${r.points}`),
      h('span', { class:'capnote', 'data-cap':tm.id }, r.capped ? 'הגיע לתקרה' : ''),
      h('span', { class:'grow' }),
      h('button', { type:'button', class:'btn small', disabled:b, onclick:() => finishTimer(t, tm) }, b ? 'שומר…' : 'סיימתי'),
      h('button', { type:'button', class:'btn ghost small', disabled:b, onclick:() => cancelTimer(tm) }, 'ביטול')));
  });
  if (canAct && S.qtyAsk?.id === t.id){
    const qa = S.qtyAsk; const out = h('span', { class:'qty-pts' });
    const upd = () => { const n = Math.round(Number(qa.val)) || 0; out.textContent = n >= t.qtyPer ? `= ${qtyPoints(t, n)} נקודות` : `לפחות ${t.qtyPer}`; };
    const inp = h('input', { type:'number', id:'qtyIn', min:String(t.qtyPer), inputmode:'numeric', value: qa.val, 'aria-label':`כמה ${t.qtyUnit}` });
    inp.addEventListener('input', () => { qa.val = inp.value; upd(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') completeQty(t, qa.m, qa.val); });
    upd();
    card.append(h('div', { class:'qtyask' }, h('span', { class:'lbl' }, `כמה ${t.qtyUnit}${S.members.length > 1 ? ` (${mName(qa.m)})` : ''}?`), inp, out,
      h('button', { type:'button', class:'btn small', disabled: S.busy.has(t.id), onclick:() => completeQty(t, qa.m, qa.val) }, 'שמירה'),
      h('button', { type:'button', class:'btn ghost small', onclick:() => { S.qtyAsk = null; render(); } }, 'ביטול')));
  }
  if (canAct && S.openPick === t.id) card.append(h('div', { class:'pickwho' }, h('span', { class:'lbl' }, timed ? 'מי מתחיל?' : 'מי עשה?'),
    S.members.filter(m => !running.some(tm => tm.memberId === m.id) && (!isParentNow() || m.id === S.boundId || markableBy(S.boundId).includes(m.id)) && (t.assignee !== 'each' || isDueFor(t, m.id))).map(m => h('button', { type:'button', class:'chip', onclick:() => act(m.id) },
      h('span', { class:'dot', style:`background:${m.color}` }), m.name))));
  return card;
}
// Every task, grouped: due today, other repeating days, one-time tasks already done.
function renderAllTasks(){
  const L = $('allTasks'); L.replaceChildren();
  const mine = isMine;
  const list = S.tasks.filter(t => !t.pending && mine(t));
  $('allCount').textContent = list.length ? String(list.length) : '';
  if (!list.length){ L.append(h('div', { class:'empty' }, h('strong', null, 'אין עדיין משימות'), 'משימות חדשות יופיעו כאן.')); return; }
  const dueNow = list.filter(isDue), later = list.filter(t => !isDue(t) && t.type !== 'once'), finished = list.filter(t => !isDue(t) && t.type === 'once');
  const group = (title, items, canAct) => { if (!items.length) return;
    L.append(h('h3', { class:'group-h' }, title));
    items.sort((a,b) => (!!b.pinned - !!a.pinned) || (a.title||'').localeCompare(b.title||'','he')).forEach(t => L.append(taskCard(t, canAct === 'own' ? canDoTask(t) : canAct))); };
  group('להיום', dueNow, 'own');
  group('בימים אחרים', later, false);
  group('חד-פעמיות שבוצעו', finished, false);
}


/* ---------- wallet: points I have, what they're worth, what I used ---------- */
function walletOf(id){
  let earned = 0, used = 0;
  for (const l of S.logs){ if (l.memberId !== id || !counted(l)) continue; const p = Number(l.points) || 0; if (l.kind === 'redeem') used += p; else earned += p; }
  return { earned, used, balance: earned - used };
}
function rewardsWho(){ return S.boundId || (S.me !== 'all' && member(S.me) ? S.me : null); }
async function redeem(memberId, title, cost, rewardId, force){
  const w = walletOf(memberId);
  if (!(cost >= 1)){ toast('כמות נקודות: לפחות 1'); return false; }
  if (cost > w.balance && !force){ toast(`אין מספיק נקודות: יש ${w.balance}, צריך ${cost}`); return false; }
  try{
    const w = !S.isAdmin && isWatched(memberId);
    await addDoc(collection(db,'logs'), { kind:'redeem', title, memberId, points:cost, ...(rewardId ? { rewardId } : {}), ...(w ? { approved:false } : {}), day:today(), at:Date.now() }); confetti(70);
    toast(w ? `נשלח לאישור המנהל: ${title}` : `${mName(memberId)}: ירדו ${cost} נקודות`); return true;
  }catch(e){ fail(e); return false; }
}
function renderRewards(){
  const who = rewardsWho();
  const rw = $('rw-who'); rw.replaceChildren(); rw.hidden = !S.isAdmin || S.plain;
  if (S.isAdmin && !S.plain){ rw.append(h('span', { class:'lbl' }, 'של מי:'));
    S.members.forEach(m => rw.append(h('button', { type:'button', class:'chip', 'aria-pressed':String(S.me === m.id),
      onclick:() => { S.me = m.id; store.set('ft-me', m.id); render(); } }, h('span', { class:'dot', style:`background:${m.color}` }), m.name))); }
  const W = $('wallet'); W.replaceChildren();
  $('rw-use').hidden = !who;
  if (!who){
    W.append(h('div', { class:'empty' }, h('strong', null, 'בחרו בן משפחה'), 'כדי לראות כמה נקודות יש לו ומה הן שוות.'));
  } else {
    const w = walletOf(who); const m = member(who);
    const ils = v => shekelsFor(v) != null ? fmtILS(shekelsFor(v)) : null;
    const rate = S.money && S.money.shekels > 0 ? `${S.money.points} נקודות = ${fmtILS(S.money.shekels)}` : null;
    W.append(
      h('div', { class:'wallet-main' }, h('span', { class:'wallet-l' }, `הארנק של ${m.name}`),
        h('span', { class:'wallet-v' }, ils(w.balance) || h('span', null, h('span', { class:'star', 'aria-hidden':'true' }, '★'), String(w.balance))),
        ils(w.balance) ? h('span', { class:'wallet-s' }, `${w.balance} נקודות`) : null,
        h('span', { class:'wallet-l' }, rate || (S.isAdmin ? 'עוד לא נקבע כמה שווה נקודה. קובעים בניהול ← המרה לכסף.' : 'עוד לא נקבע כמה שווה נקודה.'))),
      h('div', { class:'wallet-row' },
        h('div', null, h('span', { class:'wallet-n' }, ils(w.earned) || String(w.earned)), h('span', { class:'wallet-l' }, `צבר בכל הזמן${ils(w.earned) ? ` · ${w.earned} נק׳` : ''}`)),
        h('div', null, h('span', { class:'wallet-n' }, ils(w.used) || String(w.used)), h('span', { class:'wallet-l' }, `השתמש${ils(w.used) ? ` · ${w.used} נק׳` : ''}`))));
  }
  const H = $('rwHist'); H.replaceChildren();
  const hist = S.logs.filter(l => l.kind === 'redeem' && (!who || l.memberId === who)).sort((a,b) => b.at - a.at).slice(0, 30);
  if (!hist.length) H.append(h('p', { class:'sub' }, 'עוד לא השתמשו בנקודות.'));
  hist.forEach(l => { const [, mo, da] = (l.day || '--').split('-'); const v = shekelsFor(l.points);
    H.append(h('div', { class:'arow' },
      h('div', { class:'t' }, h('strong', null, l.title), h('small', null, `${+da}.${+mo}${who ? '' : ` · ${mName(l.memberId)}`}`)),
      waiting(l) ? h('span', { class:'wait-tag' }, 'הלוואה מחכה לאישור') : rejected(l) ? h('span', { class:'wait-tag' }, 'לא אושר') : h('span', { class:'num neg' }, `-${l.points}` + (v != null ? ` (${fmtILS(v)})` : '')),
      S.isAdmin ? armedBtn('rh' + l.id, 'ביטול', () => removeLog(l)) : null)); });
}
async function saveUse(){
  const who = rewardsWho(); if (!who) return;
  const pts = Math.round(Number($('ru-points').value)); const note = $('ru-note').value.trim() || 'שימוש בנקודות';
  if (!(pts >= 1)){ toast('כתבו כמה נקודות'); $('ru-points').focus(); return; }
  const btn = $('ru-save'); btn.disabled = true;
  if (await redeem(who, note, pts)){ $('ru-points').value = ''; $('ru-note').value = ''; }
  btn.disabled = false;
}


/* ---------- approvals (admin and parents) ---------- */
function renderReview(){
  const R = $('reviewList'); R.replaceChildren();
  const wait = S.logs.filter(l => waiting(l) && canApprove(l)).sort((a,b) => a.at - b.at);
  $('reviewPanel').hidden = !wait.length; $('reviewCount').textContent = wait.length ? String(wait.length) : '';
  const by = S.isAdmin ? {} : { approvedBy: S.boundId };
  wait.forEach(l => { const [, mo, da] = (l.day || '--').split('-'); const loan = l.kind === 'redeem';
    R.append(h('div', { class:'arow arow-wrap' },
      photoThumb(l),
      h('div', { class:'t' }, h('strong', null, loan ? `🤝 הלוואה: ${l.title} · ${mName(l.memberId)}` : l.kind === 'bonus' ? `${l.points > 0 ? '➕' : '➖'} ${mName(l.by)} ${l.by === l.memberId ? 'לעצמו/ה' : `ל${mName(l.memberId)}`}: ${l.title}` : `${l.title} · ${mName(l.memberId)}`),
        h('small', null, loan ? `יתרה עכשיו: ${walletOf(l.memberId).balance} · אחרי: ${walletOf(l.memberId).balance - l.points}` : `${+da}.${+mo}${l.minutes ? ` · ${l.minutes} דק׳` : ''}${l.count ? ` · ${l.count} יח׳` : ''}`)),
      h('span', { class:'num ' + (loan || l.points < 0 ? 'neg' : 'gold') }, loan ? `-${l.points}` : `${l.points > 0 ? '+' : ''}${l.points}`),
      h('button', { type:'button', class:'btn small', onclick: async () => { try{ await updateDoc(doc(db,'logs',l.id), { approved:true, ...by }); dropPhoto(l.id); toast(loan ? 'ההלוואה אושרה' : `אושר: ${mName(l.memberId)} קיבל/ה ${l.points} נקודות`); }catch(e){ fail(e); } } }, 'אישור'),
      armedBtn('rv' + l.id, loan || l.kind === 'bonus' ? 'לא מאשר' : 'לא בוצע', async () => { try{ await updateDoc(doc(db,'logs',l.id), { approved:'rejected', ...by }); dropPhoto(l.id); toast(loan ? 'ההלוואה לא אושרה' : l.kind === 'bonus' ? 'השינוי לא אושר' : 'סומן כלא בוצע. המשימה חוזרת לרשימה.'); }catch(e){ fail(e); } }))); });
}

/* ---------- ready-made household tasks ---------- */
// [title, points or {rate, max} for timed, days (0=Sunday) or 'once']
const PRESETS = [
  ['לסדר את החדר', 10, [0,1,2,3,4,5,6]], ['להוציא את הזבל', 10, [0,2,4]], ['לפרוק את המדיח', 10, [0,1,2,3,4,5,6]],
  ['לשטוף כלים', 15, [0,1,2,3,4,5,6]], ['לערוך את השולחן', 5, [0,1,2,3,4,5,6]], ['לפנות את השולחן', 5, [0,1,2,3,4,5,6]],
  ['לתלות כביסה', 15, [1,4]], ['לקפל ולסדר כביסה', 15, [1,4]], ['לשאוב אבק', 20, [5]], ['לשטוף רצפה', 25, [5]],
  ['לנקות שירותים', 25, [5]], ['להשקות עציצים', 5, [1,4]], ['להאכיל את הכלב', 5, [0,1,2,3,4,5,6]], ['לצחצח שיניים בוקר וערב', 5, [0,1,2,3,4,5,6]],
  ['להכין שיעורי בית', 15, [0,1,2,3,4]], ['לסדר את התיק למחר', 5, [0,1,2,3,4]], ['להחליף מצעים', 20, [5]], ['לעזור בקניות', 15, 'once'],
  ['לסדר גרביים בזוגות', { per: 5, unit: 'גרביים', pts: 3 }, [0,1,2,3,4,5,6]], ['לאסוף צעצועים', { per: 10, unit: 'צעצועים', pts: 2 }, [0,1,2,3,4,5,6]],
  ['לקרוא ספר', { rate: 1, max: 30 }, [0,1,2,3,4,5,6]], ['להתאמן או לשחק בחוץ', { rate: 1, max: 45 }, [0,1,2,3,4,5,6]]];
function renderPresets(){
  for (const id of ['presets','presetsFam']){
  const box = $(id); if (box.dataset.built) continue; box.dataset.built = '1';
  PRESETS.forEach(([title, pts, days]) => {
    const timed = typeof pts === 'object' && !pts.per;
    box.append(h('button', { type:'button', class:'chip preset', 'data-title':title, onclick: () => addPreset(title, pts, days) },
      taskIcon({ title }) + ' ' + title, h('span', { class:'preset-pts' }, pts.per ? `${pts.pts}/${pts.per}` : timed ? `${pts.rate}/דק׳` : `+${pts}`)));
  });
  }
  markPresets();
}
function markPresets(){ const have = new Set(S.tasks.map(t => t.title)); document.querySelectorAll('.preset').forEach(b => b.classList.toggle('added', have.has(b.dataset.title))); }
async function addPreset(title, pts, days){
  if (S.tasks.some(t => t.title === title)){ toast('המשימה הזו כבר קיימת'); return; }
  const timed = typeof pts === 'object' && !pts.per; const once = days === 'once';
  const data = { title, assignee:'all', type: once ? 'once' : 'repeat', days: once ? [] : days, timed, check:false,
    ...(pts.per ? { points: pts.pts, qtyPer: pts.per, qtyUnit: pts.unit } : timed ? { ratePerMin: pts.rate, maxMinutes: pts.max } : { points: pts }), createdAt: Date.now(),
    ...(S.isAdmin ? {} : { reviewed:false, suggestedBy: S.boundId }) };
  if (!S.isAdmin && !S.boundId){ toast('קודם נכנסים עם הקוד שלך'); return; }
  try{ await addDoc(collection(db,'tasks'), data); toast(`נוספה: ${title}. אפשר לשנות אותה ב"כל המשימות".`); }catch(e){ fail(e); }
}


/* ---------- exchanges: spend points on a reward (admin and parents manage the list) ---------- */
const EX_EMOJI = ['📺','📱','🎮','🍦','🍫','🍕','🎬','🛌','🙅','🎨','⚽','🚲','🎟️','🧸','📚','🎁','💵','⭐'];
const EX_STARTER = [['📺','15 דקות טלוויזיה',10], ['📱','30 דקות טלפון או טאבלט',20], ['🎮','30 דקות משחק מחשב',20], ['🍫','ממתק אחד',15],
  ['🍦','גלידה',30], ['🛌','לישון חצי שעה מאוחר יותר',40], ['🎬','לבחור סרט לערב משפחתי',50], ['🍕','לבחור מה אוכלים בערב',60],
  ['🙅','פטור ממשימה אחת',50], ['🎟️','יציאה לפעילות לבחירה',200]];
const canEditRewards = () => S.isAdmin || (!!S.boundId && isParentMember(S.boundId));
const activeRewards = () => (S.rewards || []).filter(r => !r.archived).sort((a,b) => (a.cost||0) - (b.cost||0));
function renderExchanges(){
  const who = rewardsWho(); const bal = who ? walletOf(who).balance : 0; const list = activeRewards();
  const G = $('exGrid'); G.replaceChildren(); $('exCount').textContent = list.length ? String(list.length) : '';
  if (!list.length) G.append(h('div', { class:'empty', style:'grid-column:1/-1' }, h('strong', null, 'עוד אין על מה להחליף'),
    canEditRewards() ? 'הוסיפו למטה, או לחצו "הוספת רשימה מוכנה".' : 'מנהל או הורה יוסיפו בקרוב.'));
  list.forEach(r => {
    const key = 'ex' + r.id; const can = !!who && bal >= r.cost;
    const pend = !!who && S.logs.some(l => l.kind === 'redeem' && waiting(l) && l.memberId === who && l.rewardId === r.id);
    const loanable = !!who && !can && !pend;
    const btn = h('button', { type:'button', class:'btn small' + (loanable ? ' ghost' : ''), disabled: !can && !loanable },
      can ? 'להחליף' : pend ? 'מחכה לאישור' : loanable ? (S.isAdmin ? `לתת בהלוואה (חסרות ${r.cost - bal})` : `הלוואה? חסרות ${r.cost - bal}`) : 'להחליף');
    btn.addEventListener('click', () => arm(key, btn, () => can ? redeem(who, r.title, r.cost, r.id) : S.isAdmin ? redeem(who, r.title, r.cost, r.id, true) : requestLoan(who, r)));
    if (S.armed === key){ btn.classList.add('armed'); btn.textContent = 'בטוח? שוב'; }
    G.append(h('div', { class:'reward' + (can ? '' : ' locked') },
      h('span', { class:'reward-e', 'aria-hidden':'true' }, r.emoji || '🎁'),
      h('span', { class:'reward-t' }, r.title),
      h('span', { class:'pts-line' }, h('span', { class:'star', 'aria-hidden':'true' }, '★'), `${r.cost} נקודות`),
      btn,
      canEditRewards() ? h('div', { class:'reward-admin' },
        h('button', { type:'button', class:'linkbtn', onclick: () => editExchange(r) }, 'עריכה'),
        h('button', { type:'button', class:'linkbtn danger', onclick: () => removeExchange(r) }, 'הסרה')) : null));
  });
  $('exEditor').hidden = !canEditRewards();
}
const byField = () => S.isAdmin ? {} : { by: S.boundId };
function editExchange(r){ S.openPanels.add('exEditor'); syncCollapsibles(); S.editEx = r.id; $('ex-emoji').value = r.emoji || '🎁'; $('ex-title').value = r.title; $('ex-cost').value = r.cost; $('exHead').textContent = 'עריכת החלפה'; $('ex-save').textContent = 'שמירה'; $('ex-cancel').hidden = false; $('ex-title').focus(); }
function resetExchange(){ S.editEx = null; $('ex-title').value = ''; $('ex-cost').value = 10; $('exHead').textContent = 'הוספת החלפה'; $('ex-save').textContent = 'הוספה'; $('ex-cancel').hidden = true; }
async function saveExchange(){
  const title = $('ex-title').value.trim(); const cost = Math.round(Number($('ex-cost').value)); const emoji = $('ex-emoji').value || '🎁';
  if (!title){ toast('כתבו מה מקבלים'); $('ex-title').focus(); return; }
  if (!(cost >= 1 && cost <= 100000)){ toast('כמה נקודות: מספר חיובי'); return; }
  try{
    if (S.editEx){ const old = S.rewards.find(x => x.id === S.editEx); await setDoc(doc(db,'rewards',S.editEx), { title, cost, emoji, createdAt: old?.createdAt || Date.now(), ...byField() }); toast('נשמר'); }
    else { await addDoc(collection(db,'rewards'), { title, cost, emoji, createdAt: Date.now(), ...byField() }); toast('נוסף'); }
    resetExchange();
  }catch(e){ fail(e); }
}
async function removeExchange(r){
  try{ await setDoc(doc(db,'rewards',r.id), { title:r.title, cost:r.cost, emoji:r.emoji || '🎁', createdAt:r.createdAt || Date.now(), archived:true, ...byField() }); toast('הוסר'); if (S.editEx === r.id) resetExchange(); }catch(e){ fail(e); }
}
async function addStarterExchanges(){
  const have = new Set(activeRewards().map(r => r.title)); const b = writeBatch(db); let n = 0;
  for (const [emoji, title, cost] of EX_STARTER){ if (have.has(title)) continue; b.set(doc(collection(db,'rewards')), { title, cost, emoji, createdAt: Date.now() + n, ...byField() }); n++; }
  if (!n){ toast('כל הרשימה כבר קיימת'); return; }
  try{ await b.commit(); toast(`נוספו ${n}. אפשר לערוך מחירים ולהסיר מה שלא מתאים.`); }catch(e){ fail(e); }
}


/* ---------- confetti ---------- */
function confetti(n = 90){
  try{ if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; }catch(e){}
  const c = document.createElement('canvas'); c.className = 'confetti'; document.body.append(c);
  const k = devicePixelRatio || 1, W = c.width = innerWidth * k, H = c.height = innerHeight * k, x = c.getContext('2d');
  const cols = ['#FFB84D','#39B980','#172B4D','#FF6B6B','#4DA3FF','#B57BFF'];
  const ps = Array.from({ length:n }, () => ({ x: W/2 + (Math.random() - .5) * W * .4, y: H * .4, vx: (Math.random() - .5) * 16 * k, vy: (-Math.random() * 17 - 6) * k,
    r: (4 + Math.random() * 5) * k, c: cols[Math.random() * cols.length | 0], a: Math.random() * 6, s: (Math.random() - .5) * .35 }));
  const t0 = performance.now();
  (function f(t){ x.clearRect(0, 0, W, H);
    for (const p of ps){ p.vy += .55 * k; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.s; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); x.restore(); }
    if (t - t0 < 2300) requestAnimationFrame(f); else c.remove(); })(t0);
}

/* ---------- badges (computed from the logs, nothing stored) ---------- */
const BADGES = [
  { id:'first', e:'🌱', t:'צעד ראשון', d:'משימה ראשונה', ok: s => s.tasks >= 1 },
  { id:'ten', e:'🔟', t:'עשירייה', d:'10 משימות', ok: s => s.tasks >= 10 },
  { id:'fifty', e:'🏅', t:'חמישים', d:'50 משימות', ok: s => s.tasks >= 50 },
  { id:'hundred', e:'💯', t:'מאה!', d:'100 משימות', ok: s => s.tasks >= 100 },
  { id:'streak3', e:'🔥', t:'על הגל', d:'3 ימים ברצף', ok: s => s.best >= 3 },
  { id:'streak7', e:'⚡', t:'שבוע מושלם', d:'7 ימים ברצף', ok: s => s.best >= 7 },
  { id:'early', e:'🌅', t:'ציפור מוקדמת', d:'משימה לפני 8:00', ok: s => s.early },
  { id:'night', e:'🦉', t:'ינשוף לילה', d:'משימה אחרי 21:00', ok: s => s.night },
  { id:'count', e:'🧦', t:'שיא הספירה', d:'100 פריטים במשימות כמות', ok: s => s.units >= 100 },
  { id:'marathon', e:'⏱️', t:'מרתון', d:'30 דקות במשימת זמן אחת', ok: s => s.longest >= 30 },
  { id:'boss', e:'🐉', t:'קוטל בוסים', d:'ניצחון במשימת בוס', ok: s => s.boss >= 1 },
  { id:'champ', e:'👑', t:'אלוף השבוע', d:'מקום ראשון בשבוע', ok: s => s.wins >= 1 },
  { id:'saver', e:'🐷', t:'חסכן', d:'200 נקודות בארנק', ok: s => s.balance >= 200 },
  { id:'shop', e:'🛍️', t:'קנייה ראשונה', d:'החלפת נקודות ראשונה', ok: s => s.redeems >= 1 }];
const weekOf = day => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return dstr(d); };
const dayGap = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
// Race points per finished week: { '2026-10-18': { memberId: points } }
function weekTotals(){
  const cur = weekStart(); const by = {};
  for (const l of S.logs){ if (!inRace(l) || !counted(l) || !l.day) continue; const w = weekOf(l.day); if (w >= cur) continue;
    (by[w] ||= {})[l.memberId] = (by[w][l.memberId] || 0) + (Number(l.points) || 0); }
  return by;
}
function weeklyWins(){
  const wins = {};
  for (const w of Object.values(weekTotals())){ const max = Math.max(...Object.values(w)); if (max > 0) for (const [m, p] of Object.entries(w)) if (p === max) wins[m] = (wins[m] || 0) + 1; }
  return wins;
}
// Last week's winner(s), for the opening splash. Ties share the title.
function lastWeekWinners(){
  const d = new Date(weekStart() + 'T12:00:00'); d.setDate(d.getDate() - 7);
  const w = weekTotals()[dstr(d)]; if (!w) return null;
  const ids = Object.keys(w).filter(id => member(id)); const max = Math.max(0, ...ids.map(id => w[id]));
  return max > 0 ? { ids: ids.filter(id => w[id] === max), pts: max } : null;
}
function badgeStats(id){
  const L = S.logs.filter(l => l.memberId === id && counted(l)); const work = L.filter(l => l.kind === 'task' || l.kind === 'timed');
  const hr = l => new Date(l.at).getHours();
  let best = 0, run = 0, prev = null;
  for (const d of [...new Set(work.map(l => l.day))].sort()){ run = prev && dayGap(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const bossIds = new Set(S.tasks.filter(t => t.boss).map(t => t.id));
  return { tasks: work.length, best, early: work.some(l => hr(l) < 8), night: work.some(l => hr(l) >= 21),
    units: work.reduce((s, l) => s + (Number(l.count) || 0), 0), longest: Math.max(0, ...work.map(l => Number(l.minutes) || 0)),
    boss: work.filter(l => bossIds.has(l.taskId)).length, wins: weeklyWins()[id] || 0, balance: walletOf(id).balance, redeems: L.filter(l => l.kind === 'redeem').length };
}
const badgesOf = id => { const s = badgeStats(id); return BADGES.filter(b => b.ok(s)).map(b => b.id); };
function badgePanel(id){
  const got = new Set(badgesOf(id));
  return h('section', { class:'panel' }, h('div', { class:'section-head' }, h('h2', null, 'תגים'), h('span', { class:'count' }, `${got.size}/${BADGES.length}`)),
    h('div', { class:'badges' }, BADGES.map(b => h('div', { class:'badge' + (got.has(b.id) ? ' got' : ''), title:b.d },
      h('span', { class:'badge-e', 'aria-hidden':'true' }, got.has(b.id) ? b.e : '🔒'), h('span', { class:'badge-t' }, b.t), h('span', { class:'badge-d' }, b.d)))));
}
// A new badge for whoever owns this phone: a toast and confetti, once.
function checkNewBadges(){
  const id = S.boundId; if (!id || S.viewAs || !S.logsLoaded) return;
  const key = 'ft-badges-' + id; const now = badgesOf(id);
  let had = null; try{ had = JSON.parse(localStorage.getItem(key)); }catch(e){}
  try{ localStorage.setItem(key, JSON.stringify(now)); }catch(e){}
  if (!Array.isArray(had)) return; // first time on this phone: no fireworks for old badges
  const fresh = now.filter(b => !had.includes(b)); if (!fresh.length) return;
  const b = BADGES.find(x => x.id === fresh[0]); setTimeout(() => { toast(`${b.e} תג חדש: ${b.t}!`); confetti(140); }, 600);
}

/* ---------- boss task: one-time, first to do it gets triple points ---------- */
const ptsOf = t => (Number(t.points) || 0) * (t.boss ? 3 : 1);
function renderBoss(){
  const list = S.tasks.filter(t => t.boss && isDue(t));
  const B = $('bossSec'); B.hidden = !list.length; const L = $('bossList'); L.replaceChildren();
  list.forEach(t => L.append(taskCard(t, true)));
}

/* ---------- family challenge with a deadline ---------- */
// The challenge has its own task list (c.items), separate from the regular tasks. Each item is marked done once
// (challengeItems/<itemId>), by whoever did it. Who takes part: marked themselves (or marked by a parent), or did an item.
// cid: the challenge's id, kept when it is edited (older challenges: start|title)
const challengeKey = c => c.cid || `${c.start}|${c.title}`;
const chItems = c => Array.isArray(c?.items) ? c.items.filter(i => i && i.id && i.title) : [];
const itemDone = (c, it) => { const d = S.citems[it.id]; return d && d.key === challengeKey(c) ? d : null; };
const didInChallenge = (c, id) => chItems(c).some(it => itemDone(c, it)?.memberId === id);
const markedIn = (c, id) => S.cjoins[id]?.key === challengeKey(c);
const canMarkFor = id => S.isAdmin || id === S.boundId || (!!S.boundId && isParentMember(S.boundId));
async function toggleJoin(c, id){
  const on = markedIn(c, id);
  try{ await setDoc(doc(db,'challengeJoins',id), { key: on ? '' : challengeKey(c), memberId:id, at:Date.now(), ...(S.isAdmin || id === S.boundId ? {} : { by:S.boundId }) });
    toast(on ? `${mName(id)} הוסר/ה מהאתגר` : `${mName(id)} משתתף/ת באתגר 💪`); }catch(e){ fail(e); }
}
// Who did it: the child a parent picked at the top ("מסמן עבור"), else this phone's member, else (admin) the member chosen at the top.
function challengeDoer(){ const a = actingChild(); if (a) return a; if (S.boundId) return S.boundId; return S.me !== 'all' && member(S.me) ? S.me : null; }
async function markItem(c, it){
  const who = challengeDoer(); if (!who){ toast('בחרו למעלה מי עשה'); return; }
  const by = S.isAdmin || who === S.boundId ? {} : { by: S.boundId };
  try{ await setDoc(doc(db,'challengeItems',it.id), { key: challengeKey(c), itemId: it.id, memberId: who, ...by, at: Date.now() }); toast(`${mName(who)}: ${it.title} ✓`); confetti(50); }catch(e){ fail(e); }
}
async function unmarkItem(it){ try{ await deleteDoc(doc(db,'challengeItems',it.id)); toast('הסימון בוטל'); }catch(e){ fail(e); } }
const canUnmark = d => S.isAdmin || d.memberId === S.boundId || isParentNow();
function challengeCount(c){ return chItems(c).filter(it => itemDone(c, it)).length; }
function renderChallenge(){
  const canEd = canEditGoal(); if (!canEd) S.chEdit = null;
  $('chEditor').hidden = !S.chEdit; $('chNewWrap').hidden = !canEd || !!S.chEdit;
  $('chEndWrap').replaceChildren(S.chEdit === 'edit' ? armedBtn('chEnd', 'סיום האתגר', endChallenge) : '');
  const c = S.challenge; const td = today(); const items = chItems(c);
  const on = !!c && items.length > 0 && c.until && dayGap(c.until, td) <= 2;
  document.querySelectorAll('[data-challenge]').forEach(el => {
    el.hidden = !on; el.replaceChildren(); if (!on) return;
    const total = items.length; const n = challengeCount(c); const pct = Math.round(n / total * 100); const done = n >= total; const left = dayGap(td, c.until); const over = left < 0;
    el.classList.toggle('reached', done);
    el.append(h('div', { class:'goal-head' }, h('span', { class:'goal-e', 'aria-hidden':'true' }, done ? '🎉' : over ? '⌛' : '⚡'),
        h('div', { class:'goal-t' }, h('strong', null, done ? `ניצחתם באתגר! ${c.prize || ''}`.trim() : `אתגר: ${c.title}`),
          h('span', { class:'sub' }, done ? (c.bonus ? `כל הכבוד! כל משתתף מקבל ${c.bonus} נקודות בונוס 🎁` : 'כל הכבוד לכולם!') : over ? `האתגר נגמר. סיימתם ${n} מתוך ${total}.` :
            `עוד ${total - n} משימות · ${left === 0 ? 'היום היום האחרון!' : left === 1 ? 'נשאר יום אחד' : `נשארו ${left} ימים`}${c.prize ? ` · פרס: ${c.prize}` : ''}${c.bonus ? ` · ${c.bonus} נקודות לכל משתתף` : ''}`)),
        h('span', { class:'progress-pct' }, `${pct}%`)),
      h('div', { class:'progress-bar' }, h('span', { style:`width:${pct}%` })),
      // the challenge's own tasks, folded: the button says how many are left; tap to open, then tap a task to mark it done
      h('button', { type:'button', class:'ch-toggle', 'aria-expanded':String(S.chOpen), onclick:() => { S.chOpen = !S.chOpen; render(); } },
        h('span', null, S.chOpen ? 'משימות האתגר' : done ? 'כל משימות האתגר בוצעו ✓' : total - n === 1 ? 'נשארה משימה אחת באתגר' : `נשארו ${total - n} משימות באתגר`),
        h('span', { class:'ch-caret', 'aria-hidden':'true' }, S.chOpen ? '▲' : '▼')),
      !S.chOpen ? '' : h('div', { class:'ch-items' }, items.map(it => { const d = itemDone(c, it);
        return h('div', { class:'ch-item' + (d ? ' ch-ok' : '') },
          d ? h('span', { class:'ch-check', 'aria-hidden':'true' }, '✓')
            : h('button', { type:'button', class:'donecheck ch-do', disabled: over, 'aria-label':`סיימתי: ${it.title}`, onclick:() => markItem(c, it) }),
          h('span', { class:'ch-t' }, it.title),
          d ? h('span', { class:'ch-who' }, h('span', { class:'dot', style:`background:${mColor(d.memberId)}` }), mName(d.memberId)) : null,
          d && !over && canUnmark(d) ? h('button', { type:'button', class:'linkbtn', onclick:() => unmarkItem(it) }, 'ביטול') : null); })),
      h('p', { class:'sub' }, `${n} מתוך ${total} משימות האתגר`),
      h('div', { class:'cj' }, h('span', { class:'cj-l' }, c.bonus ? 'משתתפים (רק הם מקבלים את הבונוס):' : 'משתתפים:'),
        S.members.map(m => { const auto = didInChallenge(c, m.id); const on = auto || markedIn(c, m.id); const can = !auto && !done && !over && canMarkFor(m.id);
          return h('button', { type:'button', class:'chip cj-chip' + (on ? ' on' : ''), disabled: !can, 'aria-pressed':String(on),
            title: auto ? 'סימן/ה משימה באתגר' : '', onclick: () => toggleJoin(c, m.id) },
            h('span', { class:'dot', style:`background:${m.color}` }), m.name, on ? ' ✓' : ''); })),
      (!done && !over && S.boundId && !didInChallenge(c, S.boundId) && !markedIn(c, S.boundId))
        ? h('button', { type:'button', class:'btn small', onclick: () => toggleJoin(c, S.boundId) }, 'אני משתתף/ת! 🙋') : '',
      (!done && !over && challengeNudgeState().allowed) ? (() => { const st = challengeNudgeState();
        return h('button', { type:'button', class:'btn ghost small', disabled: st.wait > 0, onclick: nudgeChallenge }, st.wait > 0 ? `📣 אפשר להקפיץ שוב בעוד ${Math.ceil(st.wait / 60000)} דק׳` : '📣 הקפצת האתגר לכל המשפחה'); })() : '',
      canEditGoal() ? h('button', { type:'button', class:'linkbtn ch-edit', onclick: () => openChallengeEdit('edit') }, '✏️ עריכת האתגר') : '');
  });
}
const itemsText = c => chItems(c).map(i => i.title).join('\n');
// mode 'edit': the current challenge, filled in; 'new': an empty form (saving replaces the current challenge)
function openChallengeEdit(mode){
  const c = mode === 'edit' && chItems(S.challenge).length ? S.challenge : null;
  S.chEdit = c ? 'edit' : 'new';
  $('ch-title').value = c?.title || ''; $('ch-items').value = c ? itemsText(c) : ''; $('ch-until').value = c?.until || '';
  $('ch-prize').value = c?.prize || ''; $('ch-bonus').value = c?.bonus || '';
  $('chHead').textContent = c ? '✏️ עריכת האתגר' : '⚡ אתגר משפחתי חדש';
  $('chIntro').textContent = c ? 'משימות שלא שינית שומרות את הסימון שלהן. משימה שמחקת נמחקת עם הסימון שלה.'
    : chItems(S.challenge).length ? 'שמירה של אתגר חדש מחליפה את האתגר הנוכחי.' : 'כל המשפחה ביחד, מול השעון: רשימת משימות של האתגר עצמו, נפרדת מהמשימות הרגילות, עד תאריך מסוים.';
  S.tab = 'family'; render();
  setTimeout(() => { $('chEditor').scrollIntoView({ behavior:'smooth', block:'start' }); $('ch-title').focus({ preventScroll:true }); }, 0);
}
function closeChallengeEdit(){ S.chEdit = null; render(); }
async function endChallenge(){
  const c = S.challenge;
  try{ await setDoc(doc(db,'settings','challenge'), { title: c?.title || '', target: 0, items: [], start: c?.start || today(), until: c?.until || today(), prize: '', bonus: 0, ...(S.isAdmin ? {} : { by: S.boundId }) });
    S.chEdit = null; toast('האתגר הסתיים'); render(); }catch(e){ fail(e); }
}
async function saveChallenge(){
  const title = $('ch-title').value.trim(); const bonus = Math.round(Number($('ch-bonus').value)) || 0; const until = $('ch-until').value; const prize = $('ch-prize').value.trim();
  const lines = [...new Set($('ch-items').value.split('\n').map(x => x.trim().slice(0, 60)).filter(Boolean))];
  if (!canEditGoal()){ toast('רק הורה או מנהל'); return; }
  if (lines.length > 30){ toast('עד 30 משימות באתגר'); return; }
  if (!lines.length){ toast(S.chEdit === 'edit' ? 'כתבו לפחות משימה אחת. כדי לסיים את האתגר יש כפתור "סיום האתגר".' : 'כתבו לפחות משימה אחת'); $('ch-items').focus(); return; }
  if (!title){ toast('כתבו שם לאתגר'); return; }
  if (!(bonus >= 0 && bonus <= 1000)){ toast('בונוס: בין 0 ל-1000 נקודות'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || (until < today() && !(S.chEdit === 'edit' && until === S.challenge?.until))){ toast('בחרו תאריך סיום מהיום והלאה'); return; }
  const old = S.challenge; const same = S.chEdit === 'edit' && old && chItems(old).length > 0;
  // an edited list keeps the ids (and the done marks) of tasks whose text didn't change
  const prev = same ? chItems(old) : [];
  const items = lines.map(t => prev.find(i => i.title === t) || { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4), title: t });
  // editing keeps the id (marks and joins stay); a new challenge gets a fresh one
  const cid = same ? challengeKey(old) : `${today()}|${Math.random().toString(36).slice(2, 10)}`;
  const data = { title, target: items.length, items, cid, start: same ? old.start : today(), until, prize, bonus: Math.max(0, bonus), ...(S.isAdmin ? {} : { by: S.boundId }) };
  try{ await setDoc(doc(db,'settings','challenge'), data); toast(same ? 'השינויים נשמרו' : 'האתגר נשמר. בהצלחה!'); S.chEdit = null; render(); }catch(e){ fail(e); }
}

/* ---------- loans: ask for a reward before having enough points; a parent approves ---------- */
async function requestLoan(memberId, r){
  try{ await addDoc(collection(db,'logs'), { kind:'redeem', title:r.title, memberId, points:r.cost, rewardId:r.id, approved:false, loan:true, day:today(), at:Date.now() });
    toast('הבקשה נשלחה להורים. אחרי אישור, הנקודות יירדו והיתרה תהיה במינוס עד שתחזיר/י אותן.'); }catch(e){ fail(e); }
}

/* ---------- photo proof (free: a small JPEG kept inside the database until the task is reviewed) ---------- */
function shrinkImage(file){
  return new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); let w = img.naturalWidth, hgt = img.naturalHeight; const m = 720; if (Math.max(w, hgt) > m){ const k = m / Math.max(w, hgt); w = Math.round(w * k); hgt = Math.round(hgt * k); }
      const c = document.createElement('canvas'); c.width = w; c.height = hgt; c.getContext('2d').drawImage(img, 0, 0, w, hgt);
      let q = .7, d = c.toDataURL('image/jpeg', q); while (d.length > 450000 && q > .3){ q -= .1; d = c.toDataURL('image/jpeg', q); } res(d); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); }; img.src = url; });
}
function attachPhoto(l){
  const inp = h('input', { type:'file', accept:'image/*', capture:'environment', style:'display:none' }); document.body.append(inp);
  inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
    try{ toast('מעלה תמונה…'); const data = await shrinkImage(f); await setDoc(doc(db,'photos',l.id), { data, memberId:l.memberId, at:Date.now() }); toast('התמונה נשלחה לאישור'); }
    catch(e){ if (e && e.message === 'image') toast('לא הצלחנו לקרוא את התמונה'); else fail(e); } });
  inp.click();
}
function photoThumb(l){
  const p = S.photos[l.id]; if (!p) return null;
  return h('button', { type:'button', class:'thumb', 'aria-label':'הצגת התמונה', onclick:() => showPhoto(p.data) }, h('img', { src:p.data, alt:'' }));
}
function showPhoto(src){
  const o = h('div', { class:'lightbox', role:'dialog', 'aria-label':'תמונה', onclick:() => o.remove() }, h('img', { src, alt:'הוכחה' }));
  document.body.append(o); syncHistory();
}
const dropPhoto = id => { if (S.photos[id]) _deleteDoc(doc(db,'photos',id)).catch(() => {}); };


/* ---------- complaints ---------- */
const CP_CATS = [['fun','😂','בשביל הצחוק'],['app','📱','על האפליקציה/משימות'],['house','🏠','משהו בבית'],['person','👤','על מישהו'],['other','💬','אחר']];
let cpCat = 'fun';
const canHandle = () => S.isAdmin || (!!S.boundId && isParentMember(S.boundId));
// The admin may not have a family member of his own; then complaints are signed by the admin's member if one exists.
const myMemberId = () => S.boundId || (S.isAdmin ? (S.members.find(m => roleOf(m.id) === 'admin')?.id || null) : null);
function openComplaints(){ S.cpOpen = true; render(); }
function closeComplaints(){ S.cpOpen = false; render(); }
function initComplaints(){
  const C = $('cpCats');
  CP_CATS.forEach(([id, e, t]) => C.append(h('button', { type:'button', class:'chip', 'data-cat':id, onclick:() => { cpCat = id; syncCpForm(); } }, `${e} ${t}`)));
  syncCpForm();
}
function syncCpForm(){
  $('cpCats').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === cpCat)));
  $('cpAboutWrap').hidden = cpCat !== 'person';
}
function fillCpAbout(){
  const sel = $('cpAbout'); const keep = sel.value; const me = myMemberId();
  sel.replaceChildren(...S.members.filter(m => m.id !== me).map(m => h('option', { value:m.id }, m.name)));
  if (keep) sel.value = keep;
}
async function sendComplaint(){
  const text = $('cpText').value.trim(); const by = myMemberId();
  if (!by){ toast('קודם נכנסים עם הקוד שלך'); return; }
  if (!text){ toast('כתבו מה קרה'); $('cpText').focus(); return; }
  const about = cpCat === 'person' ? $('cpAbout').value : '';
  if (cpCat === 'person' && !about){ toast('בחרו על מי'); return; }
  const btn = $('cpSend'); btn.disabled = true;
  try{ await addDoc(collection(db,'complaints'), { text, cat:cpCat, by, about, status:'open', agree:[], at:Date.now() });
    $('cpText').value = ''; toast('התלונה נשלחה. המלך ישקול אותה בכובד ראש 👑'); }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
async function handleComplaint(c, status, box){
  const reply = box.querySelector('.cp-reply').value.trim();
  const target = box.querySelector('.cp-target').value; const pts = Math.round(Number(box.querySelector('.cp-pts').value)) || 0;
  if (pts && (Math.abs(pts) > 100)){ toast('נקודות: עד 100 לכל כיוון'); return; }
  const by = S.isAdmin ? {} : { handledBy: S.boundId };
  try{
    if (pts && target){
      await addDoc(collection(db,'logs'), { kind:'bonus', title: pts > 0 ? `פיצוי על תלונה: ${c.text.slice(0, 30)}` : `קנס על תלונה: ${c.text.slice(0, 30)}`,
        memberId:target, points:pts, complaintId:c.id, ...(S.isAdmin ? {} : { by:S.boundId }), day:today(), at:Date.now() });
    }
    await updateDoc(doc(db,'complaints',c.id), { status, reply, ...(pts && target ? { pts, target } : {}), handledAt:Date.now(), ...by });
    toast(status === 'done' ? 'סומן כטופל' : 'התלונה נדחתה');
  }catch(e){ fail(e); }
}
async function sendCpComment(c){
  const me = myMemberId(); const text = (S.cpCm[c.id] || '').trim();
  if (!me){ toast('קודם נכנסים עם הקוד שלך'); return; }
  if (!text) return;
  try{ await addDoc(collection(db,'cpComments'), { cpId:c.id, memberId:me, text, at:Date.now() }); S.cpCm[c.id] = ''; render(); }catch(e){ fail(e); }
}
function cpThread(c){
  const me = myMemberId();
  const list = S.cpComments.filter(x => x.cpId === c.id).sort((a,b) => a.at - b.at);
  const inp = h('input', { type:'text', class:'cpc-in', 'data-cp':c.id, maxlength:'300', placeholder:'תגובה…', 'aria-label':'תגובה', value: S.cpCm[c.id] || '' });
  inp.addEventListener('input', () => { S.cpCm[c.id] = inp.value; });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendCpComment(c); });
  return h('div', { class:'cpc' },
    list.map(x => h('div', { class:'cpc-row' + (x.memberId === me ? ' mine' : '') },
      h('span', { class:'cpc-ava', style:`background:${mColor(x.memberId)}` }, avatarOf(x.memberId)),
      h('div', { class:'cpc-b' }, h('strong', null, mName(x.memberId)), h('span', null, x.text)),
      (S.isAdmin || x.memberId === me) ? h('button', { type:'button', class:'cpc-x', 'aria-label':'מחיקת תגובה', onclick: async () => { try{ await deleteDoc(doc(db,'cpComments',x.id)); }catch(e){ fail(e); } } }, '×') : null)),
    me ? h('div', { class:'cpc-send' }, inp, h('button', { type:'button', class:'btn small', onclick:() => sendCpComment(c) }, 'שליחה')) : null);
}
async function agreeComplaint(c){
  const me = myMemberId(); if (!me){ toast('קודם נכנסים עם הקוד שלך'); return; }
  const has = (c.agree || []).includes(me);
  try{ await updateDoc(doc(db,'complaints',c.id), { agree: has ? arrayRemove(me) : arrayUnion(me) }); }catch(e){ fail(e); }
}
function renderComplaints(){
  const open = (S.complaints || []).filter(c => c.status === 'open').length;
  $('cpFab').hidden = !S.user || S.tab !== 'today' || !(S.boundId || S.isAdmin) || !!S.cpOpen || !!S.dnOpen;
  $('cpFabN').hidden = !open; $('cpFabN').textContent = String(open);
  const sheet = $('cpSheet');
  if (!S.cpOpen){ sheet.hidden = true; if (!S.chatOpen && !S.profileOpen && !S.dnOpen && !S.kitchenOpen) document.body.classList.remove('locked'); return; }
  sheet.hidden = false; document.body.classList.add('locked');
  fillCpAbout();
  const all = $('cpf-all').checked;
  const list = (S.complaints || []).filter(c => all || c.status === 'open').sort((a,b) => b.at - a.at);
  const ae = document.activeElement; const focusCp = ae && ae.classList && ae.classList.contains('cpc-in') ? ae.dataset.cp : null; const caret = focusCp ? ae.selectionStart : 0;
  const L = $('cpList'); L.replaceChildren();
  if (!list.length) L.append(h('div', { class:'empty' }, h('strong', null, all ? 'אין תלונות בכלל' : 'אין תלונות פתוחות'), 'שקט בממלכה. לבינתיים.'));
  const me = myMemberId();
  list.forEach(c => {
    const cat = CP_CATS.find(x => x[0] === c.cat) || CP_CATS[4]; const d = new Date(c.at);
    const n = (c.agree || []).length; const mine = (c.agree || []).includes(me);
    const card = h('div', { class:'cp cp-' + c.status },
      h('div', { class:'cp-head' },
        h('span', { class:'cp-ava', style:`background:${mColor(c.by)}` }, avatarOf(c.by)),
        h('div', { class:'cp-who' }, h('strong', null, mName(c.by) + (c.about ? ` ← על ${mName(c.about)}` : '')),
          h('small', null, `${cat[1]} ${cat[2]} · ${d.getDate()}.${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)),
        h('span', { class:'cp-status' }, c.status === 'open' ? 'פתוחה' : c.status === 'done' ? '✓ טופל' : '✗ נדחה')),
      h('p', { class:'cp-text' }, c.text),
      c.reply || c.pts ? h('div', { class:'cp-ans' }, '👑 ', c.reply || '', c.pts ? h('strong', null, ` ${c.pts > 0 ? '+' : ''}${c.pts} נקודות ל${mName(c.target)}`) : null) : null,
      h('div', { class:'cp-actions' },
        h('button', { type:'button', class:'chip' + (mine ? ' on' : ''), 'aria-pressed':String(mine), onclick:() => agreeComplaint(c) }, `👍 מסכים${n ? ` · ${n}` : ''}`),
        (S.isAdmin || (c.by === me && c.status === 'open')) ? armedBtn('cpd' + c.id, 'מחיקה', async () => { try{ await deleteDoc(doc(db,'complaints',c.id)); toast('נמחק'); }catch(e){ fail(e); } }) : null));
    if (c.status === 'open' && canHandle() && c.by !== S.boundId){
      const box = h('div', { class:'cp-handle' },
        h('input', { type:'text', class:'cp-reply', maxlength:'200', placeholder:'תשובה (לא חובה)', 'aria-label':'תשובה' }),
        h('div', { class:'cp-pts-row' },
          h('select', { class:'cp-target', 'aria-label':'למי נקודות' }, h('option', { value:'' }, 'בלי נקודות'),
            S.members.filter(m => m.id !== S.boundId).map(m => h('option', { value:m.id, selected: m.id === (c.about || '') }, m.name))),
          signed(h('input', { type:'number', class:'cp-pts', inputmode:'numeric', placeholder:'+10 / -10', 'aria-label':'כמה נקודות' }))),
        h('div', { class:'cp-pts-row' },
          h('button', { type:'button', class:'btn small', onclick:() => handleComplaint(c, 'done', box) }, '✓ טופל'),
          h('button', { type:'button', class:'btn ghost small', onclick:() => handleComplaint(c, 'rejected', box) }, '✗ נדחה')));
      // keep what the handler typed across re-renders
      const keep = S.cpDraft[c.id]; if (keep){ box.querySelector('.cp-reply').value = keep.r; box.querySelector('.cp-target').value = keep.t; box.querySelector('.cp-pts').value = keep.p; }
      box.addEventListener('input', () => { S.cpDraft[c.id] = { r: box.querySelector('.cp-reply').value, t: box.querySelector('.cp-target').value, p: box.querySelector('.cp-pts').value }; });
      card.append(box);
    }
    card.append(cpThread(c));
    L.append(card);
  });
  if (focusCp){ const el = L.querySelector(`.cpc-in[data-cp="${focusCp}"]`); if (el){ el.focus({ preventScroll:true }); try{ el.setSelectionRange(caret, caret); }catch(e){} } }
}


/* ---------- phone "back" button: closes what's open inside the app instead of leaving it ---------- */
// Order matters: the top-most thing closes first. Returns true if something was closed.
function closeTop(){
  const lb = document.querySelector('.lightbox'); if (lb){ lb.remove(); return true; }
  if (S.fabMenu){ S.fabMenu = false; return true; }
  if (S.openPanels.size){ S.openPanels.delete([...S.openPanels].pop()); return true; }
  if (S.ppOpen){ S.ppOpen = false; return true; }
  if (S.rankOpen){ S.rankOpen = false; return true; }
  if (S.qtyAsk){ S.qtyAsk = null; return true; }
  if (S.openPick){ S.openPick = null; return true; }
  if (S.chatOpen){ if (typeof markSeen_chat === 'function') markSeen_chat(S.chatOpen); S.chatOpen = null; S.chatDraft = ''; return true; }
  if (S.profileOpen){ S.profileOpen = null; return true; }
  if (S.kitchenOpen){ S.kitchenOpen = false; return true; }
  if (S.dnOpen){ S.dnOpen = false; const seen = [...S.dnSeen]; S.dnSeen.clear(); if (seen.length) clearSeenNotes(seen); return true; }
  if (S.cpOpen){ S.cpOpen = false; return true; }
  if (S.viewAs){ S.viewAs = null; S.tab = 'admin'; return true; }
  if (S.tab !== 'today'){ S.tab = 'today'; window.scrollTo(0, 0); return true; }
  return false;
}
const somethingOpen = () => !!(document.querySelector('.lightbox') || S.fabMenu || S.openPanels.size || S.ppOpen || S.rankOpen || S.qtyAsk || S.openPick || S.chatOpen || S.profileOpen || S.dnOpen || S.kitchenOpen || S.cpOpen || S.viewAs || (S.tab && S.tab !== 'today'));
// Keep exactly one extra history entry while anything can be closed; at home with nothing open, "back" leaves the app as usual.
function syncHistory(){
  try{ const trapped = history.state && history.state.ftBack;
    if (somethingOpen() && !trapped) history.pushState({ ftBack:1 }, '');
    else if (!somethingOpen() && trapped) history.back(); // closed with an in-app button: drop the spare entry
  }catch(e){}
}
window.addEventListener('popstate', () => { if (closeTop()) render(); syncHistory(); });

/* ---------- forms that open from a button (like "+ הוספת משימה"), outside the admin tab ---------- */
const COLLAPSIBLES = [['goalEditor','+ יעד חודשי'], ['exEditor','+ הוספת החלפה'], ['rw-use','+ השתמשתי בנקודות'], ['cpForm','+ תלונה חדשה']];
function setupCollapsibles(){
  for (const [id, label] of COLLAPSIBLES){
    const panel = $(id); if (!panel) continue;
    panel.classList.add('collapsible');
    const wrap = h('div', { class:'cl-wrap', id:'clw-' + id }, h('button', { type:'button', class:'btn ghost', onclick:() => { S.openPanels.add(id); syncCollapsibles(); panel.querySelector('input, textarea, select')?.focus(); } }, label));
    panel.before(wrap);
    panel.prepend(h('button', { type:'button', class:'cl-close', 'aria-label':'סגירה', onclick:() => { S.openPanels.delete(id); syncCollapsibles(); syncHistory(); } }, '✕'));
  }
}
function syncCollapsibles(){
  for (const [id] of COLLAPSIBLES){
    const panel = $(id), wrap = $('clw-' + id); if (!panel || !wrap) continue;
    const open = S.openPanels.has(id);
    panel.classList.toggle('open', open);
    wrap.hidden = panel.hidden || open;
  }
}

/* ---------- admin tab as an accordion: tap a heading to open that section ---------- */
let accOpen = new Set(); try{ accOpen = new Set(JSON.parse(localStorage.getItem('ft-acc') || '[]')); }catch(e){}
const saveAcc = () => { try{ localStorage.setItem('ft-acc', JSON.stringify([...accOpen])); }catch(e){} };
function setupAdminAccordion(){
  [...$('view-admin').querySelectorAll(':scope > section.panel')].forEach((sec, i) => {
    const head = sec.querySelector(':scope > .section-head') || sec.querySelector(':scope > h2'); if (!head) return;
    const key = sec.id || 'acc' + i; sec.dataset.acc = key; sec.classList.add('acc');
    const btn = h('button', { type:'button', class:'acc-head', 'aria-expanded':'false' }); head.before(btn); btn.append(head, h('span', { class:'acc-caret', 'aria-hidden':'true' }, '⌄'));
    const body = h('div', { class:'acc-body' }); while (btn.nextSibling) body.append(btn.nextSibling); sec.append(body);
    btn.addEventListener('click', () => { accOpen.has(key) ? accOpen.delete(key) : accOpen.add(key); saveAcc(); syncAccordion(); });
  });
  syncAccordion();
}
function syncAccordion(){
  $('view-admin').querySelectorAll('section.acc').forEach(sec => { const open = accOpen.has(sec.dataset.acc) || sec.id === 'joinsPanel';
    sec.classList.toggle('open', open); sec.querySelector('.acc-head')?.setAttribute('aria-expanded', String(open)); });
}
// open the section that holds this element (e.g. when editing a task or a family member)
function openAccFor(el){ const sec = el && el.closest('section.acc'); if (sec && !accOpen.has(sec.dataset.acc)){ accOpen.add(sec.dataset.acc); saveAcc(); syncAccordion(); } }

/* ---------- duplicate a task (a copy you can then edit) ---------- */
async function duplicateTask(t){
  const keys = ['assignee','type','days','timed','points','ratePerMin','maxMinutes','qtyPer','qtyUnit','qtyMax','check','rotation','untilTime'];
  const data = { title: t.title };
  for (const k of keys) if (t[k] !== undefined && t[k] !== null) data[k] = t[k];
  data.timed = !!t.timed; data.type = t.type === 'once' ? 'once' : 'repeat'; data.days = Array.isArray(t.days) ? t.days : []; data.assignee = t.assignee || 'all';
  if (data.assignee !== 'rotate') delete data.rotation;
  if (S.isAdmin){ if (t.boss) data.boss = true; }
  else { if (!S.boundId){ toast('קודם נכנסים עם הקוד שלך'); return; } data.reviewed = false; data.suggestedBy = S.boundId; }
  data.createdAt = Date.now();
  try{ const ref = await addDoc(collection(db,'tasks'), data); toast('המשימה שוכפלה. עכשיו אפשר לערוך את העותק.');
    const copy = { id: ref.id, ...data }; openTaskEdit(copy); }catch(e){ fail(e); }
}

/* ---------- notes to the developer (only the admin reads them) ---------- */
const DN_KINDS = [['bug','🐞','באג'],['idea','💡','רעיון'],['ux','😕','לא נוח'],['other','💬','אחר']];
let dnKind = 'idea';
function initDevNotes(){
  DN_KINDS.forEach(([id, e, t]) => $('dnKinds').append(h('button', { type:'button', class:'chip', 'data-k':id, onclick:() => { dnKind = id; syncDn(); } }, `${e} ${t}`)));
  syncDn();
}
function syncDn(){ $('dnKinds').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === dnKind))); }
async function sendDevNote(){
  const text = $('dnText').value.trim(); const by = myMemberId();
  if (!by){ toast('קודם נכנסים עם הקוד שלך'); return; }
  if (!text){ toast('כתבו את ההערה'); $('dnText').focus(); return; }
  const btn = $('dnSend'); btn.disabled = true;
  try{ await addDoc(collection(db,'devNotes'), { text, kind:dnKind, by, status:'new', at:Date.now() }); $('dnText').value = ''; toast('נשלח למנהל. תודה! 🛠️'); }
  catch(e){ fail(e); } finally{ btn.disabled = false; }
}
// The writer of a note sees its status; once it's handled and they've seen it, it deletes itself.
let myNotesUnsub = null;
function watchMyNotes(){
  const id = (!S.isAdmin && S.boundId && !S.viewAs) ? S.boundId : null;
  if (id === S.myNotesFor) return;
  if (myNotesUnsub){ myNotesUnsub(); myNotesUnsub = null; } S.myNotes = []; S.myNotesFor = id;
  if (!id || !db) return;
  myNotesUnsub = onSnapshot(query(collection(db,'devNotes'), where('by', '==', id)), s => { S.myNotes = s.docs.map(d => ({ id:d.id, ...d.data() })); render(); }, e => console.error(e));
}
async function clearSeenNotes(ids){
  for (const id of ids){ try{ await _deleteDoc(doc(db,'devNotes',id)); }catch(e){ console.error(e); } }
}
function renderMyNotes(){
  const done = S.myNotes.filter(n => n.status === 'done');
  const bar = $('dnDoneBar'); bar.hidden = !done.length || S.dnOpen;
  if (done.length){ bar.replaceChildren(h('span', null, `✓ ${done.length === 1 ? 'ההערה שלך למפתח טופלה' : `${done.length} הערות שלך למפתח טופלו`}: ${done.map(n => n.text.slice(0, 40)).join(' · ')}`),
    h('button', { type:'button', class:'btn small', onclick:() => clearSeenNotes(done.map(n => n.id)) }, 'ראיתי')); }
  const sec = $('dnMine'); sec.hidden = S.isAdmin || !S.myNotes.length;
  const L = $('dnMineList'); L.replaceChildren();
  const rank = { done:0, doing:1, new:2 };
  S.myNotes.slice().sort((a,b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.at - a.at).forEach(n => {
    if (S.dnOpen && n.status === 'done') S.dnSeen.add(n.id);
    L.append(h('div', { class:'cp' + (n.status === 'done' ? ' cp-done' : n.status === 'doing' ? ' cp-doing' : '') },
      h('div', { class:'cp-head' }, h('div', { class:'cp-who' }, h('strong', null, n.text)), h('span', { class:'cp-status' }, n.status === 'done' ? '✓ טופל' : n.status === 'doing' ? '🔧 בטיפול' : 'נשלח'))));
  });
}
function renderDevNotes(){
  watchMyNotes(); renderMyNotes();
  const fresh = S.realAdmin ? S.devNotes.filter(n => n.status === 'new').length : 0;
  $('dnFab').hidden = true; // one button opens both (see fabMenu)
  $('fabMenu').hidden = !S.fabMenu || $('cpFab').hidden;
  { const n = (S.complaints || []).filter(c => c.status === 'open').length + fresh; $('cpFabN').hidden = !n; $('cpFabN').textContent = String(n); }
  $('dnFabN').hidden = !fresh; $('dnFabN').textContent = String(fresh);
  const sheet = $('dnSheet');
  if (!S.dnOpen){ sheet.hidden = true; return; }
  sheet.hidden = false; document.body.classList.add('locked');
  $('dnInbox').hidden = !S.isAdmin;
  if (!S.isAdmin) return;
  const rank = { new:0, doing:1, done:2 }; const list = S.devNotes.slice().sort((a,b) => (rank[a.status] ?? 0) - (rank[b.status] ?? 0) || b.at - a.at);
  $('dnCount').textContent = list.length ? String(list.length) : '';
  const L = $('dnList'); L.replaceChildren();
  if (!list.length) L.append(h('div', { class:'empty' }, h('strong', null, 'אין הערות'), 'כשמישהו ישלח הערה, היא תופיע כאן ותקבל התראה.'));
  list.forEach(n => { const k = DN_KINDS.find(x => x[0] === n.kind) || DN_KINDS[3]; const d = new Date(n.at);
    L.append(h('div', { class:'cp' + (n.status === 'done' ? ' cp-done' : n.status === 'doing' ? ' cp-doing' : '') },
      h('div', { class:'cp-head' }, h('span', { class:'cp-ava', style:`background:${mColor(n.by)}` }, avatarOf(n.by)),
        h('div', { class:'cp-who' }, h('strong', null, mName(n.by)), h('small', null, `${k[1]} ${k[2]} · ${d.getDate()}.${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)),
        h('span', { class:'cp-status' }, n.status === 'new' ? 'חדש' : n.status === 'doing' ? '🔧 בטיפול' : '✓ טופל')),
      h('p', { class:'cp-text' }, n.text),
      h('div', { class:'cp-actions' },
        h('div', { class:'cp-pts-row' }, [['new','חדש'],['doing','🔧 בטיפול'],['done','✓ טופל']].filter(([v]) => v !== n.status).map(([v, label]) =>
          h('button', { type:'button', class:'btn small' + (v === 'new' ? ' ghost' : ''), onclick: async () => { try{ await updateDoc(doc(db,'devNotes',n.id), { status:v, statusAt:Date.now() }); }catch(e){ fail(e); } } }, label))),
        armedBtn('dn' + n.id, 'מחיקה', async () => { try{ await deleteDoc(doc(db,'devNotes',n.id)); }catch(e){ fail(e); } })))); });
}


/* ---------- nudges (push reminders). The server sends them within ~5 minutes. ---------- */
const nudgeEveryMin = () => Math.max(1, Number(S.perms?.nudgeEveryMin) || 60);
// kitchen: one dish per pair per this many minutes (settings/perms.dishEveryMin; the rules read the same number)
const dishEveryMin = () => { const v = Math.round(Number(S.perms?.dishEveryMin)); return v >= 1 && v <= 1440 ? v : 10; };
const dishMs = () => dishEveryMin() * 60000;
const hasPush = id => (S.tokens || []).some(t => t.memberId === id);
async function sendNudge(data){ await addDoc(collection(db,'nudges'), { ...data, at:Date.now() }); }
function renderNudgeAdmin(){
  if (!S.isAdmin || !$('nudgeWho')) return;
  const W = $('nudgeWho'); W.replaceChildren();
  S.members.forEach(m => W.append(h('button', { type:'button', class:'chip', 'aria-pressed':String(S.nudgePick.has(m.id)),
    onclick:() => { S.nudgePick.has(m.id) ? S.nudgePick.delete(m.id) : S.nudgePick.add(m.id); render(); } },
    h('span', { class:'dot', style:`background:${m.color}` }), m.name, hasPush(m.id) ? ' 🔔' : ' 🔕')));
  const R = $('nudgeRights'); R.replaceChildren();
  S.members.filter(m => roleOf(m.id) !== 'admin').forEach(m => R.append(h('div', { class:'arow' },
    h('div', { class:'t' }, h('strong', null, m.name)),
    h('label', { class:'check' }, h('input', { type:'checkbox', checked: m.canNudge === true, onchange: e => updateDoc(doc(db,'members',m.id), { canNudge: e.target.checked }).catch(fail) }), ' יכול להקפיץ'),
    h('label', { class:'check' }, h('input', { type:'checkbox', checked: m.nudgeLimited !== false, disabled: m.canNudge !== true, onchange: e => updateDoc(doc(db,'members',m.id), { nudgeLimited: e.target.checked }).catch(fail) }), ' עם הגבלה'),
    // own interval for this person (empty = the general one)
    (m.canNudge === true && m.nudgeLimited !== false) ? h('label', { class:'nudge-min' }, 'כל ',
      h('input', { type:'number', min:'1', max:'1440', inputmode:'numeric', value: m.nudgeEveryMin ? String(m.nudgeEveryMin) : '', placeholder: String(nudgeEveryMin()),
        onchange: e => { const v = Math.round(Number(e.target.value)); updateDoc(doc(db,'members',m.id), { nudgeEveryMin: v >= 1 && v <= 1440 ? v : deleteField() }).then(() => toast(v >= 1 ? `${m.name}: פעם ב-${v} דקות` : `${m.name}: לפי ההגדרה הכללית`)).catch(fail); } }), ' דק׳') : null)));
  if (document.activeElement !== $('nudgeEvery')) $('nudgeEvery').value = nudgeEveryMin();
  if (document.activeElement !== $('dishEvery')) $('dishEvery').value = dishEveryMin();
}
async function nudgePeople(){
  const to = [...S.nudgePick].filter(id => member(id)); if (!to.length){ toast('בחרו למי להקפיץ'); return; }
  try{ await sendNudge({ type:'people', to }); S.nudgePick.clear(); toast(`📣 נשלח. ${to.map(mName).join(', ')} יקבלו התראה בדקות הקרובות`); render(); }catch(e){ fail(e); }
}
// a few seconds later: the server's report on that bump (who it went to, or why not)
async function bumpFeedback(id, t, since){
  for (let i = 0; i < 5; i++){
    await new Promise(r => setTimeout(r, 1600));
    try{ const s = await getDoc(doc(db, 'nudges', 'bump__' + id)); const r = s.exists() ? s.data() : null;
      if (r && r.at >= since && r.pushed !== undefined){
        const names = (r.to || []).map(mName).join(', ');
        toast(!(r.to || []).length ? `אין למי להקפיץ: ${t.title} כבר בוצעה` : !r.phones ? `🔕 ל${names} אין התראות מופעלות בטלפון` : r.pushed ? `📣 נשלחה התראה ל${names}` : `⚠️ ההתראה ל${names} לא הגיעה`); return; } }catch(e){}
  }
  toast('⚠️ השרת לא אישר שליחת התראה. ייתכן שההתראות בשרת לא פעילות.');
}
async function nudgeTask(t){
  try{
    if (S.isAdmin){ await sendNudge({ type:'task', taskId:t.id }); toast(`📣 ${t.title}: ההתראה בדרך`); return; }
    // a member the admin allowed: one bump document per member (bump__<id>), so the rules can enforce "once every N minutes"
    const b = bumpState(); if (!b.allowed) return;
    let last = 0; try{ const s = await getDoc(doc(db, 'nudges', 'bump__' + b.id)); last = s.exists() ? (s.data().at || 0) : 0; }catch(e){}
    const wait = b.limited ? last + b.every * 60000 - Date.now() : 0;
    if (wait > 0){ toast(`כבר הקפצת. אפשר שוב בעוד ${Math.ceil(wait / 60000)} דק׳`); return; }
    const at = Date.now(); await setDoc(doc(db, 'nudges', 'bump__' + b.id), { by: b.id, taskId: t.id, at });
    toast(`📣 ${t.title}: ההתראה בדרך`); bumpFeedback(b.id, t, at);
  }catch(e){ fail(e); }
}
// the family challenge: the admin, and whoever the admin allowed (some with a time limit)
function challengeNudgeState(){
  const me = S.boundId ? member(S.boundId) : null;
  const allowed = S.isAdmin || (me && me.canNudge === true);
  if (!allowed) return { allowed:false };
  const limited = !S.isAdmin && me.nudgeLimited !== false;
  const every = Number(me?.nudgeEveryMin) >= 1 ? Number(me.nudgeEveryMin) : nudgeEveryMin();
  const last = S.nudgeCh?.at || 0; const wait = limited ? last + every * 60000 - Date.now() : 0;
  return { allowed:true, wait: Math.max(0, wait) };
}
// who may bump a task: the admin, and the members the admin allowed (some with a time limit, set per person)
function bumpState(){
  if (S.isAdmin) return { allowed:true, id:null, limited:false };
  const m = S.boundId ? member(S.boundId) : null;
  if (!m || m.canNudge !== true) return { allowed:false };
  return { allowed:true, id:m.id, limited: m.nudgeLimited !== false, every: Number(m.nudgeEveryMin) >= 1 ? Number(m.nudgeEveryMin) : nudgeEveryMin() };
}
// the 📣 button shows on a task that is waiting today (the admin: on any task), never on your own turn
const canBump = t => { const b = bumpState(); return b.allowed && !t.pending && (S.isAdmin || (isDue(t) && whoseTurn(t) !== b.id)); };
async function nudgeChallenge(){
  const st = challengeNudgeState(); if (!st.allowed) return;
  if (st.wait > 0){ toast(`כבר הקפיצו. אפשר שוב בעוד ${Math.ceil(st.wait / 60000)} דק׳`); return; }
  try{ await setDoc(doc(db,'nudges','challenge'), { by: myMemberId() || S.boundId, at: Date.now() }); toast('📣 כל המשפחה תקבל תזכורת על האתגר בדקות הקרובות'); }catch(e){ fail(e); }
}

/* ---------- admin ---------- */
function syncSelects(){
  const fill = (sel, withAll) => { const v = sel.value; sel.replaceChildren();
    if (withAll) sel.append(h('option', { value:'all' }, 'מי שרוצה (כולם)'));
    S.members.forEach(m => sel.append(h('option', { value:m.id }, m.name)));
    if ([...sel.options].some(o => o.value === v)) sel.value = v; };
  const prevAssignee = $('tf-assignee').value;
  fill($('tf-assignee'), true); fill($('bf-member'), false);
  { const sel = $('tf-assignee'), v = sel.dataset.want || prevAssignee; sel.insertBefore(h('option', { value:'each' }, 'כל אחד בנפרד'), sel.options[1] || null); if (![...sel.options].some(o => o.value === 'rotate')) sel.append(h('option', { value:'rotate' }, 'תורנות (מתחלף)')); if (v) sel.value = v; delete sel.dataset.want; }
  const rot = $('tf-rot'); const picked = new Set([...rot.querySelectorAll('input:checked')].map(i => i.value).concat(rot.dataset.want ? JSON.parse(rot.dataset.want) : []));
  delete rot.dataset.want; rot.replaceChildren(...S.members.map(m => h('label', null, h('input', { type:'checkbox', value:m.id, checked: picked.has(m.id) }), m.name)));
  $('tf-rotwrap').hidden = $('tf-assignee').value !== 'rotate';
  const sgPrev = $('sg-assignee').value;
  const sg = $('sg-assignee'), had = sg.options.length; fill(sg, true);
  sg.insertBefore(h('option', { value:'each' }, 'כל אחד בנפרד'), sg.options[1] || null);
  if (![...sg.options].some(o => o.value === 'rotate')) sg.append(h('option', { value:'rotate' }, 'תורנות (מתחלף)'));
  if (sgPrev === 'rotate' || sgPrev === 'each') sg.value = sgPrev;
  { const rot = $('sg-rot'); const picked = new Set([...rot.querySelectorAll('input:checked')].map(i => i.value));
    rot.replaceChildren(...S.members.map(m => h('label', null, h('input', { type:'checkbox', value:m.id, checked: picked.has(m.id) }), m.name)));
    $('sg-rotwrap').hidden = sg.value !== 'rotate'; }
  if (!had && S.me !== 'all' && member(S.me)) sg.value = S.me;
}
function renderAdminLists(){
  const A = $('atList'); A.replaceChildren(); $('atCount').textContent = S.tasks.length ? String(S.tasks.length) : '';
  if (!S.tasks.length) A.append(h('p', { class:'sub' }, 'אין משימות עדיין. הוסיפו את הראשונה למעלה.'));
  const isNew = t => t.pending || t.reviewed === false;
  S.tasks.slice().sort((a,b) => (!!b.pinned - !!a.pinned) || (isNew(b) - isNew(a)) || (a.title||'').localeCompare(b.title||'','he')).forEach(t => {
    const doneOnce = t.type === 'once' && S.logs.some(l => l.taskId === t.id);
    const by = t.suggestedBy && member(t.suggestedBy) ? ` · נוספה ע״י ${mName(t.suggestedBy)}` : '';
    const row = h('div', { class:'arow arow-wrap' },
      h('div', { class:'t' }, h('strong', null, t.title),
        h('small', null, `${t.pinned ? 'נעוצה · ' : ''}${t.pending ? 'מחכה לניקוד · ' : (t.reviewed === false ? 'חדשה · ' : '')}${assigneeLabel(t)} · ${recLabel(t)}${t.check ? ' · צריך אישור' : ''}${isTimed(t) ? ` · לפי זמן, עד ${t.maxMinutes} דק׳` : ''}${by}${doneOnce ? ' · בוצעה' : ''}`)),
      t.pending ? null : h('span', { class:'pts-pill' + (isTimed(t) ? '' : ' ltr') }, pill(t)),
      t.reviewed === false && !t.pending ? h('button', { type:'button', class:'btn small', onclick:() => markSeen(t) }, 'ראיתי') : null,
      h('button', { type:'button', class:'btn ' + (t.pending ? '' : 'ghost ') + 'small', onclick:() => editTask(t) }, t.pending ? 'קביעת ניקוד' : 'עריכה'),
      h('button', { type:'button', class:'btn ghost small', 'aria-pressed':String(!!t.pinned), onclick:() => togglePin(t) }, t.pinned ? 'ביטול נעיצה' : 'נעיצה'),
      chatButton(t),
      t.pinned ? null : h('button', { type:'button', class:'btn danger small', onclick:() => { S.delAsk = S.delAsk === t.id ? null : t.id; render(); } }, 'מחיקה'));
    if (S.delAsk === t.id && !t.pinned){
      const earned = taskLogs(t).reduce((s, l) => s + (Number(l.points) || 0), 0);
      row.append(h('div', { class:'delask' },
        h('span', null, earned ? `המשימה הזו נתנה עד עכשיו ${earned} נקודות${shekelsFor(earned) != null ? ` (${fmtILS(shekelsFor(earned))})` : ''}.` : 'המשימה עוד לא נתנה נקודות.'),
        earned ? h('button', { type:'button', class:'btn danger armed small', onclick:() => deleteTask(t, true) }, `למחוק גם את ${earned} הנקודות`) : null,
        h('button', { type:'button', class:'btn danger small', onclick:() => deleteTask(t, false) }, earned ? 'למחוק רק את המשימה' : 'למחוק'),
        h('button', { type:'button', class:'btn ghost small', onclick:() => { S.delAsk = null; render(); } }, 'ביטול')));
    }
    A.append(row);
  });

  const M = $('amList'); M.replaceChildren();
  if (!S.members.length) M.append(h('p', { class:'sub' }, 'הוסיפו את בני המשפחה, אחד אחד.'));
  S.members.forEach(m => { const pin = S.pins[m.id];
    M.append(h('div', { class:'arow' },
      h('div', { class:'ava sm', style:`background:${m.color}` }, avatarOf(m.id)),
      h('div', { class:'t' }, h('strong', null, m.name),
        h('small', { class: (pin || m.uid) ? '' : 'err' }, [isAdminMember(m.id) ? 'מנהל' : (isParentMember(m.id) ? 'הורה' : 'ילד'), m.uid ? `גוגל: ${m.email || 'מחובר'}` : null, pin ? `קוד כניסה: ${pin}` : (m.uid ? null : 'אין קוד ואין גוגל: לא יכול/ה להיכנס')].filter(Boolean).join(' · '))),
      h('button', { type:'button', class:'btn ghost small', onclick:() => editMember(m) }, 'עריכה'),
      m.uid && roleOf(m.id) !== 'admin' ? armedBtn('ug'+m.id, 'ניתוק גוגל', () => unlinkGoogle(m)) : null,
      armedBtn('m'+m.id, 'הסרה', async () => { try{
        const b = writeBatch(db); b.delete(doc(db,'members',m.id)); b.delete(doc(db,'pins',m.id)); await b.commit(); toast(`${m.name} הוסר/ה`);
      }catch(e){ fail(e); } }))); });

  const H = $('histList'); H.replaceChildren();
  const hist = S.logs.slice().sort((a,b) => b.at - a.at).slice(0, 40);
  if (!hist.length) H.append(h('p', { class:'sub' }, 'כאן יופיע כל מה שבוצע וכל שינוי נקודות.'));
  hist.forEach(l => { const p = (l.kind === 'redeem' ? -1 : 1) * (Number(l.points) || 0); const [, mo, da] = (l.day || '--').split('-');
    H.append(h('div', { class:'arow' },
      h('div', { class:'t' }, h('strong', null, mName(l.memberId)), h('small', null, `${+da}.${+mo} · ${l.kind === 'bonus' ? 'עדכון: ' : l.kind === 'redeem' ? 'שימוש: ' : ''}${l.title}${l.kind === 'bonus' && l.by ? ` (ע״י ${mName(l.by)})` : ''}${l.wallet ? ' 🐷 רק לארנק' : ''}${l.flag ? ' 🚩 במעקב' : ''}${l.minutes ? ` (${l.minutes} דק׳)` : ''}${l.count ? ` (${l.count} יח׳)` : ''}`)),
      h('span', { class:'num ' + (p < 0 ? 'neg' : 'gold') }, (p > 0 ? '+' : '') + p),
      armedBtn('l'+l.id, 'מחיקה', () => removeLog(l)))); });
}
function editTask(t){
  openAccFor($('tfHead'));
  S.editTask = t.id; $('tfHead').textContent = t.pending ? `קביעת ניקוד: ${t.title}` : 'עריכת משימה'; $('tf-save').textContent = 'שמירת שינויים'; $('tf-cancel').hidden = false;
  $('tf-title').value = t.title; $('tf-assignee').dataset.want = ['rotate','each'].includes(t.assignee) ? t.assignee : (member(t.assignee) ? t.assignee : 'all'); $('tf-until').value = t.untilTime || '';
  $('tf-rot').dataset.want = JSON.stringify(t.rotation || []); $('tf-rot').querySelectorAll('input').forEach(i => i.checked = false); $('tf-check').checked = !!t.check; $('tf-boss').checked = !!t.boss; syncSelects();
  setMode(modeOf(t)); fillQty('tf', t);
  $('tf-points').value = t.points ?? 10; $('tf-rate').value = t.ratePerMin ?? 1; $('tf-max').value = t.maxMinutes ?? 30; updateHint();
  $(t.type === 'once' ? 'tf-type-once' : 'tf-type-repeat').checked = true; $('tf-dayswrap').hidden = t.type === 'once';
  DAYS.forEach((_, i) => $('tf-day-'+i).checked = (t.days || []).includes(i) || t.type === 'once');
  $('tf-title').scrollIntoView({ behavior:'smooth', block:'center' }); $('tf-title').focus({ preventScroll:true });
}
function resetTaskForm(){
  S.editTask = null; $('tfHead').textContent = 'משימה חדשה'; $('tf-save').textContent = 'הוספת משימה'; $('tf-cancel').hidden = true;
  $('tf-title').value = ''; $('tf-assignee').dataset.want = 'all'; $('tf-until').value = ''; $('tf-check').checked = false; $('tf-boss').checked = false; $('tf-rot').querySelectorAll('input').forEach(i => i.checked = false); $('tf-points').value = 10; $('tf-rate').value = 1; $('tf-max').value = 30; setMode('fixed'); fillQty('tf'); updateHint();
  $('tf-type-repeat').checked = true; $('tf-dayswrap').hidden = false;
  DAYS.forEach((_, i) => $('tf-day-'+i).checked = true);
}
function setMode(m){ $('tf-mode-' + m).checked = true; $('tf-fixed-row').hidden = m !== 'fixed'; $('tf-timed-row').hidden = m !== 'timed'; $('tf-qty-row').hidden = m !== 'qty'; $('tf-timed-hint').hidden = m !== 'timed'; }
const modeOf = t => isTimed(t) ? 'timed' : (t.qtyPer ? 'qty' : 'fixed');
const radioMode = p => $(p + '-mode-timed').checked ? 'timed' : $(p + '-mode-qty').checked ? 'qty' : 'fixed';
function fillQty(p, t){ $(p+'-qpts').value = t?.qtyPer ? t.points : 3; $(p+'-qper').value = t?.qtyPer ?? 5; $(p+'-qunit').value = t?.qtyUnit ?? ''; }
// Reads the quantity fields; returns { points, qtyPer, qtyUnit } or a Hebrew error string. No daily cap: the family trusts the kids.
function readQty(p){
  const points = Math.round(Number($(p+'-qpts').value)), qtyPer = Math.round(Number($(p+'-qper').value)), qtyUnit = $(p+'-qunit').value.trim();
  if (!(points >= 0 && points <= 1000)) return 'נקודות: מספר בין 0 ל-1000';
  if (!(qtyPer >= 1 && qtyPer <= 1000)) return '"על כל": מספר בין 1 ל-1000';
  if (!qtyUnit) return 'כתבו מה סופרים, למשל גרבים';
  return { points, qtyPer, qtyUnit };
}
const qtyText = t => `${t.points} נקודות על כל ${t.qtyPer} ${t.qtyUnit}`;
const qtyPoints = (t, n) => Math.floor(n / t.qtyPer) * (Number(t.points) || 0);
function updateHint(){
  const r = Math.round(Number($('tf-rate').value)) || 0, mx = Math.round(Number($('tf-max').value)) || 0;
  const ils = shekelsFor(r * mx);
  $('tf-timed-hint').textContent = `מקסימום למשימה: ${r * mx} נקודות` + (ils != null ? ` (${fmtILS(ils)})` : '') + `. אחרי ${mx} דקות הטיימר מפסיק לצבור.`;
}
async function saveTask(){
  const title = $('tf-title').value.trim();
  const timed = $('tf-mode-timed').checked;
  const points = Math.round(Number($('tf-points').value));
  const ratePerMin = Math.round(Number($('tf-rate').value)), maxMinutes = Math.round(Number($('tf-max').value));
  const type = $('tf-type-once').checked ? 'once' : 'repeat';
  const days = type === 'repeat' ? DAYS.map((_, i) => i).filter(i => $('tf-day-'+i).checked) : [];
  if (!title){ toast('כתבו מה צריך לעשות'); $('tf-title').focus(); return; }
  if (!timed && radioMode('tf') === 'fixed' && (!Number.isFinite(points) || points < 0 || points > 1000)){ toast('נקודות: מספר בין 0 ל-1000'); return; }
  if (timed && (!(ratePerMin >= 1) || ratePerMin > 100)){ toast('נקודות לדקה: מספר בין 1 ל-100'); return; }
  if (timed && (!(maxMinutes >= 1) || maxMinutes > 240)){ toast('תקרה: בין 1 ל-240 דקות'); return; }
  if (type === 'repeat' && !days.length){ toast('בחרו לפחות יום אחד'); return; }
  const assignee = $('tf-assignee').value || 'all';
  const rotation = assignee === 'rotate' ? [...$('tf-rot').querySelectorAll('input:checked')].map(i => i.value) : [];
  if (assignee === 'rotate' && rotation.length < 2){ toast('בתורנות צריך לפחות שני בני משפחה'); return; }
  const q = radioMode('tf') === 'qty' ? readQty('tf') : null; if (typeof q === 'string'){ toast(q); return; }
  const untilTime = $('tf-until').value || '';
  const data = { title, assignee, type, days, timed, check: $('tf-check').checked, ...(untilTime ? { untilTime } : {}),
    ...(assignee === 'rotate' ? { rotation } : {}),
    ...(timed ? { ratePerMin, maxMinutes } : q ? q : { points }) };
  if ($('tf-boss').checked){ if (timed || q){ toast('משימת בוס עובדת רק עם מספר נקודות קבוע'); return; } data.boss = true; data.type = 'once'; data.days = []; }
  const btn = $('tf-save'); btn.disabled = true;
  try{
    if (S.editTask){
      const old = S.tasks.find(x => x.id === S.editTask);
      await setDoc(doc(db,'tasks',S.editTask), { ...data, reviewed:true, pinned: !!old?.pinned, suggestedBy: old?.suggestedBy ?? null, createdAt: old?.createdAt || Date.now() });
      toast('המשימה עודכנה');
    }
    else { await addDoc(collection(db,'tasks'), { ...data, createdAt: Date.now() }); toast('המשימה נוספה'); }
    resetTaskForm();
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
function editMember(m){
  openAccFor($('mf-name'));
  S.editMember = m.id; $('mf-watch').checked = m.watch === true; $('mf-markfor').dataset.want = JSON.stringify(Array.isArray(m.canMarkFor) ? m.canMarkFor : null); $('mf-name').value = m.name; $('mf-pin').value = S.pins[m.id] || ''; $('mf-role').value = roleOf(m.id); $('mf-gender').value = m.gender === 'f' ? 'f' : 'm'; $('mf-save').textContent = 'שמירה'; $('mf-cancel').hidden = false; fillMarkFor();
  const i = COLORS.indexOf(m.color); if (i >= 0) $('mf-color-'+i).checked = true; $('mf-name').focus();
}
function resetMemberForm(){
  S.editMember = null; $('mf-watch').checked = false; $('mf-markfor').dataset.want = 'null'; $('mf-name').value = ''; $('mf-pin').value = ''; $('mf-role').value = 'child'; $('mf-gender').value = 'm'; $('mf-save').textContent = 'הוספה'; $('mf-cancel').hidden = true;
  const used = new Set(S.members.map(m => m.color)); const i = Math.max(0, COLORS.findIndex(c => !used.has(c))); $('mf-color-'+i).checked = true;
  fillMarkFor();
}
function fillMarkFor(){
  const box = $('mf-markfor'); let want = null; try{ want = JSON.parse(box.dataset.want || 'null'); }catch(e){}
  const self = S.editMember;
  const checked = want ? new Set(want) : new Set(S.members.filter(m => roleOf(m.id) === 'child').map(m => m.id));
  box.replaceChildren(...S.members.filter(m => m.id !== self).map(m => h('label', null, h('input', { type:'checkbox', value:m.id, checked: checked.has(m.id) }), m.name)));
  $('mf-parentOpts').hidden = $('mf-role').value !== 'parent';
}
async function saveMember(){
  const name = $('mf-name').value.trim(); const color = (document.querySelector('input[name=mf-color]:checked') || {}).value || COLORS[0];
  const pin = $('mf-pin').value.trim();
  if (!name){ toast('כתבו שם'); $('mf-name').focus(); return; }
  if (pin && !/^\d{4}$/.test(pin)){ toast('הקוד הוא בדיוק 4 ספרות'); $('mf-pin').focus(); return; }
  const btn = $('mf-save'); btn.disabled = true;
  try{
    const b = writeBatch(db);
    const ref = S.editMember ? doc(db,'members',S.editMember) : doc(collection(db,'members'));
    const role = $('mf-role').value || 'child'; const admin = role === 'admin'; const gender = $('mf-gender').value === 'f' ? 'f' : 'm';
    const extra = { watch: $('mf-watch').checked, ...(role === 'parent' ? { canMarkFor: [...$('mf-markfor').querySelectorAll('input:checked')].map(i => i.value) } : {}) };
    if (S.editMember) b.update(ref, { name, color, role, admin, gender, ...extra }); else b.set(ref, { name, color, role, admin, gender, ...extra, order: Date.now() });
    if (pin) b.set(doc(db,'pins',ref.id), { pin });
    await b.commit();
    toast(S.editMember ? 'נשמר' : `${name} נוסף/ה` + (pin ? '' : '. בלי קוד אי אפשר להיכנס בשמו/ה.'));
    resetMemberForm();
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
// Parents may give or take points when the admin allows it (settings/perms.parentPoints). Each change carries who made it.
const parentPointsOn = () => S.perms && S.perms.parentPoints === true;
function renderParentPoints(){
  const on = isParentNow() && parentPointsOn();
  $('ppToggleWrap').hidden = !on || S.ppOpen; $('ppPanel').hidden = !on || !S.ppOpen; if (!on) return;
  const sel = $('pp-member'); const keep = sel.value;
  sel.replaceChildren(...S.members.map(m => h('option', { value:m.id }, m.id === S.boundId ? `${m.name} (אני)` : m.name)));
  if (keep) sel.value = keep;
  if (S.isAdmin !== undefined && $('perm-parentPts')) $('perm-parentPts').checked = parentPointsOn();
}
// Admin: every change a parent made, with edit / delete / "under watch" tag.
function renderParentPointsAdmin(){
  const box = $('ppAdmin'); if (!box) return;
  const list = S.logs.filter(l => l.kind === 'bonus' && l.by && !l.complaintId).sort((a,b) => b.at - a.at).slice(0, 40);
  box.hidden = !S.isAdmin || !list.length; if (box.hidden) return;
  $('ppCount').textContent = String(list.length);
  const L = $('ppList'); L.replaceChildren();
  list.forEach(l => { const [, mo, da] = (l.day || '--').split('-');
    const inp = h('input', { type:'number', class:'pp-edit', value:String(l.points), inputmode:'numeric', 'aria-label':'נקודות' });
    L.append(h('div', { class:'arow arow-wrap' + (l.flag ? ' flagged' : '') },
      h('div', { class:'t' }, h('strong', null, `${isWatched(l.by) ? '🚩 ' : ''}${mName(l.by)} ← ${l.by === l.memberId ? 'לעצמו/ה' : mName(l.memberId)}`), h('small', null, `${+da}.${+mo} · ${l.title}`)),
      signed(inp),
      h('button', { type:'button', class:'btn ghost small', onclick: async () => { const v = Math.round(Number(inp.value)); if (!Number.isFinite(v) || v === 0){ toast('מספר לא 0'); return; }
        try{ await updateDoc(doc(db,'logs',l.id), { points:v }); toast('עודכן'); }catch(e){ fail(e); } } }, 'שמירה'),
      armedBtn('ppd' + l.id, 'מחיקה', () => removeLog(l)))); });
}
async function saveParentPoints(){
  const memberId = $('pp-member').value; const points = Math.round(Number($('pp-points').value));
  const reason = $('pp-reason').value.trim() || (points < 0 ? 'הורדת נקודות' : 'בונוס');
  if (!memberId){ toast('בחרו למי'); return; }
  if (!Number.isFinite(points) || points === 0 || Math.abs(points) > 100){ toast('נקודות: בין -100 ל-100, לא 0'); return; }
  const btn = $('pp-save'); btn.disabled = true;
  const w = isWatched(S.boundId);
  try{ await addDoc(collection(db,'logs'), { kind:'bonus', title:reason, memberId, points, by:S.boundId, ...(w ? { approved:false } : {}), day:today(), at:Date.now() });
    toast(w ? `נשלח לאישור המנהל: ${mName(memberId)} ${points > 0 ? '+' : ''}${points}` : `${mName(memberId)}: ${points > 0 ? '+' : ''}${points}`); $('pp-reason').value = ''; }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
async function saveBonus(){
  const memberId = $('bf-member').value; const points = Math.round(Number($('bf-points').value));
  const reason = $('bf-reason').value.trim() || (points < 0 ? 'הורדת נקודות' : 'בונוס');
  if (!memberId){ toast('קודם הוסיפו בני משפחה'); return; }
  if (!Number.isFinite(points) || points === 0){ toast('כתבו מספר נקודות (לא 0)'); return; }
  const wallet = $('bf-wallet').checked;
  const btn = $('bf-save'); btn.disabled = true;
  try{
    await addDoc(collection(db,'logs'), { kind:'bonus', title:reason, memberId, points, ...(wallet ? { wallet:true } : {}), day:today(), at:Date.now() });
    toast(`${mName(memberId)}: ${points > 0 ? '+' : ''}${points}${wallet ? ' לארנק, בלי התחרות' : ''}`); $('bf-reason').value = ''; $('bf-wallet').checked = false;
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}

async function saveMoney(){
  const points = Math.round(Number($('mo-points').value)); const shekels = Math.round(Number($('mo-shekels').value) * 100) / 100;
  if (!(points >= 1)){ toast('כמות נקודות: לפחות 1'); return; }
  if (!(shekels >= 0)){ toast('שקלים: 0 או יותר'); return; }
  const btn = $('mo-save'); btn.disabled = true;
  try{ await setDoc(doc(db,'settings','money'), { points, shekels }); toast(shekels > 0 ? `${points} נקודות = ${fmtILS(shekels)}` : 'הסכום בשקלים הוסתר'); }
  catch(e){ fail(e); } finally{ btn.disabled = false; }
}
// Updates running clocks once a second without rebuilding the page.
function tick(){
  for (const tm of S.timers){
    const el = document.querySelector(`[data-timer="${CSS.escape(tm.id)}"]`); if (!el) continue;
    const t = S.tasks.find(x => x.id === tm.taskId); if (!t || !isTimed(t)) continue;
    const r = timedResult(t, tm);
    el.textContent = clock(r.ms);
    const e = document.querySelector(`[data-earn="${CSS.escape(tm.id)}"]`); if (e) e.textContent = `+${r.points}`;
    const c = document.querySelector(`[data-cap="${CSS.escape(tm.id)}"]`); if (c) c.textContent = r.capped ? 'הגיע לתקרה' : '';
  }
}
function buildStatic(){
  buildKitchen();
  for (const id of ['bf-points','pp-points']){ const inp = $(id); const wrap = h('span', { class:'signed' }); inp.replaceWith(wrap); wrap.append(inp, signBtn(inp)); }
  const dw = $('tf-days'); DAYS.forEach((d, i) => dw.append(h('label', { title:'יום '+d }, h('input', { type:'checkbox', id:'tf-day-'+i, value:i, checked:true }), d)));
  const sw = $('mf-colors'); COLORS.forEach((c, i) => sw.append(h('label', { style:`background:${c}`, title:'צבע' }, h('input', { type:'radio', name:'mf-color', id:'mf-color-'+i, value:c, checked: i === 0 }))));
  const jc = $('join-colors'); COLORS.forEach((c, i) => jc.append(h('label', { style:`background:${c}`, title:'צבע' }, h('input', { type:'radio', name:'join-color', id:'join-color-'+i, value:c, checked: i === 0 }))));
  document.querySelectorAll('input[name=tf-type]').forEach(r => r.addEventListener('change', () => { $('tf-dayswrap').hidden = $('tf-type-once').checked; }));
  $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.kitchen){ S.kitchenOpen = true; S.openPick = null; render(); return; } S.tab = b.dataset.tab; S.openPick = null; S.kitchenOpen = false; render(); window.scrollTo(0, 0); });
  $('tf-save').addEventListener('click', saveTask); $('tf-cancel').addEventListener('click', resetTaskForm);
  $('mf-save').addEventListener('click', saveMember);
  $('mf-role').addEventListener('change', fillMarkFor); $('mf-cancel').addEventListener('click', resetMemberForm);
  $('bf-save').addEventListener('click', saveBonus);
  $('pp-save').addEventListener('click', saveParentPoints);
  $('nudgeSend').addEventListener('click', nudgePeople);
  $('dishLimitOpen').addEventListener('click', () => { $('dishPop').hidden = !$('dishPop').hidden; if ($('dishPop').hidden) return; $('dishEvery').value = dishEveryMin(); $('dishEvery').focus(); });
  $('dishPopClose').addEventListener('click', () => { $('dishPop').hidden = true; });
  $('dishPop').addEventListener('click', e => { if (e.target === $('dishPop')) $('dishPop').hidden = true; });
  $('dishEverySave').addEventListener('click', async () => { const v = Math.round(Number($('dishEvery').value)); if (!(v >= 1 && v <= 1440)){ toast('בין 1 ל-1440 דקות'); return; }
    try{ await setDoc(doc(db,'settings','perms'), { ...(S.perms || {}), dishEveryMin: v }); toast(`נשמר: מנה לאותו אדם פעם ב-${v} דקות`); }catch(e){ fail(e); } });
  $('nudgeEverySave').addEventListener('click', async () => { const v = Math.round(Number($('nudgeEvery').value)); if (!(v >= 1 && v <= 1440)){ toast('בין 1 ל-1440 דקות'); return; }
    try{ await setDoc(doc(db,'settings','perms'), { ...(S.perms || {}), nudgeEveryMin: v }); toast(`נשמר: פעם ב-${v} דקות`); }catch(e){ fail(e); } });
  $('pp-toggle').addEventListener('click', () => { S.ppOpen = true; render(); $('pp-points').focus(); });
  $('ppPanel').prepend(h('button', { type:'button', class:'cl-close', 'aria-label':'סגירה', onclick:() => { S.ppOpen = false; render(); } }, '✕'));
  $('perm-parentPts').addEventListener('change', async e => { try{ await setDoc(doc(db,'settings','perms'), { ...(S.perms || {}), parentPoints: e.target.checked }); toast(e.target.checked ? 'הורים יכולים עכשיו לשנות נקודות' : 'רק אתה יכול לשנות נקודות'); }catch(err){ fail(err); e.target.checked = !e.target.checked; } });
  $('mo-save').addEventListener('click', saveMoney);
  $('rankHint').addEventListener('click', () => { S.rankOpen = !S.rankOpen; render(); });
  $('viewAsExit').addEventListener('click', stopViewAs);
  $('ex-save').addEventListener('click', saveExchange);
  $('ex-cancel').addEventListener('click', resetExchange);
  $('ex-starter').addEventListener('click', addStarterExchanges);
  EX_EMOJI.forEach(e => $('ex-emoji').append(h('option', { value:e }, e)));
  $('sg-assignee').addEventListener('change', () => { $('sg-rotwrap').hidden = $('sg-assignee').value !== 'rotate'; });
  $('gl-save').addEventListener('click', saveGoal);
  $('ch-save').addEventListener('click', saveChallenge);
  $('ch-cancel').addEventListener('click', closeChallengeEdit);
  $('ch-new').addEventListener('click', () => openChallengeEdit('new'));
  $('tf-assignee').addEventListener('change', () => { $('tf-rotwrap').hidden = $('tf-assignee').value !== 'rotate'; });
  $('ru-save').addEventListener('click', saveUse);
  $('chatBack').addEventListener('click', closeChat);
  $('cpFab').addEventListener('click', () => { S.fabMenu = !S.fabMenu; render(); }); $('cpBack').addEventListener('click', closeComplaints);
  $('cpSend').addEventListener('click', sendComplaint);
  $('dnFab').addEventListener('click', () => { S.dnOpen = true; render(); });
  $('fmCp').addEventListener('click', () => { S.fabMenu = false; openComplaints(); });
  $('fmDn').addEventListener('click', () => { S.fabMenu = false; S.dnOpen = true; render(); }); $('dnBack').addEventListener('click', () => { S.dnOpen = false; const seen = [...S.dnSeen]; S.dnSeen.clear(); if (seen.length) clearSeenNotes(seen); render(); });
  $('dnSend').addEventListener('click', sendDevNote); initDevNotes();
  document.querySelectorAll('input[name=cpf]').forEach(r => r.addEventListener('change', render));
  initComplaints();
  setupCollapsibles();
  setupAdminAccordion();
  $('ag-go').addEventListener('click', adminCodeGo);
  $('ag-code').addEventListener('keydown', e => { if (e.key === 'Enter') adminCodeGo(); });
  $('ag-cancel').addEventListener('click', closeAdminGate);
  $('adminGate').addEventListener('click', e => { if (e.target === $('adminGate')) closeAdminGate(); });
  $('ac-save').addEventListener('click', saveAdminCode);
  $('profileBack').addEventListener('click', closeProfile);
  $('meBarOpen').addEventListener('click', () => { if (S.boundId) openProfile(S.boundId); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.profileOpen) closeProfile(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.chatOpen) closeChat(); });
  const sd = $('sg-days'); DAYS.forEach((d, i) => sd.append(h('label', { title:'יום '+d }, h('input', { type:'checkbox', id:'sg-day-'+i, value:i, checked:true }), d)));
  document.querySelectorAll('input[name=sg-type]').forEach(r => r.addEventListener('change', () => { $('sg-dayswrap').hidden = !$('sg-type-repeat').checked; }));
  $('sg-toggle').addEventListener('click', () => toggleSuggest(true));
  $('sg-cancel').addEventListener('click', () => toggleSuggest(false));
  $('sg-save').addEventListener('click', saveSuggestion);
  document.querySelectorAll('input[name=sg-mode]').forEach(r => r.addEventListener('change', () => setSgMode(radioMode('sg'))));
  document.querySelectorAll('input[name=tf-mode]').forEach(r => r.addEventListener('change', () => setMode(radioMode('tf'))));
  ['tf-rate','tf-max'].forEach(id => $(id).addEventListener('input', updateHint));
  updateHint();
}

/* ---------- kitchen: pick a food and watch it get prepared ---------- */
// Each food maps to an action; the animations belong to the action (a mode class on #kScene plus timed steps),
// so a new food is one line here, no new drawing. c = liquid colour for pouring.
const KITCHEN = [
  { e:'🧆', n:'קציצות', a:'heat' }, { e:'🍕', n:'פיצה', a:'heat' }, { e:'🍲', n:'מרק', a:'heat' }, { e:'🍝', n:'פסטה', a:'heat' }, { e:'🍗', n:'עוף', a:'heat' }, { e:'🌭', n:'נקניקייה', a:'heat' },
  { e:'🍔', n:'המבורגר', a:'heat' }, { e:'🍟', n:'צ׳יפס', a:'heat' }, { e:'🍚', n:'אורז', a:'heat' }, { e:'🥟', n:'כופתאות', a:'heat' },
  { e:'🥭', n:'מנגו', a:'cut' }, { e:'🍉', n:'אבטיח', a:'cut' }, { e:'🍎', n:'תפוח', a:'cut' }, { e:'🍌', n:'בננה', a:'cut' }, { e:'🥒', n:'מלפפון', a:'cut' }, { e:'🥕', n:'גזר', a:'cut' },
  { e:'🍅', n:'עגבנייה', a:'cut' }, { e:'🍊', n:'תפוז', a:'cut' }, { e:'🍓', n:'תות', a:'cut' }, { e:'🥑', n:'אבוקדו', a:'cut' }, { e:'🍍', n:'אננס', a:'cut' }, { e:'🧀', n:'גבינה', a:'cut' },
  { e:'🍞', n:'לחם', a:'toasting' }, { e:'🥯', n:'בייגל', a:'toasting' }, { e:'🥐', n:'קרואסון', a:'toasting' },
  { e:'🥛', n:'חלב', a:'pour', c:'#FFFFFF' }, { e:'🍊', n:'מיץ תפוזים', a:'pour', c:'#FFA726' }, { e:'🍫', n:'שוקו', a:'pour', c:'#6D4C41' }, { e:'☕', n:'קפה', a:'pour', c:'#6B4226' }, { e:'🍵', n:'תה', a:'pour', c:'#C98A4B' }, { e:'💧', n:'מים', a:'pour', c:'#7FD1FF' }, { e:'🍇', n:'מיץ ענבים', a:'pour', c:'#8E3FA8' },
  { e:'🥚', n:'ביצה', a:'fry' }, { e:'🥞', n:'פנקייק', a:'fry' }, { e:'🥩', n:'סטייק', a:'fry' }, { e:'🍄', n:'פטריות', a:'fry' },
  { e:'🍌', n:'שייק בננה', a:'blend', c:'#F6E27A' }, { e:'🍓', n:'שייק תות', a:'blend', c:'#F27A9A' }, { e:'🥭', n:'שייק מנגו', a:'blend', c:'#FFB300' }, { e:'🫐', n:'שייק אוכמניות', a:'blend', c:'#5B6BC0' },
  { e:'🍫', n:'מילקשייק שוקולד', a:'blend', c:'#6D4C41' }, { e:'🥬', n:'סמוטי ירוק', a:'blend', c:'#9CCB4A' },
  { e:'🍪', n:'עוגיות', a:'bake' }, { e:'🍰', n:'עוגה', a:'bake' }, { e:'🧁', n:'קאפקייק', a:'bake' }, { e:'🥧', n:'פאי', a:'bake' },
  { e:'🍕', n:'פיצה בתנור', a:'bake' }, { e:'🍗', n:'עוף בתנור', a:'bake' }, { e:'🥔', n:'תפוד אפוי', a:'bake' }, { e:'🍠', n:'בטטה אפויה', a:'bake' }];
const KACTIONS = [['heat', '🔥 לחמם במיקרוגל'], ['cut', '🔪 לחתוך'], ['toasting', '🍞 לקלות בטוסטר'], ['pour', '🥤 שתייה (שופכים לכוס)'], ['fry', '🍳 לטגן במחבת'], ['blend', '🥤 לטחון בבלנדר'], ['bake', '🧁 לאפות בתנור']];
const K = { timers:[], clock:null, audio:null, shown:false, cur:null, dish:null, ready:false, sent:new Set(), run:0, stops:[], loops:[] };
/* ---------- kitchen animations (v2): one SVG scene per action, built fresh on every pick; async timelines; a canvas for particles ---------- */
const kSpeed = () => { try{ return matchMedia('(prefers-reduced-motion: reduce)').matches ? .4 : 1; }catch(e){ return 1; } };
const kCalm = () => { try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } };
const kRnd = (a, b) => a + Math.random() * (b - a);
const kTx = (x, y, s = 1, sy) => `translate(${x}px,${y}px) scale(${s}${sy != null ? ',' + sy : ''})`;
const kq = s => $('kScene').querySelector(s);
const kHold = stop => { K.stops.push(stop); return stop; };

/* --- sound: everything is synthesized, no files --- */
function kCtx(){ const A = K.audio || (K.audio = new (window.AudioContext || window.webkitAudioContext)()); if (A.state === 'suspended') A.resume(); return A; }
const kSoundOn = () => store.get('ft-ksound') !== '0';
// a tone with an attack and a decay, optionally gliding to another pitch; returns a function that fades it out
function kTone(freq, dur, o = {}){
  if (!kSoundOn()) return () => {};
  try{
    const A = kCtx(), t0 = A.currentTime + (o.delay || 0), osc = A.createOscillator(), g = A.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t0); if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    const v = o.vol ?? .07; g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? .005)); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    osc.connect(g); g.connect(A.destination); osc.start(t0); osc.stop(t0 + dur + .03);
    return () => { try{ g.gain.cancelScheduledValues(A.currentTime); g.gain.setTargetAtTime(.0001, A.currentTime, .03); osc.stop(A.currentTime + .15); }catch(e){} };
  }catch(e){ return () => {}; }
}
// filtered noise: whooshes, sizzle, the click of a knife
function kNoise(dur, o = {}){
  if (!kSoundOn()) return () => {};
  try{
    const A = kCtx(), t0 = A.currentTime + (o.delay || 0), n = Math.max(1, Math.floor(A.sampleRate * dur)), buf = A.createBuffer(1, n, A.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain(); f.type = o.type || 'highpass'; f.frequency.setValueAtTime(o.freq || 2000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur); f.Q.value = o.q || .7;
    const v = o.vol ?? .05; g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? .004)); g.gain.setValueAtTime(v, t0 + Math.max(.01, dur * (o.hold ?? 0))); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(A.destination); src.start(t0);
    return () => { try{ g.gain.cancelScheduledValues(A.currentTime); g.gain.setTargetAtTime(.0001, A.currentTime, .03); src.stop(A.currentTime + .15); }catch(e){} };
  }catch(e){ return () => {}; }
}
const kBeep = (freq, ms = 120, type = 'sine', vol = .07) => kTone(freq, ms / 1000, { type, vol });
const kSND = {
  pop(){ kTone(420, .12, { to: 900, vol: .07 }); },
  whoosh(){ kNoise(.32, { type: 'bandpass', freq: 500, to: 2600, q: .9, vol: .045, attack: .08 }); },
  thud(){ kTone(140, .16, { to: 48, vol: .13 }); kNoise(.05, { type: 'lowpass', freq: 700, vol: .05 }); },
  clunk(){ kTone(210, .13, { to: 80, vol: .1, type: 'triangle' }); kNoise(.04, { type: 'bandpass', freq: 1400, vol: .05 }); },
  ding(){ [0, .24, .48].forEach(d => { kTone(1760, .6, { vol: .055, delay: d }); kTone(2637, .4, { vol: .02, delay: d }); }); },
  chop(){ kNoise(.07, { type: 'highpass', freq: 1800, vol: .09 }); kTone(190, .1, { to: 80, vol: .1, type: 'triangle' }); },
  sparkle(){ [0, .07, .14, .21].forEach((d, i) => kTone(1800 + i * 330, .22, { vol: .03, delay: d })); },
  crack(){ kNoise(.06, { type: 'highpass', freq: 2500, vol: .09 }); kNoise(.05, { type: 'lowpass', freq: 900, vol: .05, delay: .05 }); },
  sizzle(dur){ return kNoise(dur, { type: 'highpass', freq: 3200, vol: .035, attack: .1, hold: .7 }); },
  hum(dur, f0){ const a = kTone(f0, dur, { type: 'sawtooth', vol: .02, attack: .15 }), b = kTone(f0 * 2.01, dur, { type: 'square', vol: .007, attack: .2 }); return () => { a(); b(); }; },
  motor(dur){ return kTone(70, dur, { to: 240, type: 'sawtooth', vol: .035, attack: .2 }); },
  glug(n){ for (let i = 0; i < n; i++) kTone(240 + (i % 3) * 60, .09, { to: 380 + (i % 2) * 90, vol: .06, delay: i * .24 + Math.random() * .05 }); },
  clink(){ kTone(2600, .45, { vol: .05 }); kTone(3900, .3, { vol: .025, delay: .01 }); },
};

/* --- particles: one canvas over the scene, drawn in the scene's 320x340 units --- */
const kFX = { cv: null, cx: null, ps: [], raf: 0, last: 0, k: 1 };
function kFxSize(){
  const cv = $('kFx'); if (!cv) return; kFX.cv = cv; const r = cv.getBoundingClientRect(); if (!r.width) return;
  const d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); kFX.k = cv.width / 320; kFX.cx = cv.getContext('2d');
}
function kFxClear(){ kFX.ps.length = 0; if (kFX.cx) kFX.cx.clearRect(0, 0, kFX.cv.width, kFX.cv.height); }
function kFxAdd(p){ if (kCalm() || !kFX.cx) return; p.t = 0; kFX.ps.push(p); if (kFX.ps.length > 240) kFX.ps.shift(); if (!kFX.raf){ kFX.last = performance.now(); kFX.raf = requestAnimationFrame(kFxTick); } }
function kStar(cx, x, y, r){ cx.beginPath(); for (let i = 0; i < 8; i++){ const rr = i % 2 ? r * .3 : r, a = i * Math.PI / 4; cx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } cx.closePath(); }
function kFxTick(now){
  const dt = Math.min(.05, (now - kFX.last) / 1000); kFX.last = now; const cx = kFX.cx; if (!cx){ kFX.raf = 0; return; }
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, kFX.cv.width, kFX.cv.height); cx.setTransform(kFX.k, 0, 0, kFX.k, 0, 0);
  for (let i = kFX.ps.length - 1; i >= 0; i--){
    const p = kFX.ps[i]; p.t += dt; if (p.t >= p.life){ kFX.ps.splice(i, 1); continue; }
    const u = p.t / p.life; cx.save(); if (p.clip){ cx.beginPath(); cx.rect(p.clip[0], p.clip[1], p.clip[2], p.clip[3]); cx.clip(); }
    if (p.k === 'puff'){
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * .6; const r = p.r0 + (p.r1 - p.r0) * u, al = p.a * Math.min(1, u * 6) * (1 - u), g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(${p.col},${al})`); g.addColorStop(1, `rgba(${p.col},0)`); cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 6.2832); cx.fill();
    } else if (p.k === 'drop'){
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.floor && p.y > p.floor){ p.y = p.floor; p.vy *= -.22; p.vx *= .5; }
      cx.globalAlpha = Math.min(1, (1 - u) * 2.4); cx.translate(p.x, p.y); cx.rotate(Math.atan2(p.vy, p.vx)); cx.fillStyle = p.col;
      cx.beginPath(); cx.ellipse(0, 0, p.r * (1 + Math.min(1.5, Math.hypot(p.vx, p.vy) / 130)), p.r, 0, 0, 6.2832); cx.fill(); cx.fillStyle = 'rgba(255,255,255,.55)'; cx.beginPath(); cx.arc(-p.r * .3, -p.r * .3, p.r * .32, 0, 6.2832); cx.fill();
    } else if (p.k === 'spark'){
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt; cx.translate(p.x, p.y); cx.rotate(p.rot + u * 2); cx.globalAlpha = Math.min(1, (1 - u) * 2); cx.fillStyle = p.col; kStar(cx, 0, 0, p.s * Math.sin(Math.PI * Math.min(1, u * 1.15))); cx.fill();
    } else if (p.k === 'crumb'){
      p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.floor && p.y > p.floor){ p.y = p.floor; p.vy *= -.3; p.vx *= .6; }
      cx.globalAlpha = Math.min(1, (1 - u) * 2.5); cx.translate(p.x, p.y); cx.rotate(p.rot + u * 6); cx.fillStyle = p.col; cx.fillRect(-p.r, -p.r * .6, p.r * 2, p.r * 1.2);
    } else if (p.k === 'bubble'){
      p.y += p.vy * dt; p.x += Math.sin(p.t * 6 + p.ph) * 6 * dt; const pop = u > .82 ? (u - .82) / .18 : 0, r = p.r * (1 + pop * .5);
      cx.globalAlpha = (1 - pop) * .85; cx.lineWidth = 1.1; cx.strokeStyle = p.col; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 6.2832); cx.stroke(); cx.fillStyle = 'rgba(255,255,255,.5)'; cx.beginPath(); cx.arc(p.x - r * .35, p.y - r * .35, r * .25, 0, 6.2832); cx.fill();
    } else if (p.k === 'ring'){
      const r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - u, 2.2)); cx.lineWidth = 3 * (1 - u) + .5; cx.strokeStyle = `${p.col}${(1 - u) * .85})`; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 6.2832); cx.stroke();
    } else if (p.k === 'conf'){
      p.vy += 160 * dt; p.vx *= 1 - dt * .8; p.x += p.vx * dt + Math.sin(p.t * 7 + p.rot) * 12 * dt; p.y += p.vy * dt; cx.globalAlpha = Math.min(1, (1 - u) * 3); cx.translate(p.x, p.y); cx.rotate(p.rot + p.t * 9); cx.scale(1, Math.cos(p.t * 8 + p.rot)); cx.fillStyle = p.col; cx.fillRect(-3, -1.8, 6, 3.6);
    }
    cx.restore();
  }
  kFX.raf = kFX.ps.length ? requestAnimationFrame(kFxTick) : 0;
}
const kPuff = (x, y, o = {}) => kFxAdd({ k: 'puff', x, y, vx: o.vx ?? kRnd(-6, 6), vy: o.vy ?? kRnd(-26, -14), r0: o.r0 ?? 4, r1: o.r1 ?? 15, a: o.a ?? .5, life: o.life ?? 1.4, col: o.col || '255,255,255', clip: o.clip });
function kDrops(x, y, n, col, o = {}){ for (let i = 0; i < n; i++){ const a = (o.dir ?? -Math.PI / 2) + kRnd(-(o.spread ?? 1.1), o.spread ?? 1.1), s = kRnd(o.min ?? 60, o.max ?? 150); kFxAdd({ k: 'drop', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: o.g ?? 520, r: kRnd(1.4, 3.2), col, life: kRnd(.5, .9), floor: o.floor, clip: o.clip }); } }
function kSparkle(x, y, n = 8, col){ for (let i = 0; i < n; i++){ const a = kRnd(0, 6.28), s = kRnd(20, 70); kFxAdd({ k: 'spark', x: x + Math.cos(a) * kRnd(0, 18), y: y + Math.sin(a) * kRnd(0, 18), vx: Math.cos(a) * s * .5, vy: Math.sin(a) * s * .5 - 16, s: kRnd(5, 11), col: col || '#FFD84D', life: kRnd(.6, 1.1), rot: kRnd(0, 1.5) }); } }
const kRing = (x, y, col = 'rgba(255,214,90,', o = {}) => kFxAdd({ k: 'ring', x, y, r0: o.r0 ?? 8, r1: o.r1 ?? 56, col, life: o.life ?? .7 });
function kCrumbs(x, y, n, col, o = {}){ for (let i = 0; i < n; i++) kFxAdd({ k: 'crumb', x: x + kRnd(-14, 14), y, vx: kRnd(-40, 40), vy: kRnd(-130, -60), r: kRnd(1.2, 2.4), col, rot: kRnd(0, 6), life: kRnd(.6, 1), floor: o.floor }); }
const kBubble = (x, y, o = {}) => kFxAdd({ k: 'bubble', x, y, vy: o.vy ?? kRnd(-30, -16), r: o.r ?? kRnd(2, 4.5), col: o.col || 'rgba(255,255,255,.95)', ph: kRnd(0, 6), life: o.life ?? kRnd(.7, 1.2), clip: o.clip });
function kConfetti(x, y, n = 24){ const cols = ['#FF6B6B', '#FFD84D', '#4DA3FF', '#39B980', '#B57BFF']; for (let i = 0; i < n; i++){ const a = -Math.PI / 2 + kRnd(-1.2, 1.2), s = kRnd(70, 190); kFxAdd({ k: 'conf', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, col: cols[i % 5], rot: kRnd(0, 6), life: kRnd(1.1, 1.8) }); } }
// every dish ends with the same little celebration
function kFlourish(x, y){ kRing(x, y); kSparkle(x, y, 12); kSND.sparkle(); }

/* --- the scene: a shared backdrop and a fresh SVG per action --- */
const kTxt = 'text-anchor="middle" dy=".36em"';
const KDEFS = `<defs>
<linearGradient id="gWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F9F5EB"/><stop offset="1" stop-color="#EBE3D1"/></linearGradient>
<pattern id="pTile" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 .5H40M0 10.5H40M20 .5V10.5M0 10.5V20M40 10.5V20" stroke="#CFC5AD" stroke-width="1" fill="none" opacity=".7"/></pattern>
<radialGradient id="gVig" cx=".5" cy=".42" r=".78"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#6B5A3A" stop-opacity=".24"/></radialGradient>
<linearGradient id="gWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E6BB82"/><stop offset=".12" stop-color="#D3A166"/><stop offset="1" stop-color="#B38048"/></linearGradient>
<pattern id="pGrain" width="64" height="22" patternUnits="userSpaceOnUse"><path d="M0 4Q16 1 32 4T64 4M0 13Q20 16 40 12T64 14M10 20Q30 18 50 21" stroke="#9A6B38" stroke-width="1" fill="none" opacity=".22"/></pattern>
<linearGradient id="gBoard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0D3A0"/><stop offset="1" stop-color="#DDB679"/></linearGradient>
<linearGradient id="gSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FAFBFD"/><stop offset=".5" stop-color="#DCE2EC"/><stop offset="1" stop-color="#B6C0D2"/></linearGradient>
<linearGradient id="gBlade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9AA6B8"/><stop offset=".35" stop-color="#F4F7FB"/><stop offset=".7" stop-color="#C5CEDB"/><stop offset="1" stop-color="#8794A8"/></linearGradient>
<linearGradient id="gHandle" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5A3A22"/><stop offset=".4" stop-color="#8A5B38"/><stop offset="1" stop-color="#4C301C"/></linearGradient>
<linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#9FB4D4" stop-opacity=".16"/><stop offset="1" stop-color="#0E1522" stop-opacity=".5"/></linearGradient>
<linearGradient id="gInt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#323C52"/><stop offset="1" stop-color="#171D2B"/></linearGradient>
<radialGradient id="gBulb" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#FFF6CC" stop-opacity=".95"/><stop offset=".5" stop-color="#FFD27A" stop-opacity=".45"/><stop offset="1" stop-color="#FF9A3C" stop-opacity="0"/></radialGradient>
<radialGradient id="gDish" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#D9E1EE"/></radialGradient>
<radialGradient id="gKey" cx=".4" cy=".35"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#A9B4C7"/></radialGradient>
<pattern id="pMesh" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".9" fill="#0B1020" opacity=".6"/></pattern>
<filter id="fBlur2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="fBlur4" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="fGlowG" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="fShadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#2A1A08" flood-opacity=".28"/></filter>
<filter id="fToast"><feColorMatrix type="matrix" values=".74 .30 .08 0 -.05  .20 .52 .06 0 -.08  .05 .10 .28 0 -.07  0 0 0 1 0"/></filter>
<linearGradient id="gLiq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
<linearGradient id="gFlame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4DA3FF"/><stop offset=".35" stop-color="#7DC4FF"/><stop offset=".5" stop-color="#FFB347"/><stop offset="1" stop-color="#FF6A2E"/></linearGradient>
<linearGradient id="gHob" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3C4352"/><stop offset="1" stop-color="#232833"/></linearGradient>
<radialGradient id="gKnob" cx=".4" cy=".35"><stop offset="0" stop-color="#9AA4B8"/><stop offset="1" stop-color="#3A4150"/></radialGradient>
<linearGradient id="gPanW" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#20242C"/><stop offset=".5" stop-color="#4C5362"/><stop offset="1" stop-color="#20242C"/></linearGradient>
<radialGradient id="gPanIn" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#303641"/><stop offset="1" stop-color="#12151A"/></radialGradient>
<radialGradient id="gYolk" cx=".4" cy=".35"><stop offset="0" stop-color="#FFD84D"/><stop offset="1" stop-color="#F2A100"/></radialGradient>
<radialGradient id="gOvenGlow" cx=".5" cy=".85" r=".8"><stop offset="0" stop-color="#FF9A3C" stop-opacity=".85"/><stop offset=".6" stop-color="#E2572C" stop-opacity=".35"/><stop offset="1" stop-color="#7A2A10" stop-opacity="0"/></radialGradient>
<filter id="fHaze" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.015 0.07" numOctaves="2" seed="4" result="t"><animate attributeName="baseFrequency" dur="2.4s" values="0.015 0.07;0.02 0.09;0.015 0.07" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="t" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>
<clipPath id="cWin"><rect x="52" y="62" width="158" height="152" rx="8"/></clipPath>
</defs>`;
// wall decoration for scenes with empty wall: a shelf with jars and a plant, or a rail with hanging utensils
const kShelf = (x, y, w = 88) => `<g>${kShadow(x + w / 2, y + 10, w / 2, 3, .22)}
  <rect x="${x}" y="${y}" width="${w}" height="7" rx="2" fill="#B98A55"/><rect x="${x}" y="${y}" width="${w}" height="2.5" rx="1" fill="#E9C48E"/>
  <rect x="${x + 6}" y="${y - 38}" width="25" height="38" rx="5" fill="#F6F0E2" stroke="#D5C9AE"/><rect x="${x + 5}" y="${y - 44}" width="27" height="9" rx="3" fill="#C0584B"/>
  <rect x="${x + 37}" y="${y - 29}" width="22" height="29" rx="5" fill="#E8F1E4" stroke="#C3D4BB"/><rect x="${x + 36}" y="${y - 34}" width="24" height="8" rx="3" fill="#6C9A5B"/>
  <path d="M${x + 66} ${y} l-3 -13 h22 l-3 13 Z" fill="#C97F4A"/>
  <path d="M${x + 74} ${y - 13} q-12 -12 -4 -26 q10 8 4 26 M${x + 74} ${y - 13} q10 -10 19 -4 q-8 10 -19 4 M${x + 74} ${y - 13} q-2 -16 8 -24 q4 12 -8 24" fill="#5E9B4E"/></g>`;
const kRail = () => `<g><rect x="26" y="34" width="268" height="6" rx="3" fill="#9AA6BB"/><rect x="26" y="34" width="268" height="2" rx="1" fill="#fff" opacity=".6"/>
  <g transform="translate(78 40)"><path d="M0 0 v8" stroke="#8794A8" stroke-width="2"/><rect x="-2.5" y="8" width="5" height="40" rx="2.5" fill="#6B4A2F"/><ellipse cx="0" cy="58" rx="13" ry="12" fill="#C9D1DF" stroke="#8E9AB0"/></g>
  <g transform="translate(130 40)"><path d="M0 0 v8" stroke="#8794A8" stroke-width="2"/><rect x="-2.5" y="8" width="5" height="34" rx="2.5" fill="#6B4A2F"/><rect x="-11" y="42" width="22" height="26" rx="4" fill="#C9D1DF" stroke="#8E9AB0"/><path d="M-5 48 v14 M0 48 v14 M5 48 v14" stroke="#8E9AB0" stroke-width="1.5"/></g>
  <g transform="translate(184 40)"><path d="M0 0 v8" stroke="#8794A8" stroke-width="2"/><rect x="-2.5" y="8" width="5" height="30" rx="2.5" fill="#6B4A2F"/><path d="M-12 38 q0 28 12 32 q12 -4 12 -32 Z" fill="none" stroke="#8E9AB0" stroke-width="2"/><path d="M-6 40 v26 M0 40 v30 M6 40 v26" stroke="#8E9AB0" stroke-width="1.2"/></g>
  <g transform="translate(236 40)"><path d="M0 0 v8" stroke="#8794A8" stroke-width="2"/><rect x="-2.5" y="8" width="5" height="36" rx="2.5" fill="#6B4A2F"/><ellipse cx="0" cy="54" rx="9" ry="12" fill="#B98A55" stroke="#8A6234"/></g></g>`;
const kBack = (deco) => `<rect width="320" height="340" fill="url(#gWall)"/><rect width="320" height="258" fill="url(#pTile)"/><rect width="320" height="340" fill="url(#gVig)"/>
<polygon points="236,0 320,0 320,120 176,0" fill="#fff" opacity=".18"/>
<rect y="254" width="320" height="86" fill="url(#gWood)"/><rect y="254" width="320" height="86" fill="url(#pGrain)"/>
<rect y="254" width="320" height="4" fill="#7A4F25" opacity=".45"/><rect y="258" width="320" height="2" fill="#F6DDAE" opacity=".7"/>${deco === "rail" ? kRail() : deco ? kShelf(12, 108) : ""}`;
const kShadow = (cx, cy, rx, ry, o = .3) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#2A1A08" opacity="${o}" filter="url(#fBlur4)"/>`;
function kMount(inner){ $('kScene').innerHTML = '<svg viewBox="0 0 320 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + KDEFS + inner + '</svg>'; }
const KSCENE = {};

/* --- running a scene: stop everything, mount a fresh SVG, then play the timeline --- */
function kStop(){
  K.run++; K.timers.forEach(clearTimeout); K.timers = []; clearInterval(K.clock);
  K.stops.forEach(s => { try{ s(); }catch(e){} }); K.stops = []; K.loops.forEach(l => { try{ l.cancel(); }catch(e){} }); K.loops = []; kFxClear();
}
const kMsg = t => { $('kMsg').textContent = t; };
function kReset(action, f){
  kStop(); const sc = $('kScene'); sc.className = 'kscene ' + action; kMount((KSCENE[action] || KSCENE.heat)(f || { e: '', n: '' }));
  K.ready = false; K.sent = new Set(); K.called = false; K.withCall = false; kRenderSend();
}
// timeline tools for one run: z = wait, a = animate an element and wait for it, loop = a repeating animation (stopped on reset)
function kTools(T, run){
  const alive = () => run === K.run;
  const z = ms => new Promise(res => { K.timers.push(setTimeout(res, Math.max(0, ms * T))); });
  const a = (el, kf, ms, o = {}) => { if (!el || !alive()) return Promise.resolve(); try{ return el.animate(kf, { duration: Math.max(1, ms * T), easing: 'ease-in-out', fill: 'forwards', ...o }).finished.catch(() => {}); }catch(e){ return Promise.resolve(); } };
  const loop = (el, kf, ms, o = {}) => { try{ const an = el.animate(kf, { duration: ms, iterations: Infinity, easing: 'ease-in-out', ...o }); K.loops.push(an); return an; }catch(e){ return { cancel(){} }; } };
  return { alive, z, a, loop, T };
}
function kPlay(f){ const run = K.run; (async () => { try{ await (KRUN[f.a] || kHeat)(f, kTools(kSpeed(), run)); }catch(e){ console.error(e); } })(); }

/* ---------- microwave ---------- */
KSCENE.heat = f => kBack() + `
<g>${kShadow(131, 305, 56, 9, .32)}<ellipse cx="131" cy="299" rx="50" ry="10.5" fill="url(#gDish)" stroke="#C3CCDB" stroke-width="1.2"/><ellipse cx="131" cy="298" rx="36" ry="6.5" fill="none" stroke="#C3CCDB" stroke-width="1" opacity=".7"/></g>
<g id="mw" filter="url(#fShadow)">
  <rect x="26" y="36" width="268" height="206" rx="20" fill="url(#gSteel)" stroke="#9AA6BB" stroke-width="1.5"/>
  <rect x="32" y="41" width="256" height="9" rx="4.5" fill="#fff" opacity=".6"/>
  <rect x="38" y="240" width="30" height="8" rx="3" fill="#7F8BA1"/><rect x="252" y="240" width="30" height="8" rx="3" fill="#7F8BA1"/>
  <rect x="40" y="50" width="182" height="176" rx="12" fill="#262C3B"/>
  <rect x="52" y="62" width="158" height="152" rx="8" fill="url(#gInt)"/>
  <g clip-path="url(#cWin)">
    <polygon id="cone" points="100,66 162,66 200,214 62,214" fill="url(#gBulb)" opacity="0" filter="url(#fBlur4)"/>
    <ellipse id="bulb" cx="131" cy="72" rx="46" ry="22" fill="url(#gBulb)" opacity="0"/>
    <g transform="translate(131 206) scale(1 .2)"><g id="spin"><circle r="66" fill="#fff" fill-opacity=".12" stroke="#fff" stroke-opacity=".45" stroke-width="2.5"/><circle r="47" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/><circle cx="54" r="4.5" fill="#fff" fill-opacity=".8"/><circle cx="-27" cy="47" r="4.5" fill="#fff" fill-opacity=".8"/><circle cx="-27" cy="-47" r="4.5" fill="#fff" fill-opacity=".8"/></g></g>
    <ellipse cx="131" cy="204" rx="30" ry="5.5" fill="#000" opacity=".4" filter="url(#fBlur2)"/>
    <g id="foodInG" style="transform:translate(131px,172px) scale(.84);opacity:0"><g id="foodSway"><text id="kFoodIn" ${kTxt} font-size="54">${f.e}</text></g></g>
  </g>
  <rect x="232" y="50" width="54" height="176" rx="10" fill="#E6EBF3" stroke="#B5BFD1"/>
  <rect x="238" y="58" width="42" height="24" rx="5" fill="#0B120E" stroke="#26372C"/>
  <text id="kClock" x="259" y="75.5" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="14" font-weight="700" fill="#3F7050">0:00</text>
  ${[98, 114, 130].map(y => [244, 259, 274].map(x => `<circle cx="${x}" cy="${y}" r="5.5" fill="url(#gKey)" stroke="#9AA6BB" stroke-width=".8"/>`).join('')).join('')}
  <rect x="240" y="150" width="38" height="16" rx="8" fill="#E2574C"/><rect x="243" y="152" width="32" height="5" rx="2.5" fill="#fff" opacity=".35"/>
  <rect x="240" y="172" width="38" height="14" rx="7" fill="#9AA6BB"/>
  ${[196, 202, 208, 214].map(y => `<rect x="242" y="${y}" width="34" height="2.2" rx="1.1" fill="#AAB4C6"/>`).join('')}
</g>
<g id="door" style="transform-origin:40px 0;transform:scaleX(.07)">
  <rect x="52" y="62" width="158" height="152" rx="8" fill="url(#gGlass)"/>
  <rect x="52" y="62" width="158" height="152" rx="8" fill="url(#pMesh)" opacity=".55"/>
  <g clip-path="url(#cWin)"><g id="refl" opacity="0"><polygon points="40,62 74,62 26,214 -8,214" fill="#fff" opacity=".28"/><polygon points="82,62 92,62 44,214 34,214" fill="#fff" opacity=".18"/></g></g>
  <rect x="52" y="62" width="158" height="152" rx="8" fill="none" stroke="#fff" stroke-opacity=".25"/>
  <rect x="213" y="86" width="7" height="104" rx="3.5" fill="#C7CFDD"/><rect x="214.5" y="88" width="2" height="100" rx="1" fill="#fff" opacity=".8"/>
</g>
<g id="foodOutG" style="transform:translate(131px,300px) scale(0);opacity:0"><g id="foodBob"><text id="kFood" ${kTxt} font-size="58">${f.e}</text></g></g>`;

async function kHeat(f, c){
  const { alive, z, a, loop, T } = c, q = kq;
  const out = q('#foodOutG'), inn = q('#foodInG'), door = q('#door'), bulb = q('#bulb'), cone = q('#cone'), spin = q('#spin'), mw = q('#mw'), clk = q('#kClock'), refl = q('#refl'), sway = q('#foodSway'), bob = q('#foodBob');
  if (!out || !f.e) return;
  const OUT = (y, s = 1, sy = s) => kTx(131, y, s, sy), INN = (y, s = .84, sy = s) => kTx(131, y, s, sy);
  const shake = () => a(mw, [{ transform: 'translate(0,0)' }, { transform: 'translate(-1.6px,.8px)' }, { transform: 'translate(1.3px,-.5px)' }, { transform: 'translate(-.6px,.2px)' }, { transform: 'translate(0,0)' }], 170);
  kMsg(`מחממים: ${f.n}`);
  // 1. the food appears on the counter, with a little overshoot
  kSND.pop();
  await a(out, [{ transform: OUT(304, 0), opacity: 0 }, { transform: OUT(272, 1.22, .92), opacity: 1, offset: .55 }, { transform: OUT(284), opacity: 1 }], 430, { easing: 'cubic-bezier(.25,.9,.35,1)' });
  if (!alive()) return; await z(150);
  // 2. it jumps into the open microwave and lands on the plate
  kSND.whoosh();
  await a(out, [{ transform: OUT(284) }, { transform: OUT(146, .98, 1.07), offset: .5 }, { transform: OUT(172, .84) }], 520, { easing: 'cubic-bezier(.4,0,.3,1)' });
  if (!alive()) return;
  out.style.visibility = 'hidden'; inn.style.opacity = 1; kSND.thud();
  await a(inn, [{ transform: INN(172) }, { transform: INN(177, .96, .72), offset: .35 }, { transform: INN(170, .8, .9), offset: .7 }, { transform: INN(172) }], 280, { easing: 'ease-out' });
  if (!alive()) return; await z(80);
  // 3. the door swings shut and the whole oven shudders
  kSND.clunk();
  const closing = a(door, [{ transform: 'scaleX(.07)' }, { transform: 'scaleX(1.04)', offset: .72 }, { transform: 'scaleX(1)' }], 460, { easing: 'ease-in' });
  await z(330); shake(); await closing; if (!alive()) return; await z(120);
  // 4. cooking: light on, plate turning, the display counts down, steam curls off the food
  clk.setAttribute('fill', '#7CFF8B'); clk.setAttribute('filter', 'url(#fGlowG)'); clk.textContent = '0:20';
  const t0 = performance.now(), dur = 3400 * T; K.clock = setInterval(() => { const left = Math.max(0, Math.ceil(20 * (1 - (performance.now() - t0) / dur))); clk.textContent = `0:${pad(left)}`; }, 100);
  kHold(kSND.hum(3.5 * T, 96));
  a(bulb, [{ opacity: 0 }, { opacity: .95 }], 350); a(cone, [{ opacity: 0 }, { opacity: .75 }], 350); refl.style.opacity = 1;
  const L = [loop(spin, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], 2600, { easing: 'linear' }),
    loop(sway, [{ transform: 'translateX(-4px) rotate(-3deg)' }, { transform: 'translateX(4px) rotate(3deg)' }], 1300, { direction: 'alternate' }),
    loop(bulb, [{ opacity: .95 }, { opacity: .78 }, { opacity: 1 }], 700, { direction: 'alternate' }),
    loop(refl, [{ transform: 'translateX(-40px)' }, { transform: 'translateX(220px)' }], 2000, { easing: 'ease-in-out' })];
  for (let i = 0; i < 22 && alive(); i++){ kPuff(131 + kRnd(-20, 20), 152, { clip: [52, 62, 158, 152], vy: kRnd(-26, -16), r0: 3, r1: 10, a: .3, life: 1.1 }); await z(155); }
  if (!alive()) return;
  // 5. ding! the door springs open in a cloud of steam
  clearInterval(K.clock); clk.textContent = '0:00'; clk.removeAttribute('filter'); clk.setAttribute('fill', '#3F7050');
  L.forEach(l => l.cancel()); a(bulb, [{ opacity: .9 }, { opacity: 0 }], 300); a(cone, [{ opacity: .7 }, { opacity: 0 }], 300);
  kSND.ding(); a(clk, [{ opacity: 1 }, { opacity: .15 }, { opacity: 1 }, { opacity: .15 }, { opacity: 1 }], 700); await z(560); if (!alive()) return;
  kSND.clunk(); shake();
  a(door, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.02)', offset: .65 }, { transform: 'scaleX(.07)' }], 520, { easing: 'cubic-bezier(.3,1.3,.5,1)' });
  for (let i = 0; i < 14; i++) kPuff(131 + kRnd(-56, 56), kRnd(150, 205), { vx: kRnd(-18, 18), vy: kRnd(-52, -30), r0: 9, r1: 34, a: .62, life: 1.9 });
  await z(260); if (!alive()) return;
  // 6. the food comes out onto the plate and lands with a squash
  inn.style.opacity = 0; out.style.visibility = 'visible'; kSND.whoosh();
  await a(out, [{ transform: OUT(172, .84) }, { transform: OUT(238, 1.04, .96), offset: .55 }, { transform: OUT(289, 1.14, .82), offset: .82 }, { transform: OUT(284) }], 560, { easing: 'cubic-bezier(.4,0,.6,1)' });
  if (!alive()) return; kSND.thud(); kFlourish(131, 262); kDone();
  loop(bob, [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }], 900, { direction: 'alternate' });
  for (let i = 0; i < 10 && alive(); i++){ kPuff(131 + kRnd(-16, 16), 262, { vx: kRnd(-5, 5), vy: kRnd(-24, -14), r0: 4, r1: 14, a: .4, life: 1.6 }); await z(260); }
}

/* ---------- cutting board: the knife really slices the food, the pieces separate and juice flies ---------- */
KSCENE.cut = f => kBack(1) + `
<g>${kShadow(160, 284, 136, 12, .36)}
<g id="boardG" filter="url(#fShadow)">
  <rect x="28" y="208" width="264" height="70" rx="14" fill="#B58447"/>
  <rect x="28" y="196" width="264" height="74" rx="14" fill="url(#gBoard)"/>
  <rect x="28" y="196" width="264" height="74" rx="14" fill="url(#pGrain)" opacity=".5"/>
  <rect x="34" y="199" width="252" height="5" rx="2.5" fill="#fff" opacity=".42"/>
</g></g>
<g id="foodRoot" style="transform:translate(160px,-70px)"><g id="foodHop"><text id="kFood" ${kTxt} font-size="110">${f.e}</text></g></g>
<g id="knifeG" style="transform:translate(160px,70px)">
  <path d="M-8 -84 L8 -84 L8 -6 L0 3 L-8 -6 Z" fill="url(#gBlade)" stroke="#7F8CA0" stroke-width=".8"/>
  <path d="M-8 -6 L0 3 L8 -6" fill="none" stroke="#fff" stroke-width="1.4" opacity=".9"/>
  <rect x="-10" y="-94" width="20" height="11" rx="2.5" fill="#8794A8"/>
  <rect x="-12" y="-150" width="24" height="58" rx="9" fill="url(#gHandle)"/>
  <circle cx="0" cy="-136" r="2.8" fill="#D9DEE8"/><circle cx="0" cy="-116" r="2.8" fill="#D9DEE8"/>
  <rect x="-7" y="-148" width="3" height="52" rx="1.5" fill="#fff" opacity=".18"/>
</g>`;

// the real pixel bounds of an emoji, measured on an offscreen canvas (an SVG text box includes side bearings, so it is not where the ink is)
// returned relative to the text anchor: x from the centre, y from the baseline
function kInk(e, size){
  try{
    const W = Math.ceil(size * 2), H = Math.ceil(size * 2), base = Math.round(H * .62), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.font = `${size}px sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'alphabetic'; cx.fillText(e, W / 2, base);
    const d = cx.getImageData(0, 0, W, H).data; let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 24){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < x0 ? null : { x: x0 - W / 2, w: x1 - x0 + 1, y: y0 - base, h: y1 - y0 + 1 };
  }catch(e){ return null; }
}

async function kCut(f, c){
  const { alive, z, a } = c, root = kq('#foodRoot'), hop = kq('#foodHop'), knife = kq('#knifeG'), boardG = kq('#boardG'), main = kq('#kFood');
  if (!root || !main || !f.e) return;
  const NS = 'http://www.w3.org/2000/svg', svg = root.ownerSVGElement, defs = svg.querySelector('defs'), SIZE = 110;
  // the emoji's real size and position (SVG puts the baseline .36em below the anchor, hence the offsets)
  const ink = kInk(f.e, SIZE), bb = main.getBBox();
  const ix = ink ? ink.x : bb.x, iw = ink ? ink.w : bb.width, iy = ink ? SIZE * .36 + ink.y : bb.y, ih = ink ? ink.h : bb.height;
  const N = 4, wS = iw / N, cxInk = ix + iw / 2, RX = 160 - cxInk;           // RX puts the ink in the middle of the board
  const edge = i => i === 0 ? ix - 6 : ix + i * wS, slices = [], sx = Array(N).fill(0);
  for (let i = 0; i < N; i++){
    const x0 = edge(i), x1 = i === N - 1 ? ix + iw + 6 : edge(i + 1);
    const cp = document.createElementNS(NS, 'clipPath'); cp.setAttribute('id', 'cs' + i); const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x0 - (i ? .5 : 0)); r.setAttribute('y', iy - 8); r.setAttribute('width', x1 - x0 + (i ? .5 : 0) + (i < N - 1 ? .5 : 0)); r.setAttribute('height', ih + 16); cp.append(r); defs.append(cp);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('clip-path', `url(#cs${i})`); g.style.transformOrigin = `${(x0 + x1) / 2}px ${iy + ih}px`;
    const t = main.cloneNode(true); t.removeAttribute('id'); g.append(t); hop.append(g); slices.push(g);
  }
  main.setAttribute('opacity', '0');
  const col = KCOLOR.get(f.e) || '#FFB74D', bottom = 205 + iy + ih;           // the board surface under the food
  kMsg(`חותכים: ${f.n}`);
  // the food drops onto the board and bounces
  await a(root, [{ transform: kTx(RX, -90) }, { transform: kTx(RX, 214, 1.1, .88), offset: .6 }, { transform: kTx(RX, 197, .98, 1.05), offset: .8 }, { transform: kTx(RX, 205) }], 560, { easing: 'cubic-bezier(.45,0,.6,1)' });
  if (!alive()) return; kSND.thud(); await z(140);
  let kx = 160, ky = 70; const P = (px, py, r) => `translate(${px}px,${py}px) rotate(${r}deg)`;
  for (let i = 1; i < N; i++){
    const x = RX + edge(i);
    await a(knife, [{ transform: P(kx, ky, 0) }, { transform: P(x, 100, -3) }], i === 1 ? 420 : 210, { easing: 'cubic-bezier(.3,0,.2,1)' });   // glide over the next cut
    await a(knife, [{ transform: P(x, 100, -3) }, { transform: P(x, 84, -8) }], 110, { easing: 'ease-out' });                                       // lift and lean back
    await a(knife, [{ transform: P(x, 84, -8) }, { transform: P(x, bottom + 2, 0) }], 80, { easing: 'cubic-bezier(.7,0,1,1)' });                      // strike
    if (!alive()) return;
    kSND.chop(); kDrops(x, bottom - 22, 8, col, { spread: 1.15, min: 70, max: 190, floor: bottom + 6 });
    for (let j = i; j < N; j++){ const from = sx[j]; sx[j] += 3.4; a(slices[j], [{ transform: `translateX(${from}px)` }, { transform: `translateX(${sx[j]}px)` }], 170, { easing: 'ease-out' }); }
    a(boardG, [{ transform: 'translateY(0)' }, { transform: 'translateY(2.5px)' }, { transform: 'translateY(0)' }], 150);
    a(hop, [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }], 150);
    await a(knife, [{ transform: P(x, bottom + 2, 0) }, { transform: P(x, 100, -3) }], 170, { easing: 'ease-out' });
    kx = x; ky = 100;
  }
  // the knife leaves and the pieces fan out on the board
  a(knife, [{ transform: P(kx, 100, -3) }, { transform: P(kx + 80, -70, 20) }], 420, { easing: 'ease-in' });
  kSND.whoosh();
  for (let j = 0; j < N; j++){ const d = j - (N - 1) / 2; a(slices[j], [{ transform: `translateX(${sx[j]}px)` }, { transform: `translateX(${d * 17}px) rotate(${d * 4.5}deg)` }], 520, { easing: 'cubic-bezier(.3,1.5,.5,1)' }); }
  await z(560); if (!alive()) return;
  kFlourish(160, 215); kDone();
}

const kqa = s => [...$('kScene').querySelectorAll(s)];
// a wavy strip for a liquid surface (period wl, so sliding it by wl loops seamlessly), filled down to `depth`
function kWave(x0, x1, wl, amp, depth){ let d = `M${x0} 0 Q${x0 + wl / 4} ${-amp} ${x0 + wl / 2} 0`, x = x0 + wl / 2; while (x < x1 + wl){ x += wl / 2; d += ` T${x} 0`; } return `${d} L${x} ${depth} L${x0} ${depth} Z`; }
// the food twice: as it is, and toasted (cross-faded in while the food cooks)
const kFoodLayers = (e, size, id) => `<text ${id ? `id="${id}" ` : ''}class="pale" ${kTxt} font-size="${size}">${e}</text><text class="toasted" ${kTxt} font-size="${size}" filter="url(#fToast)" opacity="0">${e}</text>`;

/* ---------- toaster: slices drop in, the lever clunks down, the slots glow, a bar fills, they spring out toasted ---------- */
KSCENE.toasting = f => {
  const slot = x => `<rect x="${x - 34}" y="156" width="68" height="13" rx="6.5" fill="#161A22"/><rect id="sl${x}" x="${x - 30}" y="159" width="60" height="6" rx="3" fill="#FF6A2E" opacity="0" filter="url(#fGlowG)"/>`;
  const bread = (id, x) => `<g clip-path="url(#cBread)"><g id="${id}" style="transform:translate(${x}px,96px) scale(0)">${kFoodLayers(f.e, 66)}</g></g>`;
  return kBack(1) + `<clipPath id="cBread"><rect x="0" y="-120" width="320" height="290"/></clipPath>${kShadow(160, 258, 120, 10, .4)}
<g id="toaster" filter="url(#fShadow)">
  <rect x="64" y="246" width="26" height="9" rx="3" fill="#222733"/><rect x="230" y="246" width="26" height="9" rx="3" fill="#222733"/>
  <rect x="48" y="172" width="224" height="78" rx="22" fill="url(#gSteel)" stroke="#8E9AB0" stroke-width="1.5"/>
  <rect x="60" y="182" width="16" height="58" rx="8" fill="#fff" opacity=".5"/><rect x="82" y="182" width="5" height="58" rx="2.5" fill="#fff" opacity=".25"/>
  <path d="M74 146 H246 Q262 146 266 160 L272 182 Q273 190 265 190 H55 Q47 190 48 182 L54 160 Q58 146 74 146 Z" fill="url(#gSteelH)" stroke="#8E9AB0" stroke-width="1.5"/>
  <path d="M80 150 H240" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>
  ${slot(116)}${slot(204)}
  <g id="dial" style="transform-origin:92px 218px"><circle cx="92" cy="218" r="13" fill="url(#gKey)" stroke="#8E9AB0"/><rect x="90.5" y="207" width="3" height="9" rx="1.5" fill="#E2574C"/></g>
  <rect x="126" y="214" width="104" height="9" rx="4.5" fill="#8E9AB0" opacity=".45"/>
  <rect id="bar" x="126" y="214" width="104" height="9" rx="4.5" fill="#FF8A3D" style="transform-origin:126px 0;transform:scaleX(0)"/>
  <rect x="248" y="190" width="10" height="46" rx="5" fill="#2A303B"/>
  <g id="lever"><rect x="240" y="196" width="26" height="14" rx="5" fill="url(#gKey)" stroke="#8E9AB0"/></g>
</g>
${bread('bread1', 116)}${bread('bread2', 204)}<text id="kFood" ${kTxt} font-size="1" opacity="0">${f.e}</text>`;
};
async function kToast(f, c){
  const { alive, z, a } = c, q = kq;
  const b1 = q('#bread1'), b2 = q('#bread2'), lever = q('#lever'), tp = q('#toaster'), bar = q('#bar'), dial = q('#dial'), g1 = q('#sl116'), g2 = q('#sl204');
  if (!b1 || !f.e) return;
  const B = (x, y, s = 1, sy = s) => kTx(x, y, s, sy), EASE = 'cubic-bezier(.3,1.3,.5,1)';
  kMsg(`קולים: ${f.n}`);
  // the slices pop up above the slots
  kSND.pop(); a(b1, [{ transform: B(116, 96, 0) }, { transform: B(116, 96, 1.16), offset: .6 }, { transform: B(116, 100) }], 380, { easing: EASE });
  await z(130); kSND.pop(); await a(b2, [{ transform: B(204, 96, 0) }, { transform: B(204, 96, 1.16), offset: .6 }, { transform: B(204, 100) }], 380, { easing: EASE });
  if (!alive()) return; await z(260);
  // they drop into the slots and the lever goes down with a clunk
  kSND.whoosh(); a(b1, [{ transform: B(116, 100) }, { transform: B(116, 218) }], 400, { easing: 'cubic-bezier(.5,0,.9,.55)' }); await z(70);
  await a(b2, [{ transform: B(204, 100) }, { transform: B(204, 218) }], 400, { easing: 'cubic-bezier(.5,0,.9,.55)' }); if (!alive()) return;
  kSND.clunk(); a(lever, [{ transform: 'translateY(0)' }, { transform: 'translateY(30px)', offset: .7 }, { transform: 'translateY(27px)' }], 300, { easing: 'ease-in' });
  a(tp, [{ transform: 'translateY(0)' }, { transform: 'translateY(2px)' }, { transform: 'translateY(0)' }], 220);
  await z(340); if (!alive()) return;
  // toasting: the slots glow, the dial turns, the bar fills; the slices darken while they are hidden
  kqa('.pale').forEach(t => t.setAttribute('opacity', 0)); kqa('.toasted').forEach(t => t.setAttribute('opacity', 1));
  [g1, g2].forEach(g => { g.style.transition = 'opacity .45s'; g.style.opacity = 1; });
  a(dial, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(250deg)' }], 3300, { easing: 'linear' }); a(bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 3300, { easing: 'linear' });
  for (let i = 0; i < 17 && alive(); i++){
    kNoise(.02, { type: 'bandpass', freq: 2600, vol: .03 }); [g1, g2].forEach(g => { g.style.opacity = (.72 + Math.random() * .28).toFixed(2); });
    if (i % 3 === 0) [116, 204].forEach(x => kPuff(x + kRnd(-8, 8), 160, { r0: 3, r1: 9, a: .16, vy: kRnd(-26, -16), col: '255,176,110', life: 1 }));
    await z(200);
  }
  if (!alive()) return;
  // done: the lever springs up, the toaster jumps and the toast pops out in a shower of crumbs
  [g1, g2].forEach(g => { g.style.transition = 'opacity .2s'; g.style.opacity = 0; });
  kSND.ding(); kSND.clunk();
  a(lever, [{ transform: 'translateY(27px)' }, { transform: 'translateY(-5px)', offset: .6 }, { transform: 'translateY(0)' }], 320, { easing: 'ease-out' });
  a(tp, [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }], 240);
  a(b1, [{ transform: B(116, 218) }, { transform: B(116, 128), offset: .55 }, { transform: B(116, 154) }], 560, { easing: 'cubic-bezier(.2,.9,.3,1.1)' }); await z(70);
  await a(b2, [{ transform: B(204, 218) }, { transform: B(204, 128), offset: .55 }, { transform: B(204, 154) }], 560, { easing: 'cubic-bezier(.2,.9,.3,1.1)' });
  [116, 204].forEach(x => { kCrumbs(x, 172, 9, '#C98F4A', { floor: 180 }); for (let i = 0; i < 3; i++) kPuff(x + kRnd(-10, 10), 150, { col: '150,130,110', a: .26, r0: 4, r1: 14, vy: kRnd(-30, -18), life: 1.5 }); });
  kFlourish(160, 132); kDone();
  for (let i = 0; i < 8 && alive(); i++){ [116, 204].forEach(x => kPuff(x + kRnd(-10, 10), 140, { a: .22, r0: 4, r1: 13, vy: kRnd(-24, -14), life: 1.5 })); await z(300); }
}

/* ---------- pouring: a pitcher tips, a stream splashes into the glass, the surface ripples; hot drinks steam ---------- */
KSCENE.pour = f => {
  const col = f.c || '#FFA726', glass = 'M138 172 L146 256 Q147 263 154 263 L198 263 Q205 263 206 256 L214 172 Z', inner = 'M141.5 176 L149 255 Q150 259 155 259 L197 259 Q202 259 203 255 L210.5 176 Z';
  return kBack(1) + `<clipPath id="cGlass"><path d="${inner}"/></clipPath>${kShadow(176, 267, 54, 7, .38)}
<path d="${glass}" fill="#fff" fill-opacity=".2"/>
<g clip-path="url(#cGlass)"><g id="liq" style="transform:translateY(66px)">
  <rect x="120" y="198" width="120" height="90" fill="${col}"/><rect x="120" y="198" width="120" height="90" fill="url(#gLiq)"/>
  <g transform="translate(0 198)"><g id="wave2"><path d="${kWave(80, 270, 30, 2.6, 14)}" fill="#fff" opacity=".3"/></g></g>
  <g transform="translate(0 198)"><g id="wave1"><path d="${kWave(80, 270, 30, 3.2, 14)}" fill="${col}"/></g></g>
</g></g>
<g id="streamG" style="transform-origin:180.5px 112px;transform:scaleY(0);opacity:0"><rect x="178" y="112" width="5" height="150" rx="2.5" fill="${col}" stroke="#000" stroke-opacity=".08" stroke-width=".6"/><rect x="179" y="112" width="1.5" height="150" rx=".8" fill="#fff" opacity=".45"/></g>
<path d="${glass}" fill="none" stroke="#fff" stroke-width="1.8" opacity=".9"/><path d="${glass}" fill="none" stroke="#9FB4D4" stroke-width=".8" opacity=".55"/>
<path d="M144 180 L151 250" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/><path d="M208 182 L203 224" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".35"/>
<ellipse cx="176" cy="172" rx="38" ry="5" fill="none" stroke="#fff" stroke-width="1.6" opacity=".9"/><ellipse cx="176" cy="262" rx="29" ry="4" fill="#fff" opacity=".25"/>
<g id="pitcher" style="transform:translate(228px,100px) rotate(0deg)" filter="url(#fShadow)"><g transform="scale(.86)">
  <path d="M12 8 L72 8 L72 80 Q72 94 58 94 L26 94 Q12 94 12 80 Z" fill="url(#gSteel)" stroke="#B2BCCD" stroke-width="1.2"/>
  <path d="M13 6 Q4 6 -2 -1 Q8 14 13 22 Z" fill="#EEF2F8" stroke="#B2BCCD" stroke-width="1"/>
  <path d="M72 22 Q96 24 96 50 Q96 74 72 76" fill="none" stroke="#D7DEE9" stroke-width="8" stroke-linecap="round"/>
  <rect x="12" y="40" width="60" height="24" fill="${col}"/><rect x="16" y="12" width="9" height="76" rx="4.5" fill="#fff" opacity=".5"/><ellipse cx="42" cy="8" rx="30" ry="4" fill="#98A4BA" opacity=".35"/>
</g></g>
<g id="badge" style="transform:translate(66px,238px) scale(0)"><circle r="27" fill="#fff" opacity=".9" stroke="#E4DCCB"/><text id="kFood" ${kTxt} font-size="32">${f.e}</text></g>`;
};
async function kPour(f, c){
  const { alive, z, a, loop } = c, q = kq, col = f.c || '#FFA726';
  const pit = q('#pitcher'), stream = q('#streamG'), liq = q('#liq'), w1 = q('#wave1'), w2 = q('#wave2'), badge = q('#badge');
  if (!pit || !f.e) return;
  const hot = /[☕🍵]/.test(f.e) && !/קר|iced|cold/i.test(f.n), IDLE = 'translate(228px,100px) rotate(0deg)', POUR = 'translate(182px,114px) rotate(-104deg)', POUR_MS = 2700;
  kMsg(`שופכים: ${f.n}`); await z(250);
  // the pitcher leans back a little, then tips over the glass
  kSND.whoosh();
  await a(pit, [{ transform: IDLE }, { transform: 'translate(236px,104px) rotate(8deg)', offset: .22 }, { transform: POUR }], 680, { easing: 'cubic-bezier(.4,0,.2,1)' });
  if (!alive()) return;
  // a stream runs into the glass and the liquid rises while its surface ripples
  stream.style.opacity = 1; a(stream, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(.98)' }], 170, { easing: 'ease-in' }); await z(160);
  loop(w1, [{ transform: 'translateX(0)' }, { transform: 'translateX(-30px)' }], 1000, { easing: 'linear' }); loop(w2, [{ transform: 'translateX(-12px)' }, { transform: 'translateX(-42px)' }], 1500, { easing: 'linear' });
  kSND.glug(10);
  const rise = a(liq, [{ transform: 'translateY(66px)' }, { transform: 'translateY(0)' }], POUR_MS, { easing: 'linear' });
  a(stream, [{ transform: 'scaleY(.98)' }, { transform: 'scaleY(.57)' }], POUR_MS, { easing: 'linear' });
  for (let i = 0; i < 18 && alive(); i++){
    const surf = Math.min(259, 198 + 66 * (1 - Math.min(1, i * 150 / POUR_MS)));
    kDrops(180.5, surf - 1, 2, col, { spread: .8, min: 25, max: 85, g: 420, floor: surf + 1, clip: [138, 150, 76, 115] });
    if (i % 2 === 0) kBubble(kRnd(150, 205), surf + 3, { col: 'rgba(255,255,255,.9)', clip: [141, 176, 69, 86] });
    await z(150);
  }
  await rise; if (!alive()) return;
  // the stream stops and the pitcher swings back
  a(stream, [{ opacity: 1 }, { opacity: 0 }], 140);
  await a(pit, [{ transform: POUR }, { transform: 'translate(238px,98px) rotate(7deg)', offset: .62 }, { transform: IDLE }], 620, { easing: 'cubic-bezier(.3,1.2,.5,1)' });
  if (!alive()) return;
  // ripples settle, the glass clinks, the drink gets its badge
  a(liq, [{ transform: 'translateY(0)' }, { transform: 'translateY(2.5px)' }, { transform: 'translateY(-1px)' }, { transform: 'translateY(0)' }], 600);
  kSND.clink(); kFlourish(176, 196); kDone();
  a(badge, [{ transform: kTx(66, 238, 0) }, { transform: kTx(66, 232, 1.2), offset: .6 }, { transform: kTx(66, 238, 1) }], 420, { easing: 'cubic-bezier(.3,1.3,.5,1)' });
  for (let i = 0; i < 14 && alive(); i++){
    if (hot) kPuff(176 + kRnd(-16, 16), 168, { vy: kRnd(-30, -18), a: .32, r0: 4, r1: 16, life: 1.6 });
    await z(260);
  }
}

/* ---------- frying: gas flames under a pan, the food drops in and sizzles, flips once; an egg cracks open ---------- */
KSCENE.fry = f => {
  const egg = f.e === '🥚', fl = i => `<path class="fl" d="M0 0 Q-6 -9 -2 -17 Q1 -10 3 -19 Q8 -9 0 0Z" fill="url(#gFlame)" style="transform:translate(${64 + i * 28}px,262px) scale(1.5);opacity:0"/>`;
  return kBack("rail") + `
<g id="stove">
  <rect x="14" y="236" width="292" height="104" rx="10" fill="url(#gSteel)" stroke="#8E9AB0" stroke-width="1.3"/>
  <rect x="14" y="236" width="292" height="32" rx="10" fill="url(#gHob)"/><rect x="22" y="240" width="276" height="4" rx="2" fill="#fff" opacity=".14"/>
  ${[52, 112, 208, 268].map(x => `<circle cx="${x}" cy="304" r="12" fill="url(#gKnob)" stroke="#6F7B90"/><rect x="${x - 1.4}" y="294" width="2.8" height="9" rx="1.4" fill="#fff"/>`).join('')}
</g>
<g id="flames">${[0, 1, 2, 3, 4, 5, 6].map(fl).join('')}</g>
<g id="pan" style="transform-origin:236px 208px;transform:rotate(0deg)">
  <path d="M232 205 L306 190 Q314 188 316 195 L314 201 Q312 206 304 207 L238 221 Z" fill="#3A3F4B" stroke="#1D2129" stroke-width="1"/><path d="M236 206 L306 192" stroke="#fff" stroke-width="1.6" opacity=".22"/>
  <path d="M42 206 L46 224 Q140 254 234 224 L238 206 Z" fill="url(#gPanW)" stroke="#1D2129" stroke-width="1"/>
  <ellipse cx="140" cy="206" rx="98" ry="28" fill="#444B58"/><ellipse cx="140" cy="207" rx="90" ry="23" fill="url(#gPanIn)"/>
  <ellipse cx="140" cy="210" rx="76" ry="17" fill="#FFD36B" opacity=".09"/><path d="M60 196 Q140 178 220 196" stroke="#fff" stroke-width="2" fill="none" opacity=".22"/>
</g>
<ellipse id="foodShadow" cx="140" cy="216" rx="27" ry="6" fill="#000" filter="url(#fBlur2)" style="opacity:0"/>
${egg ? `<g id="eggG" style="transform:translate(140px,208px) scale(0)"><path d="M-48 2 C-52 -22 -22 -34 2 -30 C28 -36 54 -22 50 0 C56 22 26 32 -2 28 C-28 34 -54 26 -48 2 Z" fill="#fff" stroke="#E9E4D8" stroke-width="1"/><path d="M-40 8 C-38 22 -10 26 8 24" fill="none" stroke="#000" stroke-opacity=".06" stroke-width="5"/><g id="yolk" style="transform-origin:4px -4px"><circle cx="4" cy="-4" r="15" fill="url(#gYolk)"/><circle cx="-1" cy="-9" r="4" fill="#fff" opacity=".6"/></g></g>` : ''}
<g id="foodG" style="transform:translate(140px,-60px) scale(1,1) rotate(0deg)">${kFoodLayers(f.e, 58, 'kFood')}</g>`;
};
async function kFry(f, c){
  const { alive, z, a, loop } = c, q = kq, egg = f.e === '🥚';
  const foodG = q('#foodG'), pan = q('#pan'), fsh = q('#foodShadow'), eggG = q('#eggG'), yolk = q('#yolk'), tone = q('.toasted');
  if (!foodG || !f.e) return;
  const FT = (y, sx = 1, sy = sx, r = 0) => `translate(140px,${y}px) scale(${sx},${sy}) rotate(${r}deg)`;
  kMsg(`מטגנים: ${f.n}`);
  // gas on: the flames flicker up
  kSND.whoosh(); kqa('.fl').forEach((el, i) => { const x = 64 + i * 28; el.style.transition = 'opacity .4s'; el.style.opacity = 1;
    loop(el, [{ transform: `translate(${x}px,262px) scale(1.5,1.2)` }, { transform: `translate(${x}px,262px) scale(1.5,1.7)` }, { transform: `translate(${x}px,262px) scale(1.3,1.35)` }], 260 + (i % 3) * 90, { direction: 'alternate', delay: i * 40 }); });
  await z(500); if (!alive()) return;
  if (egg){
    await a(foodG, [{ transform: FT(-60) }, { transform: FT(152) }], 430, { easing: 'cubic-bezier(.5,0,.9,.5)' });
    if (!alive()) return; kSND.crack(); kCrumbs(140, 160, 12, '#F1E4CF', { floor: 236 }); foodG.style.opacity = 0;
    a(eggG, [{ transform: kTx(140, 208, .12, .08) }, { transform: kTx(140, 208, 1.08, 1.1), offset: .7 }, { transform: kTx(140, 208, 1, 1) }], 620, { easing: 'ease-out' });
    a(yolk, [{ transform: 'translateY(-44px) scale(.7)', opacity: 0 }, { transform: 'translateY(4px) scale(1.12,.84)', opacity: 1, offset: .6 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], 720, { easing: 'ease-out' });
  } else {
    await a(foodG, [{ transform: FT(-60) }, { transform: FT(214, 1.12, .86), offset: .62 }, { transform: FT(196, .97, 1.05), offset: .8 }, { transform: FT(203) }], 620, { easing: 'cubic-bezier(.45,0,.6,1)' });
    if (!alive()) return; kSND.thud();
  }
  a(fsh, [{ opacity: 0 }, { opacity: .5 }], 300); kDrops(140, 206, 10, '#FFD36B', { spread: 1.3, min: 50, max: 150, g: 500, floor: 246 });
  kHold(kSND.sizzle(3.6 * c.T));
  if (!egg){ tone.setAttribute('opacity', 0); a(tone, [{ opacity: 0 }, { opacity: 1 }], 2600, { easing: 'linear' }); }
  // sizzling: oil bubbles, spatter and steam; the food flips once halfway
  for (let i = 0; i < 26 && alive(); i++){
    kBubble(kRnd(76, 206), kRnd(200, 222), { col: 'rgba(255,240,200,.95)', r: kRnd(1.6, 3.6), life: kRnd(.5, .9), clip: [44, 184, 192, 52] });
    if (i % 4 === 0) kDrops(kRnd(100, 180), 204, 3, '#FFD36B', { spread: 1.2, min: 60, max: 140, g: 480, floor: 246 });
    if (i % 3 === 0) kPuff(140 + kRnd(-44, 44), 182, { vy: kRnd(-30, -18), a: .26, r0: 4, r1: 15, life: 1.4 });
    if (i === 11 && !egg){
      kSND.whoosh();
      a(pan, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-8deg)', offset: .3 }, { transform: 'rotate(2deg)', offset: .65 }, { transform: 'rotate(0deg)' }], 560);
      a(fsh, [{ opacity: .5 }, { opacity: .12 }, { opacity: .5 }], 700);
      a(foodG, [{ transform: FT(203) }, { transform: FT(78, 1.12, 1.12, 190), offset: .5 }, { transform: FT(210, 1.12, .84, 360), offset: .86 }, { transform: FT(203, 1, 1, 360) }], 700, { easing: 'cubic-bezier(.4,0,.6,1)' });
      await z(660); if (!alive()) return; kSND.thud(); kDrops(140, 208, 12, '#FFD36B', { spread: 1.4, min: 60, max: 170, g: 500, floor: 246 }); continue;
    }
    await z(115);
  }
  if (!alive()) return;
  kqa('.fl').forEach(el => { el.style.opacity = .55; });
  kFlourish(140, 190); kDone();
  for (let i = 0; i < 10 && alive(); i++){ kPuff(140 + kRnd(-34, 34), 186, { vy: kRnd(-26, -14), a: .3, r0: 4, r1: 15, life: 1.6 }); await z(280); }
}

/* ---------- blender: pieces tumble in, the lid clamps down, it whirls with a vortex, the jar fills and foams ---------- */
KSCENE.blend = f => {
  const col = f.c || '#F4B6C8', jar = 'M104 72 L118 218 Q119 226 127 226 L193 226 Q201 226 202 218 L216 72 Z', inner = 'M108 76 L121 216 Q122 222 128 222 L192 222 Q198 222 199 216 L212 76 Z';
  const piece = i => `<g id="pcw${i}" style="transform-origin:160px 176px"><g id="pc${i}" style="transform:translate(${[130, 154, 178, 192][i]}px,-40px)"><text ${kTxt} font-size="34">${f.e}</text></g></g>`;
  return kBack(1) + `<clipPath id="cJar"><path d="${inner}"/></clipPath>${kShadow(160, 267, 78, 8, .4)}
<g id="bl" filter="url(#fShadow)">
  <rect x="96" y="222" width="128" height="42" rx="14" fill="url(#gHob)" stroke="#1D2129"/><rect x="104" y="226" width="112" height="5" rx="2.5" fill="#fff" opacity=".18"/>
  <circle cx="126" cy="246" r="7" fill="url(#gKey)" stroke="#6F7B90"/><circle cx="158" cy="246" r="7" fill="url(#gKey)" stroke="#6F7B90"/><circle id="led" cx="194" cy="246" r="4" fill="#3A4150"/>
  <rect x="108" y="216" width="104" height="12" rx="5" fill="url(#gSteel)" stroke="#8E9AB0"/>
  <path d="${jar}" fill="#fff" fill-opacity=".22"/>
  <g clip-path="url(#cJar)">
    <g id="bliq" style="transform:translateY(150px)">
      <rect x="100" y="112" width="124" height="130" fill="${col}"/><rect x="100" y="112" width="124" height="130" fill="url(#gLiq)"/>
      <g id="vortex" opacity="0"><path d="M112 146 Q160 170 208 146" stroke="#fff" stroke-width="3.5" fill="none" opacity=".3"/><path d="M114 172 Q160 196 206 172" stroke="#fff" stroke-width="3" fill="none" opacity=".25"/><path d="M118 198 Q160 216 202 198" stroke="#fff" stroke-width="3" fill="none" opacity=".2"/></g>
      <ellipse id="foam" cx="160" cy="112" rx="50" ry="8" fill="#fff" opacity="0"/>
      <g transform="translate(0 112)"><g id="bw1"><path d="${kWave(80, 250, 36, 4, 22)}" fill="${col}"/></g></g>
    </g>
    <g style="transform:translate(160px,212px)"><g id="bladeSpin"><ellipse cx="-15" cy="0" rx="18" ry="3.4" fill="#C9D1DF" stroke="#8E9AB0" stroke-width=".6"/><ellipse cx="15" cy="0" rx="18" ry="3.4" fill="#C9D1DF" stroke="#8E9AB0" stroke-width=".6"/><rect x="-5" y="-4" width="10" height="8" rx="3" fill="#8E9AB0"/></g></g>
  </g>
  <path d="${jar}" fill="none" stroke="#fff" stroke-width="1.8" opacity=".9"/><path d="${jar}" fill="none" stroke="#9FB4D4" stroke-width=".8" opacity=".55"/>
  <path d="M118 90 L128 206" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/><path d="M206 92 L198 170" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".35"/>
</g>
${[0, 1, 2, 3].map(piece).join('')}
<g id="lid" style="transform-origin:160px 66px;transform:translateY(-90px)"><rect x="98" y="58" width="124" height="16" rx="8" fill="#2E3544"/><rect x="104" y="60" width="112" height="4" rx="2" fill="#fff" opacity=".18"/><rect x="146" y="46" width="28" height="14" rx="7" fill="#2E3544"/></g>
<g id="badge" style="transform:translate(50px,236px) scale(0)"><circle r="27" fill="#fff" opacity=".9" stroke="#E4DCCB"/><text id="kFood" ${kTxt} font-size="32">${f.e}</text></g>`;
};
async function kBlend(f, c){
  const { alive, z, a, loop } = c, q = kq;
  const lid = q('#lid'), liq = q('#bliq'), bw = q('#bw1'), bs = q('#bladeSpin'), vortex = q('#vortex'), bl = q('#bl'), badge = q('#badge'), led = q('#led'), foam = q('#foam');
  if (!lid || !f.e) return;
  const X = [130, 154, 178, 192], Y = [196, 186, 192, 178];
  kMsg(`טוחנים: ${f.n}`);
  // the pieces tumble into the open jar
  for (let i = 0; i < 4; i++){
    kSND.pop(); a(q('#pc' + i), [{ transform: kTx(X[i], -40, 1) }, { transform: kTx(X[i], Y[i] + 8, 1.1, .88), offset: .62 }, { transform: kTx(X[i] + (i % 2 ? 5 : -5), Y[i] - 6, .98, 1.04), offset: .82 }, { transform: kTx(X[i], Y[i]) }], 520, { easing: 'cubic-bezier(.45,0,.6,1)' });
    await z(180);
  }
  await z(360); if (!alive()) return;
  // the lid clamps down
  kSND.clunk(); await a(lid, [{ transform: 'translateY(-90px)' }, { transform: 'translateY(4px)', offset: .7 }, { transform: 'translateY(0)' }], 420, { easing: 'ease-in' });
  await z(150); if (!alive()) return;
  // whirl: the blades blur, the jar shakes, the pieces orbit and dissolve into liquid that rises
  kHold(kSND.motor(2.8 * c.T)); led.setAttribute('fill', '#FF5A4D');
  const L = [loop(bs, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.18)' }], 55, { direction: 'alternate', easing: 'linear' }), loop(bl, [{ transform: 'translateX(-1.3px)' }, { transform: 'translateX(1.3px)' }], 60, { direction: 'alternate', easing: 'linear' }),
    loop(bw, [{ transform: 'translateX(0)' }, { transform: 'translateX(-36px)' }], 420, { easing: 'linear' })];
  for (let i = 0; i < 4; i++){ L.push(loop(q('#pcw' + i), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], 420 + i * 90, { easing: 'linear' })); a(q('#pc' + i), [{ opacity: 1 }, { opacity: 0 }], 1300, { delay: (500 + i * 120) * c.T }); }
  vortex.setAttribute('opacity', 1); L.push(loop(vortex, [{ transform: 'translateY(-4px)' }, { transform: 'translateY(6px)' }], 300, { direction: 'alternate' }));
  a(liq, [{ transform: 'translateY(150px)' }, { transform: 'translateY(0)' }], 2400, { easing: 'ease-in-out' });
  for (let i = 0; i < 22 && alive(); i++){
    kBubble(kRnd(124, 196), kRnd(150, 214), { col: 'rgba(255,255,255,.9)', r: kRnd(2, 4), vy: kRnd(-60, -30), life: kRnd(.4, .8), clip: [108, 76, 104, 148] });
    if (i % 3 === 0) kDrops(kRnd(130, 190), 100, 2, f.c || '#F4B6C8', { dir: Math.PI / 2, spread: .8, min: 40, max: 110, g: 380, clip: [108, 76, 104, 148] });
    await z(115);
  }
  if (!alive()) return;
  // it stops: the blades slow, the surface wobbles, foam forms, the lid lifts
  L.forEach(l => l.cancel()); led.setAttribute('fill', '#3A4150'); vortex.setAttribute('opacity', 0);
  loop(bw, [{ transform: 'translateX(0)' }, { transform: 'translateX(-36px)' }], 3000, { easing: 'linear' });
  a(liq, [{ transform: 'translateY(0)' }, { transform: 'translateY(4px)' }, { transform: 'translateY(-1.5px)' }, { transform: 'translateY(0)' }], 700);
  a(foam, [{ opacity: 0 }, { opacity: .75 }], 600); kSND.ding();
  await z(300); await a(lid, [{ transform: 'translate(0,0) rotate(0deg) scale(1)' }, { transform: 'translate(40px,-34px) rotate(-8deg) scale(1)', offset: .35 }, { transform: 'translate(104px,204px) rotate(-4deg) scale(.78)' }], 620, { easing: 'cubic-bezier(.4,0,.6,1)' }); kSND.thud();
  a(badge, [{ transform: kTx(50, 236, 0) }, { transform: kTx(50, 230, 1.2), offset: .6 }, { transform: kTx(50, 236, 1) }], 420, { easing: 'cubic-bezier(.3,1.3,.5,1)' });
  kFlourish(160, 150); kDone();
  for (let i = 0; i < 6 && alive(); i++){ kBubble(kRnd(130, 190), 118, { vy: kRnd(-26, -14), col: 'rgba(255,255,255,.95)', r: kRnd(2, 4), life: 1 }); await z(300); }
}

/* ---------- oven: the food hops in, the door shuts, elements glow while the display climbs, it puffs and browns, the door drops open ---------- */
KSCENE.bake = f => kBack() + `
<g>${kShadow(160, 306, 56, 9, .32)}<ellipse cx="160" cy="299" rx="50" ry="10.5" fill="url(#gDish)" stroke="#C3CCDB" stroke-width="1.2"/><ellipse cx="160" cy="298" rx="36" ry="6.5" fill="none" stroke="#C3CCDB" stroke-width="1" opacity=".7"/></g>
<clipPath id="cOven"><rect x="58" y="98" width="204" height="140" rx="6"/></clipPath><clipPath id="cOvenWin"><rect x="72" y="116" width="176" height="110" rx="6"/></clipPath>
<g id="ov" filter="url(#fShadow)">
  <rect x="34" y="22" width="252" height="236" rx="18" fill="url(#gSteel)" stroke="#9AA6BB" stroke-width="1.5"/><rect x="40" y="26" width="240" height="8" rx="4" fill="#fff" opacity=".6"/>
  <rect x="48" y="38" width="224" height="44" rx="10" fill="#DDE3EE" stroke="#B5BFD1"/><rect x="58" y="46" width="72" height="28" rx="5" fill="#0B120E" stroke="#26372C"/>
  <text id="kOTemp" x="94" y="65.5" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="16" font-weight="700" fill="#6B4A25">20°</text>
  ${[170, 208, 246].map(x => `<circle cx="${x}" cy="60" r="12" fill="url(#gKey)" stroke="#8E9AB0"/><rect x="${x - 1.5}" y="49" width="3" height="9" rx="1.5" fill="#E2574C"/>`).join('')}
  <rect x="52" y="92" width="216" height="152" rx="10" fill="#1A1F2B"/><rect x="58" y="98" width="204" height="140" rx="6" fill="url(#gInt)"/>
  <g clip-path="url(#cOven)">
    <rect id="ovGlow" x="58" y="98" width="204" height="140" fill="url(#gOvenGlow)" opacity="0"/>
    <path d="M62 150 H258 M62 198 H258" stroke="#9AA6BB" stroke-width="2" opacity=".5"/><rect x="84" y="198" width="152" height="6" rx="3" fill="url(#gSteel)"/>
    <rect id="elT" x="76" y="108" width="168" height="5" rx="2.5" fill="#4A3030"/><rect id="elB" x="76" y="228" width="168" height="5" rx="2.5" fill="#4A3030"/>
    <ellipse cx="160" cy="205" rx="32" ry="5" fill="#000" opacity=".4" filter="url(#fBlur2)"/>
    <g id="foodInG" style="transform:translate(160px,176px) scale(.84);opacity:0"><g id="foodSway">${kFoodLayers(f.e, 56)}</g></g>
  </g>
</g>
<g id="door" style="transform-origin:160px 248px;transform:scaleY(.08)">
  <path fill-rule="evenodd" d="M60 88 H260 Q274 88 274 102 V234 Q274 248 260 248 H60 Q46 248 46 234 V102 Q46 88 60 88 Z M76 112 H244 Q252 112 252 120 V222 Q252 230 244 230 H76 Q68 230 68 222 V120 Q68 112 76 112 Z" fill="url(#gSteel)" stroke="#9AA6BB" stroke-width="1.5"/><rect x="80" y="94" width="160" height="8" rx="4" fill="#C7CFDD"/><rect x="82" y="95.5" width="156" height="2.2" rx="1.1" fill="#fff" opacity=".85"/>
  <rect x="68" y="112" width="184" height="118" rx="8" fill="none" stroke="#1A1F2B" stroke-width="8"/><rect x="72" y="116" width="176" height="110" rx="6" fill="url(#gGlass)"/>
  <g clip-path="url(#cOvenWin)"><g id="oRefl" opacity="0"><polygon points="86,116 120,116 70,226 36,226" fill="#fff" opacity=".26"/><polygon points="128,116 138,116 88,226 78,226" fill="#fff" opacity=".16"/></g></g>
</g>
<g id="foodOutG" style="transform:translate(160px,300px) scale(0);opacity:0"><g id="foodBob">${kFoodLayers(f.e, 58, 'kFood')}</g></g>`;
async function kBake(f, c){
  const { alive, z, a, loop, T } = c, q = kq;
  const out = q('#foodOutG'), inn = q('#foodInG'), door = q('#door'), glow = q('#ovGlow'), elT = q('#elT'), elB = q('#elB'), ov = q('#ov'), disp = q('#kOTemp'), refl = q('#oRefl'), sway = q('#foodSway'), bob = q('#foodBob');
  if (!out || !f.e) return;
  const OUT = (y, s = 1, sy = s) => kTx(160, y, s, sy), INN = (y, s = .84, sy = s) => kTx(160, y, s, sy);
  const shake = () => a(ov, [{ transform: 'translate(0,0)' }, { transform: 'translate(-1.5px,.8px)' }, { transform: 'translate(1.3px,-.5px)' }, { transform: 'translate(-.6px,.2px)' }, { transform: 'translate(0,0)' }], 170);
  kMsg(`אופים: ${f.n}`);
  // the food appears on the counter, then hops into the open oven
  kSND.pop();
  await a(out, [{ transform: OUT(304, 0), opacity: 0 }, { transform: OUT(272, 1.22, .92), opacity: 1, offset: .55 }, { transform: OUT(284), opacity: 1 }], 430, { easing: 'cubic-bezier(.25,.9,.35,1)' });
  if (!alive()) return; await z(150); kSND.whoosh();
  await a(out, [{ transform: OUT(284) }, { transform: OUT(140, .98, 1.07), offset: .5 }, { transform: OUT(176, .84) }], 540, { easing: 'cubic-bezier(.4,0,.3,1)' });
  if (!alive()) return;
  out.style.visibility = 'hidden'; inn.style.opacity = 1; kSND.thud();
  await a(inn, [{ transform: INN(176) }, { transform: INN(181, .96, .72), offset: .35 }, { transform: INN(174, .8, .9), offset: .7 }, { transform: INN(176) }], 280, { easing: 'ease-out' });
  if (!alive()) return; await z(80);
  // the door swings up and shuts
  kSND.clunk();
  const closing = a(door, [{ transform: 'scaleY(.08)' }, { transform: 'scaleY(1.03)', offset: .72 }, { transform: 'scaleY(1)' }], 480, { easing: 'ease-in' });
  await z(350); shake(); await closing; if (!alive()) return; await z(120);
  // baking: elements glow, the display climbs, the food puffs up and browns under a haze of heat
  const t0 = performance.now(), dur = 3400 * T; disp.setAttribute('fill', '#FFB347'); disp.setAttribute('filter', 'url(#fGlowG)');
  K.clock = setInterval(() => { disp.textContent = `${Math.round(20 + 160 * Math.min(1, (performance.now() - t0) / dur))}°`; }, 100);
  kHold(kSND.hum(3.5 * T, 70));
  [elT, elB].forEach(el => { el.style.transition = 'fill 1.4s, filter 1.4s'; el.style.fill = '#FF5A2A'; el.style.filter = 'drop-shadow(0 0 5px #FF6A32)'; });
  a(glow, [{ opacity: 0 }, { opacity: .85 }], 1600); refl.style.opacity = 1;
  sway.setAttribute('filter', 'url(#fHaze)');
  a(inn.querySelector('.toasted'), [{ opacity: 0 }, { opacity: 1 }], 3300, { easing: 'linear' });
  a(sway, [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }], 3300, { easing: 'ease-out' });
  const L = [loop(refl, [{ transform: 'translateX(-30px)' }, { transform: 'translateX(230px)' }], 2400, { easing: 'ease-in-out' }), loop(glow, [{ opacity: .85 }, { opacity: .7 }, { opacity: .92 }], 800, { direction: 'alternate', delay: 1600 * T })];
  for (let i = 0; i < 22 && alive(); i++){ if (i % 3 === 0) kPuff(160 + kRnd(-30, 30), 168, { clip: [58, 98, 204, 140], vy: kRnd(-24, -14), r0: 3, r1: 10, a: .22, life: 1.2, col: '255,220,170' }); await z(155); }
  if (!alive()) return;
  // ding! elements cool, the door drops open in a cloud of steam
  clearInterval(K.clock); disp.textContent = '180°'; disp.removeAttribute('filter'); disp.setAttribute('fill', '#6B4A25'); L.forEach(l => l.cancel()); sway.removeAttribute('filter');
  [elT, elB].forEach(el => { el.style.transition = 'fill .5s, filter .5s'; el.style.fill = '#4A3030'; el.style.filter = 'none'; }); a(glow, [{ opacity: .8 }, { opacity: 0 }], 500);
  kSND.ding(); a(disp, [{ opacity: 1 }, { opacity: .15 }, { opacity: 1 }, { opacity: .15 }, { opacity: 1 }], 700); await z(560); if (!alive()) return;
  kSND.clunk(); shake();
  a(door, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.02)', offset: .65 }, { transform: 'scaleY(.08)' }], 540, { easing: 'cubic-bezier(.3,1.3,.5,1)' });
  for (let i = 0; i < 12; i++) kPuff(160 + kRnd(-72, 72), kRnd(196, 238), { vx: kRnd(-14, 14), vy: kRnd(-64, -38), r0: 7, r1: 22, a: .8, life: 1.7 });
  await z(280); if (!alive()) return;
  // the baked food comes out and lands on the plate
  inn.style.opacity = 0; out.querySelector('.toasted').setAttribute('opacity', 1); out.style.visibility = 'visible'; kSND.whoosh();
  await a(out, [{ transform: OUT(176, 1.1) }, { transform: OUT(244, 1.08, .98), offset: .55 }, { transform: OUT(289, 1.16, .82), offset: .82 }, { transform: OUT(284, 1.1) }], 580, { easing: 'cubic-bezier(.4,0,.6,1)' });
  if (!alive()) return; kSND.thud(); kFlourish(160, 262); kDone();
  loop(bob, [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }], 900, { direction: 'alternate' });
  for (let i = 0; i < 10 && alive(); i++){ kPuff(160 + kRnd(-16, 16), 262, { vx: kRnd(-5, 5), vy: kRnd(-24, -14), r0: 4, r1: 14, a: .4, life: 1.6 }); await z(260); }
}

const KRUN = { heat: kHeat, cut: kCut, toasting: kToast, pour: kPour, fry: kFry, blend: kBlend, bake: kBake };

const KFREE_HINT = 'אפשר גם להקליד אימוג׳י, כמו ☕';
// [emoji, action, words (comma separated; punctuation is ignored), liquid colour when it is poured or made into a juice]
const KDICT = [
  ['☕', 'pour', 'קפה,נסקפה,נס קפה,אספרסו,קפוצינו,לאטה,הפוך,קפה הפוך,coffee,espresso,cappuccino,latte,americano', '#6B4226'],
  ['☕', 'pour', 'קקאו,שוקו חם,הוט שוקולד,cocoa,hot chocolate', '#6D4C41'],
  ['🍵', 'pour', 'תה,תה חם,תה נענע,נענע,tea,matcha,מאצה', '#C98A4B'],
  ['🍲', 'heat', 'מרק,מרק עוף,מרק ירקות,עדשים,חמין,צולנט,תבשיל,סטו,soup,stew,cholent'],
  ['🥣', 'heat', 'דייסה,שיבולת שועל,סולת,אוטמיל,porridge,oatmeal'],
  ['🍜', 'heat', 'אטריות,נודלס,ראמן,noodles,ramen'],
  ['🍝', 'heat', 'ספגטי,פסטה,מקרוני,פנה,רביולי,spaghetti,pasta,macaroni'],
  ['🍕', 'heat', 'פוקאצה,פיצה,pizza'],
  ['🍚', 'heat', 'אורז,קוסקוס,בורגול,פתיתים,כוסמת,קינואה,ריזוטו,rice,couscous,quinoa'],
  ['🍛', 'heat', 'קארי,מגדרה,בריאני,curry'],
  ['🍔', 'heat', 'בורגר,המבורגר,צ׳יזבורגר,burger,hamburger,cheeseburger'],
  ['🌭', 'heat', 'נקניק,נקניקיה,נקניקייה,נקניקיות,הוטדוג,hotdog,hot dog'],
  ['🥪', 'heat', 'כריך,כריכון,סנדוויץ,סנדביץ,sandwich'],
  ['🌯', 'heat', 'בוריטו,שווארמה,שוארמה,לאפה,רול,wrap,burrito,shawarma'],
  ['🌮', 'heat', 'טאקו,טורטייה,קסדייה,taco,tortilla,quesadilla'],
  ['🧆', 'heat', 'כדורי בשר,פלאפל,קובה,קבב,קבבים,meatball,meatballs,falafel,kebab'],
  ['🥟', 'heat', 'כופתה,כופתאות,בורקס,בורקסים,סמבוסק,קרפלך,פירוגי,dumpling,dumplings,burekas'],
  ['🍗', 'heat', 'כנפיים,כרעיים,שוקיים,חזה עוף,הודו,chicken,wings,drumstick,turkey'],
  ['🍖', 'heat', 'בשר,צלעות,צלי,צלי בקר,בקר,meat,beef,ribs'],
  ['🍟', 'heat', 'ציפס,צ׳יפס,פרנץ פרייז,fries,french fries,chips'],
  ['🥔', 'heat', 'תפוד,תפוח אדמה,תפוחי אדמה,תפוא,פירה,פירה תפוחי אדמה,potato,potatoes,mashed potatoes'],
  ['🍠', 'heat', 'בטטה,בטטות,sweet potato'],
  ['🌽', 'heat', 'תירס,קלח תירס,corn'],
  ['🍿', 'heat', 'פופקורן,popcorn'],
  ['🍪', 'bake', 'עוגייה,עוגיה,עוגיות,בראוני,בראוניז,cookie,cookies,brownie'],
  ['🍩', 'heat', 'סופגנייה,סופגניה,סופגניות,donut,doughnut'],
  ['🥧', 'bake', 'פאי,פשטידה,פשטידות,pie,quiche'],
  ['🫘', 'heat', 'חומוס,הומוס,שעועית,פול,לוביה,אפונה,beans,hummus'],
  ['🥫', 'heat', 'שימורים,טונה,tuna,canned'],
  ['🍫', 'cut', 'שוקולד,פרלין,chocolate', '#6D4C41'],
  ['🍰', 'bake', 'עוגה,עוגת שוקולד,עוגת גבינה,טורט,פרוסת עוגה,cake,cheesecake'],
  ['🥗', 'cut', 'סלט,סלט ירקות,סלט חסה,salad'],
  ['🧀', 'cut', 'גבינה צהובה,גבינות,מוצרלה,פטה,קממבר,גאודה,cheese,mozzarella,feta'],
  ['🥭', 'cut', 'מנגו,mango', '#FFB300'],
  ['🍉', 'cut', 'אבטיח,אבטיחים,watermelon', '#FF5C7A'],
  ['🍎', 'cut', 'תפוח,תפוחים,apple,apples', '#E8C26A'],
  ['🍏', 'cut', 'תפוח ירוק,green apple', '#C5E06A'],
  ['🍌', 'cut', 'בננה,בננות,banana,bananas', '#F6E27A'],
  ['🥒', 'cut', 'מלפפון,מלפפונים,מלפפון חמוץ,חמוצים,cucumber,pickle,pickles'],
  ['🥕', 'cut', 'גזר,גזרים,carrot,carrots', '#FF9A3C'],
  ['🍅', 'cut', 'עגבנייה,עגבניה,עגבניות,עגבנית,שרי,tomato,tomatoes', '#E2574C'],
  ['🍊', 'cut', 'תפוז,תפוזים,קלמנטינה,מנדרינה,orange,oranges,clementine,mandarin', '#FFA726'],
  ['🍋', 'cut', 'לימון,לימונים,ליים,lemon,lime', '#F6E27A'],
  ['🍓', 'cut', 'תות,תותים,strawberry,strawberries', '#F27A9A'],
  ['🥑', 'cut', 'אבוקדו,avocado'],
  ['🍍', 'cut', 'אננס,pineapple', '#F6D55C'],
  ['🍇', 'cut', 'ענבים,ענב,grapes,grape', '#8E3FA8'],
  ['🍐', 'cut', 'אגס,אגסים,pear,pears', '#D8E08A'],
  ['🍑', 'cut', 'אפרסק,אפרסקים,נקטרינה,שזיף,שזיפים,משמש,משמשים,peach,nectarine,plum,apricot', '#FFB27A'],
  ['🍒', 'cut', 'דובדבן,דובדבנים,דבדבנים,cherries', '#C2185B'],
  ['🥝', 'cut', 'קיווי,kiwi', '#9CCB4A'],
  ['🍈', 'cut', 'מלון,מלונים,melon,cantaloupe', '#F2D28B'],
  ['🫐', 'cut', 'אוכמניות,אוכמנית,blueberries,blueberry', '#5B6BC0'],
  ['🥬', 'cut', 'חסה,כרוב,lettuce,cabbage'],
  ['🥦', 'cut', 'ברוקולי,כרובית,broccoli,cauliflower'],
  ['🍆', 'cut', 'חציל,חצילים,eggplant,aubergine'],
  ['🫑', 'cut', 'פלפל,פלפלים,פפריקה,pepper,paprika'],
  ['🧅', 'cut', 'בצל,בצלים,onion,onions'],
  ['🧄', 'cut', 'שום,garlic'],
  ['🥥', 'cut', 'קוקוס,coconut'],
  ['🫒', 'cut', 'זיתים,זית,olives,olive'],
  ['🍞', 'toasting', 'לחם,פרוסת לחם,לחמנייה,לחמניה,חלה,טוסט,bread,toast,challah'],
  ['🥯', 'toasting', 'בייגל,בייגלה,bagel'],
  ['🥐', 'toasting', 'קרואסון,קראסון,מאפה,croissant,pastry'],
  ['🥖', 'toasting', 'באגט,בגט,לחם צרפתי,baguette'],
  ['🧇', 'toasting', 'וופל,וופלים,waffle,waffles'],
  ['🫓', 'toasting', 'פיתה,פיתות,לחם שטוח,pita'],
  ['🥛', 'pour', 'חלב,חלב שקדים,חלב סויה,milk,almond milk,soy milk', '#FFFFFF'],
  ['💧', 'pour', 'מים,מים קרים,מינרלים,water', '#7FD1FF'],
  ['🧃', 'pour', 'מיץ,juice,משקה,שתייה,שתיה,drink', '#FFA726'],
  ['🥤', 'pour', 'קולה,קוקה קולה,פפסי,cola,pepsi,coca cola', '#3B1F14'],
  ['🥤', 'pour', 'סודה,ספרייט,soda,sprite', '#DDEFFB'],
  ['🥤', 'pour', 'פאנטה,fanta', '#FFA726'],
  ['🥤', 'blend', 'שייק,מילקשייק,סמוטי,shake,milkshake,smoothie', '#F4B6C8'],
  ['🍋', 'pour', 'לימונדה,lemonade', '#F6E27A'],
  ['🥣', 'pour', 'יוגורט,קפיר,שמנת,לבן,yogurt,kefir,cream', '#FFFFFF'],
  ['🫖', 'pour', 'תה קר,אייס תי,iced tea', '#C98A4B'],
  ['🥤', 'pour', 'קפה קר,אייס קפה,קפה קרח,iced coffee,cold brew', '#8B5A2B'],
  ['🧁', 'bake', 'קאפקייק,מאפין,cupcake,muffin'],
  ['🍕', 'bake', 'פיצה בתנור,pizza in oven'],
  ['🍗', 'bake', 'עוף בתנור,עוף אפוי,baked chicken,roast chicken'],
  ['🥔', 'bake', 'תפוד אפוי,תפוח אדמה אפוי,תפוחי אדמה אפויים,baked potato'],
  ['🍠', 'bake', 'בטטה אפויה,baked sweet potato'],
  ['🍝', 'bake', 'לזניה,lasagna'],
  ['🥚', 'fry', 'ביצה,ביצים,חביתה,ביצת עין,egg,eggs,omelet,omelette,fried egg'],
  ['🥞', 'fry', 'פנקייק,פנקייקים,פנקק,pancake,pancakes'],
  ['🥔', 'fry', 'לביבה,לביבות,latke,latkes'],
  ['🥩', 'fry', 'סטייק,אנטריקוט,פילה,גריל,steak,entrecote'],
  ['🍗', 'fry', 'שניצל,שניצלים,נאגטס,פרגית,עוף מטוגן,schnitzel,nuggets,fried chicken'],
  ['🍄', 'fry', 'פטריה,פטרייה,פטריות,שמפיניון,mushroom,mushrooms'],
  ['🐟', 'fry', 'דג,דגים,סלמון,fish,salmon'],
  ['🧅', 'fry', 'בצל מטוגן,טבעות בצל,onion rings'],
  ['🍳', 'fry', 'שקשוקה,shakshuka']];
const kNorm = s => s.toLowerCase().replace(/[֑-ׇ]/g, '').replace(/["'׳״`’.,!?()]/g, '').replace(/\s+/g, ' ').trim();
// the buttons' foods win over the dictionary; the first entry for a word or emoji wins
const KWORDS = new Map(), KEMOJI = new Map(), KCOLOR = new Map();
for (const f of KITCHEN){ KWORDS.set(kNorm(f.n), f); if (!KEMOJI.has(f.e)) KEMOJI.set(f.e, f); }
for (const [e, a, words, c] of KDICT){
  const entry = { e, a, ...(c ? { c } : {}) }; if (!KEMOJI.has(e)) KEMOJI.set(e, entry); if (c && !KCOLOR.has(e)) KCOLOR.set(e, c);
  for (const w of words.split(',')){ const k = kNorm(w); if (k && !KWORDS.has(k)) KWORDS.set(k, entry); }
}
// the word as typed, then without a Hebrew prefix letter (הקפה, לקפה), then singular (תפוחים, עגבניות, eggs)
function kForms(w){
  const bases = [w];
  if (w.length > 3 && /^[הולבכמש]/.test(w)) bases.push(w.slice(1));
  if (w.length > 4 && /^ו[הלבכמש]/.test(w)) bases.push(w.slice(2));
  const out = [];
  for (const b of bases){
    out.push(b);
    if (b.length > 3 && b.endsWith('ים')) out.push(b.slice(0, -2));
    if (b.length > 3 && b.endsWith('ות')) out.push(b.slice(0, -2) + 'ה', b.slice(0, -2));
    if (b.length > 3 && b.endsWith('es')) out.push(b.slice(0, -2));
    if (b.length > 3 && b.endsWith('s')) out.push(b.slice(0, -1));
  }
  return out;
}
const kLookup = s => { for (const x of kForms(s)){ const hit = KWORDS.get(x); if (hit) return hit; } return null; };
// text -> { known, f } where f is a food like the buttons' (e, n, a, optional c); null when nothing was typed
function kResolve(text){
  const name = text.trim().replace(/\s+/g, ' ').slice(0, 24); if (!name) return null;
  let em = null; try{ em = (name.match(/\p{Extended_Pictographic}/u) || [])[0] || null; }catch(e){}
  if (em){   // an emoji was typed: use it, with the action of the same emoji if the dictionary knows it
    const k = KEMOJI.get(em); const c = KCOLOR.get(em) || (k && k.c);
    return { known:true, f:{ e:em, n:name.replace(/\p{Extended_Pictographic}|️|‍/gu, '').trim() || em, a:k ? k.a : 'heat', ...(c ? { c } : {}) } };
  }
  const s = kNorm(name); if (!s) return null;
  const toks = s.split(' ');
  const make = hit => KITCHEN.includes(hit) ? hit : { e:hit.e, n:name, a:hit.a, ...(hit.a === 'pour' ? { c: hit.c || KCOLOR.get(hit.e) || '#FFA726' } : {}) };
  let hit = kLookup(s);                                                   // the whole phrase: "קפה קר", "תפוח אדמה"
  if (hit) return { known:true, f:make(hit) };
  if ((toks[0] === 'מיץ' || toks[0] === 'juice') && toks.length > 1){   // "מיץ תות": a juice in the colour of the fruit
    for (const t of toks.slice(1)){ const fr = kLookup(t); if (fr) return { known:true, f:{ e:fr.e, n:name, a:'pour', c: KCOLOR.get(fr.e) || fr.c || '#FFA726' } }; }
  }
  if (['שייק', 'shake', 'smoothie', 'סמוטי', 'מילקשייק', 'milkshake'].includes(toks[0]) && toks.length > 1){   // "שייק תות": blended in the colour of the fruit
    for (const t of toks.slice(1)){ const fr = kLookup(t); if (fr) return { known:true, f:{ e:fr.e, n:name, a:'blend', c: KCOLOR.get(fr.e) || fr.c || '#F4B6C8' } }; }
  }
  for (let i = 0; i < toks.length - 1 && !hit; i++) hit = kLookup(toks[i] + ' ' + toks[i + 1]);   // two words: "בצל מטוגן"
  for (let i = 0; i < toks.length && !hit; i++) hit = kLookup(toks[i]);                                // then the first word we know
  if (hit) return { known:true, f:make(hit) };
  return { known:false, f:{ e:'🍽️', n:name, a:'heat' } };
}
function kFree(text){
  const r = kResolve(text);
  if (!r){ toast('כתבו איזה אוכל להכין'); $('kFreeIn').focus(); return; }
  try{ document.activeElement.blur(); }catch(e){}   // close the phone keyboard so the animation is visible
  kPick(r.f);
  $('kFreeNote').textContent = r.known ? KFREE_HINT : `עוד לא מכיר את "${r.f.n}", אז מחממים אותו בכל זאת. אפשר להקליד אימוג׳י במקום.`;
}
/* ---------- kitchen: send what you made to a family member ---------- */
// dishes/<from>__<to>__<10-minute window>: {from, to, e, n, a, c?, at, eaten?, ateAt?}. The id caps it at one dish per pair per window.
// Whoever is signed in on this phone (or, for the admin, the member chosen at the top) is the sender.
const kMe = () => { if (S.boundId && member(S.boundId)) return S.boundId; return S.isAdmin && S.me !== 'all' && member(S.me) ? S.me : null; };
const kRecent = d => d.at > Date.now() - 3 * 864e5;
const kInbox = () => { const me = kMe(); return me ? S.dishes.filter(d => d.to === me && !d.eaten && kRecent(d)).sort((a, b) => b.at - a.at) : []; };
const kOutbox = () => { const me = kMe(); return me ? S.dishes.filter(d => d.from === me && kRecent(d)).sort((a, b) => b.at - a.at).slice(0, 6) : []; };
const kFem = id => member(id)?.gender === 'f';
// what the server reports about the notification of a dish: sent, nobody has notifications on, failed, or no answer at all
function kPushNote(d){
  if (d.pushed > 0) return ' · 🔔 נשלחה התראה';
  if (d.pushed === 0) return d.phones ? ' · ⚠️ ההתראה לא הגיעה' : ` · 🔕 ל${mName(d.to)} אין התראות מופעלות בטלפון`;
  return Date.now() - d.at > 60000 ? ' · ⚠️ השרת לא אישר שליחת התראה' : '';
}
const kWhen = at => { const d = new Date(at); const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`; return dstr(d) === today() ? `היום ${hm}` : `${d.getDate()}.${d.getMonth() + 1} ${hm}`; };
// a dish for me that arrives while the app is open pops up as a message (only fresh ones, so a cache replay stays quiet)
function kDishesIn(list){
  const prevAll = new Map(S.dishes.map(d => [d.id, d])), prev = new Set(prevAll.keys()); const me = kMe();
  if (S.dishesLoaded && me) for (const d of list) if (!prev.has(d.id) && d.to === me && !d.eaten && d.at > Date.now() - 120000) toast(`${d.e} ${mName(d.from)} ${kFem(d.from) ? 'שלחה' : 'שלח'} לך ${d.n}`);
  if (S.dishesLoaded && me) for (const d of list){ const was = prevAll.get(d.id); if (d.from === me && was && was.pushed === undefined && d.pushed === 0 && Date.now() - d.at < 120000)
    toast(d.phones ? `⚠️ ההתראה ל${mName(d.to)} לא הגיעה` : `🔕 ל${mName(d.to)} אין התראות מופעלות בטלפון. המנה נשלחה, אבל לא תגיע התראה`); }
  if (S.dishesLoaded && me) for (const d of list){ const was = prevAll.get(d.id); if (d.from === me && was && !was.coming && d.coming && Date.now() - (d.comingAt || 0) < 120000) toast(kReplyText(d)); }
  S.dishes = list; S.dishesLoaded = true;
}
// the reply to a come-and-eat call: "on my way" (the server tells only the caller)
const kReplyLabel = d => d.call ? '🏃 בדרך' : '✅ מוכן לאכילה';
const kReplyText = d => d.call ? `🏃 ${mName(d.to)} בדרך` : `✅ ${d.e} ${d.n} מוכן לאכילה`;
const kComingBtn = d => d.coming ? h('small', null, kReplyLabel(d) + ' ✓') : h('button', { type:'button', class:'btn small', onclick:() => kComing(d) }, kReplyLabel(d));
async function kComing(d){
  if (!d || d.coming) return;
  try{ await updateDoc(doc(db, 'dishes', d.id), { coming: true, comingAt: Date.now() }); toast(`${mName(d.from)} יודע${kFem(d.from) ? 'ת' : ''} ${d.call ? 'שאתה בדרך 🏃' : 'שזה מוכן לאכילה ✅'}`); if (K.dish && K.dish.id === d.id) K.dish = { ...K.dish, coming: true }; kRenderSend(); render(); }
  catch(e){ fail(e); }
}
function kDone(){ kMsg('בתיאבון! 🍽️'); K.ready = true; kRenderSend(); }
// under the message: one button opens the send window (as soon as a food is picked, or to call everyone to eat); "I ate it" for a dish someone sent me
function kRenderSend(){
  const sendBox = $('kSend'), eat = $('kEatWrap'); if (!sendBox) return;
  eat.hidden = !(K.ready && K.dish);
  $('kComing').hidden = !(K.dish && !K.dish.coming); $('kComing').textContent = K.dish ? kReplyLabel(K.dish) + (K.dish.call ? '!' : '') : '';
  sendBox.hidden = !kMe();
  const cb = $('kCallBtn'); cb.disabled = !!K.called; cb.textContent = K.called ? '🍽️ קראת ✓' : '🍽️ בואו לאכול!';
  if (!$('kPop').hidden) kRenderPop();
}
// the send window: the picked food to one person or to everyone (optionally with "come and eat"), or a plain "come and eat" call
function kRenderPop(){
  const me = kMe(), box = $('kPopBody'); box.replaceChildren(); if (!me) return;
  const others = S.members.filter(m => m.id !== me);
  if (K.cur){
    box.append(h('h3', null, `${K.cur.e} ${K.cur.n}: לשלוח ל`),
      h('label', { class:'check' }, h('input', { type:'checkbox', checked: K.withCall, onchange: e => { K.withCall = e.target.checked; } }), ' 🍽️ עם "בואו לאכול!" (ההתראה תקרא לבוא לאכול)'),
      h('div', { class:'chips' }, others.map(m => h('button', { type:'button', class:'chip', disabled: K.sent.has(m.id), onclick:() => kSendDish(m.id) },
        h('span', { class:'dot', style:`background:${m.color}` }), m.name, K.sent.has(m.id) ? ' ✓' : '')),
        h('button', { type:'button', class:'chip', disabled: others.every(m => K.sent.has(m.id)), onclick:() => kSendAll() }, '👨‍👩‍👧 כולם')));
  }
  box.append(h('h3', null, 'בלי אוכל:'), h('button', { type:'button', class:'btn kcall', disabled: K.called, onclick:() => kCallAll() }, K.called ? '🍽️ קראת ✓' : '🍽️ בואו לאכול! (לכולם)'));
}
function kOpenPop(){ const p = $('kPop'); p.hidden = !p.hidden; if (!p.hidden){ kRenderPop(); p.scrollIntoView({ block:'nearest', behavior:'smooth' }); } }
function kClosePop(){ $('kPop').hidden = true; }
const kFood = () => ({ ...K.cur, ...(K.withCall ? { call:true } : {}) });
// the same food to every other member (the ones who already got it this window are skipped)
async function kSendAll(){
  const me = kMe(), f = K.cur && kFood(); if (!me || !f) return;
  const w = Math.floor(Date.now() / dishMs()); let n = 0;
  for (const m of S.members.filter(m => m.id !== me && !K.sent.has(m.id))){
    if (S.dishes.some(d => d.id === `${me}__${m.id}__${w}`)) continue;
    if (await kSendDish(m.id, f, true)){ K.sent.add(m.id); n++; }
  }
  kRenderSend(); toast(n ? `${f.e} נשלח ל${n} בני משפחה` : 'כבר שלחת לכולם לפני רגע. נסו עוד כמה דקות.');
  setTimeout(kClosePop, 700);
}
async function kCallAll(){
  const me = kMe(); if (!me || K.called) return;
  K.called = true; kRenderSend(); kRenderPop();
  const w = Math.floor(Date.now() / dishMs()); let n = 0;
  for (const m of S.members.filter(m => m.id !== me)){
    if (S.dishes.some(d => d.id === `${me}__${m.id}__${w}`)) continue;
    if (await kSendDish(m.id, { e:'🍽️', n:'בואו לאכול!', a:'heat', call:true }, true)) n++;
  }
  toast(n ? '🍽️ קראת לכולם לאכול' : 'כבר שלחת לכולם לפני רגע. נסו עוד כמה דקות.');
  setTimeout(kClosePop, 700);
}
// returns true when the dish was written
async function kSendDish(to, food, bulk = false){
  const me = kMe(), f = food || (K.cur && kFood()); if (!me || !f || (!bulk && K.sent.has(to))) return false;
  const at = Date.now(), w = Math.floor(at / dishMs()), id = `${me}__${to}__${w}`;
  if (S.dishes.some(d => d.id === id)){ if (!bulk) toast(`כבר שלחת ל${mName(to)} לפני רגע. נסו עוד כמה דקות.`); return false; }
  if (!bulk){ K.sent.add(to); kRenderSend(); }
  try{ await setDoc(doc(db, 'dishes', id), { from: me, to, e: f.e, n: f.n, a: f.a, ...(f.c ? { c: f.c } : {}), ...(f.call ? { call: true } : {}), at, w }); if (!bulk) toast(`נשלח ל${mName(to)} 📤`); return true; }
  catch(e){ if (!bulk){ K.sent.delete(to); kRenderSend(); if (e && e.code === 'permission-denied') toast(`כבר שלחת ל${mName(to)} לפני רגע. נסו עוד כמה דקות.`); else fail(e); } return false; }
}
// opening a dish someone sent: it is prepared on screen again, then "I ate it" tells them
function kOpenDish(d){
  kPick({ e:d.e, n:d.n, a:d.a, ...(d.c ? { c:d.c } : {}) }, d);
  try{ document.querySelector('#kitchenSheet .sheet-body').scrollTo({ top: 0, behavior: 'smooth' }); }catch(e){}
}
async function kEat(){
  const d = K.dish; if (!d) return;
  try{ await updateDoc(doc(db, 'dishes', d.id), { eaten: true, ateAt: Date.now() }); toast(`בתיאבון! ${mName(d.from)} יקבל${kFem(d.from) ? 'ת' : ''} הודעה 😋`); K.dish = null; K.cur = null; kRenderSend(); render(); }
  catch(e){ fail(e); }
}
function renderKitchenMail(){
  const inbox = kInbox(), out = kOutbox();
  $('kInbox').hidden = !inbox.length; const I = $('kInboxList'); I.replaceChildren();
  inbox.forEach(d => I.append(h('div', { class:'arow' }, h('span', { class:'ke', 'aria-hidden':'true' }, d.e),
    h('div', { class:'t' }, h('strong', null, `${mName(d.from)} ${kFem(d.from) ? 'שלחה' : 'שלח'} לך ${d.n}`), h('small', null, kWhen(d.at))),
    h('button', { type:'button', class:'btn small', onclick:() => kOpenDish(d) }, 'פתחו'), kComingBtn(d))));
  $('kOutbox').hidden = !out.length; const O = $('kOutboxList'); O.replaceChildren();
  out.forEach(d => O.append(h('div', { class:'arow' }, h('span', { class:'ke', 'aria-hidden':'true' }, d.e),
    h('div', { class:'t' }, h('strong', null, `${d.n} ל${mName(d.to)}`), h('small', null, d.eaten ? `${mName(d.to)} ${kFem(d.to) ? 'אכלה' : 'אכל'} ✓` : d.coming ? `${mName(d.to)} ${d.call ? 'בדרך 🏃' : 'מוכן לאכילה ✅'}` : `מחכה ל${mName(d.to)} · ${kWhen(d.at)}${kPushNote(d)}`)))));
}
function kPick(f, dish = null){
  try{ document.querySelector('#kitchenSheet .sheet-body').scrollTo({ top: 0, behavior: 'smooth' }); }catch(e){}
  $('kFoodPop').hidden = true;
  K.cur = f; K.dish = dish;
  const i = String(KITCHEN.indexOf(f));
  document.querySelectorAll('.kchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.i === i)));
  $('kFreeNote').textContent = KFREE_HINT; kReset(f.a, f); kPlay(f);
}
function kFit(){ kFxSize(); }
const kSoundIcon = () => { $('kSound').textContent = store.get('ft-ksound') === '0' ? '🔇' : '🔊'; };
function buildKitchen(){
  const box = $('kPick'); box.replaceChildren();
  for (const [action, title] of KACTIONS)
    box.append(h('p', { class:'sub' }, title), h('div', { class:'chips' }, KITCHEN.filter(f => f.a === action).map(f =>
      h('button', { type:'button', class:'chip kchip', 'data-i':KITCHEN.indexOf(f), 'aria-pressed':'false', onclick:() => kPick(f) }, h('span', { class:'ke', 'aria-hidden':'true' }, f.e), f.n))));
  kSoundIcon();
  $('kBack').addEventListener('click', () => { S.kitchenOpen = false; render(); });
  window.addEventListener('resize', () => { if (K.shown) kFit(); });
  $('kFree').addEventListener('submit', e => { e.preventDefault(); kFree($('kFreeIn').value); });
  $('kEat').addEventListener('click', kEat);
  $('kComing').addEventListener('click', () => kComing(K.dish));
  $('kFoodOpen').addEventListener('click', () => { const p = $('kFoodPop'); p.hidden = !p.hidden; if (!p.hidden) p.scrollIntoView({ block:'nearest', behavior:'smooth' }); });
  $('kFoodPopClose').addEventListener('click', () => { $('kFoodPop').hidden = true; });
  $('kFoodPop').addEventListener('click', e => { if (e.target === $('kFoodPop')) $('kFoodPop').hidden = true; });
  $('kCallBtn').addEventListener('click', kCallAll);
  $('kSendOpen').addEventListener('click', kOpenPop);
  $('kPopClose').addEventListener('click', kClosePop);
  $('kPop').addEventListener('click', e => { if (e.target === $('kPop')) kClosePop(); });
  $('kSound').addEventListener('click', () => { store.set('ft-ksound', store.get('ft-ksound') === '0' ? '1' : '0'); kSoundIcon(); kBeep(660, 80); });
}
// render() calls this on every data update: it only shows or hides the sheet and never touches a running animation
function renderKitchen(){
  const sheet = $('kitchenSheet'); if (!sheet) return;
  const kb = $('tabKitchenN'); if (kb){ const n = kInbox().length; kb.hidden = !n; kb.textContent = String(n); kb.setAttribute('aria-label', n ? `${n} מנות מחכות` : ''); }
  const allowed = !!S.user && !!(S.boundId || S.isAdmin);
  if (!S.kitchenOpen || !allowed){ if (K.shown){ K.shown = false; sheet.hidden = true; kStop(); } return; }
  document.body.classList.add('locked');
  if (!K.shown){ K.shown = true; K.cur = null; K.dish = null; sheet.hidden = false; kFit(); kReset('heat'); kMsg('בחרו מה להכין'); $('kFreeNote').textContent = KFREE_HINT; $('kFreeIn').value = ''; document.querySelectorAll('.kchip').forEach(b => b.setAttribute('aria-pressed', 'false')); }
  renderKitchenMail();
}

/* ---------- opening splash ---------- */
// The admin sees "bow to King Rotem". Children and parents see "good morning, <name>" and a different
// teasing nickname every time the app opens.
// Opening lines: a different set of 8 every week (Sunday to Saturday), cycling through 6 weeks.
const ROAST_POOL = [["יא לוזר", "יא לוזרית"], ["ראש ביצה סרוחה", "ראש ביצה סרוחה"], ["יא עצלן", "יא עצלנית"], ["מלך השינה עד הצהריים", "מלכת השינה עד הצהריים"], ["יא חמוץ", "יא חמוצה"], ["אלוף העולם בלהתחמק ממשימות", "אלופת העולם בלהתחמק ממשימות"], ["יא שפן", "יא שפנפנה"], ["נתין קטן של המלך", "נתינה קטנה של המלך"], ["יא גרב מסריחה", "יא גרב מסריחה"], ["יא פיתה בלי חומוס", "יא פיתה בלי חומוס"], ["שר החדר המבולגן", "שרת החדר המבולגן"], ["יא תפוח אדמה עם רגליים", "יא תפוח אדמה עם רגליים"], ["יא לוזר מקצועי", "יא לוזרית מקצועית"], ["נסיך הכלים המלוכלכים", "נסיכת הכלים המלוכלכים"], ["יא חלזון", "יא חלזונית"], ["יא קוטלט שרוף", "יא קציצה שרופה"], ["יא שניצל קפוא", "יא שניצל קפוא"], ["יא במבה מעוכה", "יא במבה מעוכה"], ["קפטן הספה", "קפטנית הספה"], ["יא מלפפון חמוץ", "יא מלפפון חמוץ"], ["מנכ\"ל הבלגן", "מנכ\"לית הבלגן"], ["יא ספוג כלים יבש", "יא ספוג כלים יבש"], ["אלוף הנודניקים", "אלופת הנודניקיות"], ["יא גבינה מעופשת", "יא גבינה מעופשת"], ["יא פרה בחופשה", "יא פרה בחופשה"], ["שגריר הגרביים המסריחות", "שגרירת הגרביים המסריחות"], ["יא סנדוויץ׳ בלי כלום", "יא סנדוויץ׳ בלי כלום"], ["יא שלט טלוויזיה אבוד", "יא שלט טלוויזיה אבוד"], ["יא עצלן מדופלם", "יא עצלנית מדופלמת"], ["יא דג זהב עם זיכרון של 3 שניות", "יא דג זהב עם זיכרון של 3 שניות"], ["יא חביתה מקומטת", "יא חביתה מקומטת"], ["מומחה לשכיבה על המיטה", "מומחית לשכיבה על המיטה"], ["יא ענן ישנוני", "יא ענן ישנוני"], ["יא פופקורן שלא התפוצץ", "יא פופקורן שלא התפוצץ"], ["נסיך הדחיינות", "נסיכת הדחיינות"], ["יא קרואסון רך", "יא קרואסון רך"], ["יא קיפוד מנומנם", "יא קיפוד מנומנם"], ["יא סוס עבודה בפנסיה", "יא סוסת עבודה בפנסיה"], ["שומר הסף של המקרר", "שומרת הסף של המקרר"], ["יא בלון בלי אוויר", "יא בלון בלי אוויר"], ["יא פינגווין מבולבל", "יא פינגווינית מבולבלת"], ["יא כרית מדברת", "יא כרית מדברת"], ["יא נעל בלי זוג", "יא נעל בלי זוג"], ["אלוף ה\"עוד חמש דקות\"", "אלופת ה\"עוד חמש דקות\""], ["יא מטען בלי כבל", "יא מטען בלי כבל"], ["יא עגבנייה מעוכה", "יא עגבנייה מעוכה"], ["יא טוסט שרוף", "יא טוסט שרוף"], ["יא ג׳לי רועד", "יא ג׳לי רועד"]];
const PRAISE_POOL = ["המשפחה הזאת הייתה מתפרקת בלעדיך", "אתה עושה בשעה מה שהם עושים בשבוע", "גאון, מנהיג, ועדיין צנוע", "הם מנסים, אתה פשוט מצליח", "מלך אמיתי לא צריך להוכיח כלום, אבל אתה מוכיח בכל זאת", "אף אחד לא מסדר את הבית כמוך", "הנתינים שלך לא ראויים לך", "אתה הסיבה שיש פה סדר", "היום עוד יום שבו אתה הכי טוב בבית", "אגדה חיה", "גם בשבוע גרוע אתה במקום הראשון", "השם שלך כבר חקוק בהיכל התהילה", "אתה לא משחק את המשחק, אתה המשחק", "כולם רוצים להיות אתה, גם ההורים", "כל הכבוד, שוב", "המלך נכנס, כולם לעמוד", "אפילו השעון המעורר מתעורר בגללך", "הכתר יושב עליך בדיוק", "כולם מחכים להוראות שלך", "יום בלי המלך הוא יום מבוזבז", "אתה הסיבה שהאפליקציה הזאת קיימת", "אם היה פרס נובל לסידור הבית, הוא היה שלך", "אפילו המדיח מתרגש כשאתה נכנס", "הנקודות שלך שוות זהב", "שאר המשפחה עדיין לומדת ממך", "כשאתה מסדר, אפילו האבק מצדיע", "עוד יום, עוד ניצחון", "המלך תמיד צודק, גם היום", "אתה פשוט ברמה אחרת", "יש מלכים, ויש אותך", "הבית מתפקד רק בזכותך", "שום ילד לא יעקוף אותך בטבלה", "נולדת לנהל", "הכתר לא כבד עליך בכלל", "אתה המודל לחיקוי של כולם", "הנתינים מתפללים להצלחתך", "אין עליך, וכולם יודעים", "מנהיג אמיתי, גם בפיג׳מה", "כל משימה שאתה נוגע בה הופכת לזהב", "הם מנסים להשיג אותך, ונכשלים", "אתה הסיבה שכולם עובדים קשה", "עוד שבוע של שלטון מושלם", "אפילו הכלב מקשיב רק לך", "החוכמה שלך מאירה את הבית", "השבוע הזה שייך לך", "גדולתך אינה יודעת גבול", "ההיסטוריה תזכור את השבוע הזה", "גם המקרר מסתדר בשורה בשבילך"];
const weekNo = () => Math.floor(Date.parse(weekStart() + 'T12:00:00Z') / (7 * 864e5));
const ofTheWeek = pool => { const n = 8, sets = Math.ceil(pool.length / n), k = ((weekNo() % sets) + sets) % sets; return pool.slice(k * n, k * n + n); };
const ROASTS = { get m(){ return ofTheWeek(ROAST_POOL).map(x => x[0]); }, get f(){ return ofTheWeek(ROAST_POOL).map(x => x[1]); } };
const PRAISE = { get list(){ return ofTheWeek(PRAISE_POOL); } };
let praiseNow = null;
// The king's opening line: different every time, like the jokes. Half the time a set-up and twist, half a praise line from the whole pool.
const PRAISE_JOKES = [["בדקנו מי הכי חכם בבית…", "זה אתה. הכלב במקום השני."], ["ההורים התייעצו מי יירש את הבית…", "הם בחרו בך. השאר יגורו במחסן."], ["גוגל חיפש את המילה 'גאון'…", "ויצאה תמונה שלך."], ["המדיח רצה להגיד משהו…", "הוא מתגעגע רק אליך."], ["המלך הסתכל במראה הבוקר…", "והמראה השתחוותה."], ["ניסינו למצוא מישהו טוב ממך…", "החיפוש עדיין נמשך. כבר שלוש שנים."], ["נאסא התקשרו…", "הם רוצים לקרוא לכוכב על שמך."], ["הטבלה של השבוע מבולבלת…", "היא לא מבינה איך כולם מתחתיך."], ["הנתינים התכנסו לישיבה דחופה…", "והחליטו שאתה מושלם. פה אחד."], ["שאלנו בינה מלאכותית מי המלך הכי טוב בעולם…", "היא ענתה: רותם. ואז ביקשה חתימה."], ["החדר שלך נבחר…", "לחדר הכי מסודר בממלכה. שוב."], ["מחר יוצא בול דואר חדש…", "עם הפרצוף שלך."], ["הכתר ביקש להגיד תודה…", "הוא אף פעם לא ישב על ראש כל כך חכם."], ["אם היה פרס על להיות מלך…", "היית מקבל אותו, ואז נותן אותו לעצמך שוב."], ["האחים שלך מנסים להשיג אותך בנקודות…", "בהצלחה להם. באמת."], ["ההיסטוריה תזכור את היום הזה…", "כעוד יום שבו צדקת."]];
const PRAISE_INTROS = ["הודעה רשמית מהממלכה:", "המדענים אישרו:", "בשורה טובה לממלכה:", "ועדת הנתינים קבעה:", "להלן העובדות:"];
let praiseJoke = null;
function praiseJokeOf(){
  if (praiseJoke) return praiseJoke;
  let last = null; try{ last = localStorage.getItem('ft-praise'); }catch(e){}
  let pick;
  for (let tries = 0; tries < 5; tries++){
    if (Math.random() < 0.5){ const j = PRAISE_JOKES[Math.floor(Math.random() * PRAISE_JOKES.length)]; pick = { setup:j[0], punch:j[1] }; }
    else pick = { setup: PRAISE_INTROS[Math.floor(Math.random() * PRAISE_INTROS.length)], punch: PRAISE_POOL[Math.floor(Math.random() * PRAISE_POOL.length)] };
    if (pick.punch !== last) break;
  }
  try{ localStorage.setItem('ft-praise', pick.punch); }catch(e){}
  return praiseJoke = pick;
}
function praiseOf(){ return praiseJokeOf().punch; }
const roastFor = {};
// One joke per person each time the app opens: the splash and the home screen show the same one.
const SILLY_NAMES = [["יא פיצה בלי תוספות", "יא פיצה בלי תוספות"], ["יא שניצל קפוא", "יא שניצל קפוא"], ["יא במבה מעוכה", "יא במבה מעוכה"], ["יא מלפפון חמוץ", "יא מלפפון חמוץ"], ["יא פיתה בלי חומוס", "יא פיתה בלי חומוס"], ["יא קוטלט שרוף", "יא קציצה שרופה"], ["יא טוסט בלי גבינה", "יא טוסט בלי גבינה"], ["יא תפוח אדמה עם רגליים", "יא תפוח אדמה עם רגליים"], ["יא גרב בלי זוג", "יא גרב בלי זוג"], ["יא חלזון בחופשה", "יא חלזונית בחופשה"], ["יא פינגווין מבולבל", "יא פינגווינית מבולבלת"], ["יא ספוג כלים יבש", "יא ספוג כלים יבש"], ["יא קרואסון מעוך", "יא קרואסון מעוך"], ["יא ביצה קשה מדי", "יא ביצה קשה מדי"], ["יא אטריה רטובה", "יא אטריה רטובה"], ["יא ג׳לי רועד", "יא ג׳לי רועד"], ["יא כרובית מבולבלת", "יא כרובית מבולבלת"], ["יא בורקס בלי מילוי", "יא בורקס בלי מילוי"], ["יא פופקורן שלא התפוצץ", "יא פופקורן שלא התפוצץ"], ["יא חביתה בלי מלח", "יא חביתה בלי מלח"], ["יא קיפוד מנומנם", "יא קיפודה מנומנמת"], ["יא ארטיק נמס", "יא ארטיק נמס"], ["יא בלון בלי אוויר", "יא בלון בלי אוויר"], ["יא שקית במבה ריקה", "יא שקית במבה ריקה"], ["יא עגבנייה מדברת", "יא עגבנייה מדברת"], ["יא שוקו בלי שוקו", "יא שוקו בלי שוקו"], ["יא מטען בלי כבל", "יא מטען בלי כבל"], ["יא נעל בית מסריחה", "יא נעל בית מסריחה"], ["יא סופגנייה בלי ריבה", "יא סופגנייה בלי ריבה"], ["יא דג זהב עם קפוצ׳ון", "יא דג זהב עם קפוצ׳ון"], ["יא פסטה בלי רוטב", "יא פסטה בלי רוטב"], ["יא כדור פינג פונג מקומט", "יא כדור פינג פונג מקומט"], ["יא ראש כרובית", "יא ראש כרובית"], ["יא גמבה שמתחפשת לבן אדם", "יא גמבה שמתחפשת לבת אדם"], ["יא ענן בצורת גרב", "יא ענן בצורת גרב"], ["יא מנכ\"ל של שום דבר", "יא מנכ\"לית של שום דבר"], ["יא רובוט עם באג", "יא רובוטית עם באג"], ["יא בננה עם רישיון נהיגה", "יא בננה עם רישיון נהיגה"], ["יא ברווז שמדבר עם קירות", "יא ברווזה שמדברת עם קירות"], ["יא פלאפל עם חרדות", "יא פלאפל עם חרדות"], ["יא פינגווין שנכשל בטיסה", "יא פינגווינית שנכשלה בטיסה"], ["יא צנצנת חמוצים מדברת", "יא צנצנת חמוצים מדברת"], ["יא מלך החניון", "יא מלכת החניון"], ["יא נמלה בחליפה", "יא נמלה בחליפה"], ["יא דוב קוטב בחמסין", "יא דובת קוטב בחמסין"], ["יא ראש בצל", "יא ראש בצל"], ["יא חציל עם ביטחון עצמי", "יא חציל עם ביטחון עצמי"], ["יא קומקום שורק", "יא קומקום שורק"], ["יא חמור עם אוזניות", "יא חמורה עם אוזניות"], ["יא צב על רולרבליידס", "יא צבה על רולרבליידס"], ["יא סבון שהחליק", "יא סבון שהחליק"], ["יא מטאטא עם דעות", "יא מטאטא עם דעות"], ["יא גבינה צהובה מזיעה", "יא גבינה צהובה מזיעה"], ["יא פטרייה עם וויי-פיי", "יא פטרייה עם וויי-פיי"], ["יא סנדל עם אגו", "יא סנדל עם אגו"], ["יא תרנגול בפיג׳מה", "יא תרנגולת בפיג׳מה"], ["יא שעון מעורר בלי סוללות", "יא שעון מעורר בלי סוללות"], ["יא מקרר שמתלונן", "יא מקרר שמתלונן"], ["יא גמל שהתבלבל במדבר", "יא גמלה שהתבלבלה במדבר"], ["יא עוגייה שנפלה לחלב", "יא עוגייה שנפלה לחלב"], ["יא ג׳ירפה עם פחד גבהים", "יא ג׳ירפה עם פחד גבהים"], ["יא זיקית שנתקעה על בז׳", "יא זיקית שנתקעה על בז׳"]];
const RANDOM_INSULTS = [["יא ראש של כרובית", "יא ראש של כרובית"], ["יא מוח של דג זהב", "יא מוח של דג זהב"], ["יא נמלה בפיג׳מה", "יא נמלה בפיג׳מה"], ["יא ברווז עם וויפיי חלש", "יא ברווזה עם וויפיי חלש"], ["יא אבטיח מבולבל", "יא אבטיח מבולבל"], ["יא תרנגול בלי שעון", "יא תרנגולת בלי שעון"], ["יא גמל בלי דבשת", "יא גמלה בלי דבשת"], ["יא חתול שנבהל ממלפפון", "יא חתולה שנבהלה ממלפפון"], ["יא מקרר מדבר", "יא מקרר מדבר"], ["יא כפית בלי מרק", "יא כפית בלי מרק"], ["יא קקטוס מחובק", "יא קקטוס מחובק"], ["יא לימון עם רגשות", "יא לימון עם רגשות"], ["יא ממחטה משומשת", "יא ממחטה משומשת"], ["יא פרה שמתאמנת לבלט", "יא פרה שמתאמנת לבלט"], ["יא שעון מעורר מקולקל", "יא שעון מעורר מקולקל"], ["יא גזר עם משקפיים", "יא גזר עם משקפיים"], ["יא חסה בפאניקה", "יא חסה בפאניקה"], ["יא סוס ים בחופשה", "יא סוסת ים בחופשה"], ["יא בננה מדוכאת", "יא בננה מדוכאת"], ["יא עוגייה שנשברה בתה", "יא עוגייה שנשברה בתה"], ["יא שלט בלי סוללות", "יא שלט בלי סוללות"], ["יא מברשת שיניים עייפה", "יא מברשת שיניים עייפה"], ["יא קרפדה עם אמביציות", "יא קרפדה עם אמביציות"], ["יא אינסטלטור של חלומות", "יא אינסטלטורית של חלומות"], ["יא ענן עם אסטמה", "יא ענן עם אסטמה"], ["יא פטריה עם כובע גדול מדי", "יא פטריה עם כובע גדול מדי"], ["יא פרפר שפחד לעוף", "יא פרפר שפחד לעוף"], ["יא נקניקייה בלחמניה של המבורגר", "יא נקניקייה בלחמניה של המבורגר"]];
const SILLY_INTROS = [["יש לי רק דבר אחד להגיד לך:", "יש לי רק דבר אחד להגיד לך:"], ["המלך קבע שמהיום קוראים לך:", "המלך קבע שמהיום קוראים לך:"], ["אחרי מחקר מעמיק, התברר שאתה:", "אחרי מחקר מעמיק, התברר שאת:"], ["בוקר טוב גם לך,", "בוקר טוב גם לך,"], ["ועכשיו, הכינוי הרשמי שלך:", "ועכשיו, הכינוי הרשמי שלך:"], ["מדענים בדקו ואישרו שאתה:", "מדענים בדקו ואישרו שאת:"], ["רגע לפני שאתה מתחיל את היום, תזכור שאתה:", "רגע לפני שאת מתחילה את היום, תזכרי שאת:"], ["ההורים שלך היו רוצים שתדע שאתה:", "ההורים שלך היו רוצים שתדעי שאת:"], ["אין דרך עדינה להגיד את זה. אתה:", "אין דרך עדינה להגיד את זה. את:"]];
const jokeCache = {};
function jokeFor(m){
  if (jokeCache[m.id]) return jokeCache[m.id];
  const f = m.gender === 'f';
  // half the time a silly nickname ("יא פיצה בלי תוספות"), half the time a biting set-up and twist
  const roll = Math.random();
  // a third of the time: a random dumb insult with no set-up at all
  if (roll < 0.33){ const n = RANDOM_INSULTS[Math.floor(Math.random() * RANDOM_INSULTS.length)]; return jokeCache[m.id] = { setup:'', punch:(f ? n[1] : n[0]) + '!' }; }
  if (roll < 0.66){
    const n = SILLY_NAMES[Math.floor(Math.random() * SILLY_NAMES.length)], i = SILLY_INTROS[Math.floor(Math.random() * SILLY_INTROS.length)];
    return jokeCache[m.id] = { setup: f ? i[1] : i[0], punch: (f ? n[1] : n[0]) + '!' };
  }
  const pool = SPLASH_JOKES.filter(j => roleOf(m.id) === 'child' || j[4] !== 'k');
  let ji = Math.floor(Math.random() * pool.length);
  try{ const last = localStorage.getItem('ft-joke'); if (pool[ji][1] === last) ji = (ji + 1) % pool.length; localStorage.setItem('ft-joke', pool[ji][1]); }catch(e){}
  const j = pool[ji];
  return jokeCache[m.id] = { setup: f ? j[2] : j[0], punch: f ? j[3] : j[1] };
}
function roastOf(m){ return roastFor[m.id] || (roastFor[m.id] = pickRoast(m.gender)); }
function pickRoast(g){
  const list = ROASTS[g === 'f' ? 'f' : 'm'];
  let last = -1; try{ last = Number(localStorage.getItem('ft-roast')); }catch(e){}
  let i = Math.floor(Math.random() * list.length); if (i === last) i = (i + 1) % list.length;
  try{ localStorage.setItem('ft-roast', String(i)); }catch(e){}
  return list[i];
}
// [set-up (m), twist (m), set-up (f), twist (f), 'k' = only for children]
const SPLASH_JOKES = [["חשבנו להציג אותך במוזיאון…", "באגף של מינים שלא התפתחו.", "חשבנו להציג אותך במוזיאון…", "באגף של מינים שלא התפתחו."], ["אתה מאוד חשוב למשפחה…", "בלעדיך לא היה לנו על מי לצחוק.", "את מאוד חשובה למשפחה…", "בלעדייך לא היה לנו על מי לצחוק."], ["המורה אמרה שיש לך פוטנציאל…", "היא אמרה את זה גם על העציץ בכיתה. הוא כבר עקף אותך.", "המורה אמרה שיש לך פוטנציאל…", "היא אמרה את זה גם על העציץ בכיתה. הוא כבר עקף אותך.", "k"], ["אמא אומרת שאתה מתנה משמיים…", "אבא עדיין מחפש את הקבלה.", "אמא אומרת שאת מתנה משמיים…", "אבא עדיין מחפש את הקבלה.", "k"], ["אתה כמו הודעה בקבוצה של המשפחה…", "כולם רואים, אף אחד לא עונה.", "את כמו הודעה בקבוצה של המשפחה…", "כולם רואים, אף אחד לא עונה."], ["אם הייתה אליפות בהתבכיינות…", "היית מתלונן שהגביע כבד מדי.", "אם הייתה אליפות בהתבכיינות…", "היית מתלוננת שהגביע כבד מדי."], ["כשאתה נכנס לחדר…", "הוויי-פיי נחלש ממבוכה.", "כשאת נכנסת לחדר…", "הוויי-פיי נחלש ממבוכה."], ["אתה ממש לא טיפש…", "פשוט יש לך רק שתי דעות: לא יודע, ולא אכפת לי.", "את ממש לא טיפשה…", "פשוט יש לך רק שתי דעות: לא יודעת, ולא אכפת לי."], ["אומרים שאתה דומה לאבא…", "אבא נעלב.", "אומרים שאת דומה לאבא…", "אבא נעלב.", "k"], ["ניסיתי לראות את העולם מנקודת המבט שלך…", "לא הצלחתי להוציא את הראש מהטלפון.", "ניסיתי לראות את העולם מנקודת המבט שלך…", "לא הצלחתי להוציא את הראש מהטלפון."], ["אתה כמו עדכון של המחשב…", "מגיע בזמן הכי גרוע ולא משפר כלום.", "את כמו עדכון של המחשב…", "מגיעה בזמן הכי גרוע ולא משפרת כלום."], ["אם היית ירק…", "היית הברוקולי שתמיד נשאר בצלחת.", "אם היית ירק…", "היית הברוקולי שתמיד נשאר בצלחת."], ["עשינו הצבעה משפחתית…", "מחליפים אותך בשואב אבק רובוטי. הוא לפחות מנקה.", "עשינו הצבעה משפחתית…", "מחליפים אותך בשואב אבק רובוטי. הוא לפחות מנקה."], ["רציתי להעליב אותך…", "אבל החדר שלך כבר עשה את זה יותר טוב.", "רציתי להעליב אותך…", "אבל החדר שלך כבר עשה את זה יותר טוב."], ["שאלתי את סירי מי הכי מבולגן בבית…", "היא שלחה לי את המיקום שלך.", "שאלתי את סירי מי הכי מבולגנת בבית…", "היא שלחה לי את המיקום שלך."], ["אתה כמו פאזל…", "חסרים לך כמה חלקים.", "את כמו פאזל…", "חסרים לך כמה חלקים."], ["אם היו נותנים נקודות על תירוצים…", "כבר היית קונה את הבית.", "אם היו נותנים נקודות על תירוצים…", "כבר היית קונה את הבית."], ["אתה תמיד מביא שמחה לבית…", "כשאתה יוצא ממנו.", "את תמיד מביאה שמחה לבית…", "כשאת יוצאת ממנו."], ["יש לך דקה להקשיב לי?", "ברור שיש לך. אתה הרי לא עושה כלום.", "יש לך דקה להקשיב לי?", "ברור שיש לך. את הרי לא עושה כלום."], ["אתה כמו מכונת כביסה…", "מסתובב במקום, רועש, ובסוף הכל עדיין מלוכלך.", "את כמו מכונת כביסה…", "מסתובבת במקום, רועשת, ובסוף הכל עדיין מלוכלך."], ["המלך רצה לתת לך עצה…", "אבל הוא לא מבזבז חוכמה על מי שלא יקשיב.", "המלך רצה לתת לך עצה…", "אבל הוא לא מבזבז חוכמה על מי שלא תקשיב."], ["אתה הסיבה שיש על השמפו הוראות…", "גם אז לא קראת.", "את הסיבה שיש על השמפו הוראות…", "גם אז לא קראת."], ["קראנו את היומן שלך…", "שלושה עמודים של 'עוד חמש דקות'.", "קראנו את היומן שלך…", "שלושה עמודים של 'עוד חמש דקות'."], ["אתה כמו האינטרנט בבית ספר…", "איטי, נתקע, ובסוף כולם מוותרים.", "את כמו האינטרנט בבית ספר…", "איטית, נתקעת, ובסוף כולם מוותרים."], ["יש לך כישרון נדיר…", "להפוך חדר לפח זבל בעשר דקות.", "יש לך כישרון נדיר…", "להפוך חדר לפח זבל בעשר דקות."], ["רצינו לעשות לך מסיבת הפתעה…", "אף אחד לא הסכים לבוא.", "רצינו לעשות לך מסיבת הפתעה…", "אף אחד לא הסכים לבוא."], ["אתה כמו השלט של המזגן…", "תמיד נעלם בדיוק כשצריך אותך.", "את כמו השלט של המזגן…", "תמיד נעלמת בדיוק כשצריך אותך."], ["אם היו מחלקים פרס על מאמץ…", "היית מתעצל לבוא לקחת אותו.", "אם היו מחלקים פרס על מאמץ…", "היית מתעצלת לבוא לקחת אותו."], ["הצל שלך ביקש לשמור מרחק…", "הוא אומר שאתה מביך אותו.", "הצל שלך ביקש לשמור מרחק…", "הוא אומר שאת מביכה אותו."], ["אתה כמו פרסומת ביוטיוב…", "כולם רק מחכים שתיגמר.", "את כמו פרסומת ביוטיוב…", "כולם רק מחכים שתיגמרי."], ["מדדנו כמה זמן לוקח לך לסדר את החדר…", "השעון עדיין רץ. מאז 2023.", "מדדנו כמה זמן לוקח לך לסדר את החדר…", "השעון עדיין רץ. מאז 2023."], ["אתה הבן הכי טוב שיש לנו…", "בתחרות של מתמודד אחד.", "את הבת הכי טובה שיש לנו…", "בתחרות של מתמודדת אחת.", "k"], ["המחשבון שלך ביקש לפרוש…", "נמאס לו לעשות לך את שיעורי הבית.", "המחשבון שלך ביקש לפרוש…", "נמאס לו לעשות לך את שיעורי הבית.", "k"], ["אתה כמו יום ראשון בבוקר…", "אף אחד לא שמח לראות אותך.", "את כמו יום ראשון בבוקר…", "אף אחד לא שמח לראות אותך."], ["אם היית אפליקציה…", "היו מוחקים אותך כדי לפנות מקום.", "אם היית אפליקציה…", "היו מוחקים אותך כדי לפנות מקום."], ["אתה כמו קבוצת וואטסאפ של ועד הבית…", "רועש, מעצבן, ואין דרך לצאת.", "את כמו קבוצת וואטסאפ של ועד הבית…", "רועשת, מעצבנת, ואין דרך לצאת."], ["ביקשנו מבינה מלאכותית לתאר אותך…", "היא ביקשה הפסקה.", "ביקשנו מבינה מלאכותית לתאר אותך…", "היא ביקשה הפסקה."], ["אתה בדיוק כמו ממתק…", "מזיק, מיותר, ואף אחד לא צריך אותך באמת.", "את בדיוק כמו ממתק…", "מזיקה, מיותרת, ואף אחד לא צריך אותך באמת."]];
const splashState = { gone: false, close: null, personalized: false, timer: null };
// Last week's winner on the splash, once the logs are in (it can arrive after the personal line).
function splashWinner(){
  const el = $('splashWinner'); if (!el || splashState.gone || !S.logsLoaded || !el.hidden) return;
  const w = lastWeekWinners(); if (!w) return;
  const f = w.ids.length === 1 && member(w.ids[0])?.gender === 'f';
  el.textContent = `🏆 ${w.ids.length > 1 ? 'המנצחים' : f ? 'המנצחת' : 'המנצח'} של השבוע שעבר: ${w.ids.map(mName).join(' ו')} · ${w.pts} נקודות`;
  el.hidden = false;
}
function updateSplash(){
  splashWinner();
  if (splashState.gone || splashState.personalized) return;
  const id = S.boundId; const m = id ? member(id) : null;
  if (S.isAdmin || (m && roleOf(id) === 'admin')){
    splashState.personalized = true;
    const pj = praiseJokeOf();
    const su = $('splashSetup'); su.textContent = pj.setup; su.hidden = false;
    const r = $('splashRoast'); r.hidden = true; r.textContent = pj.punch; r.classList.add('praise'); r.classList.toggle('long', pj.punch.length > 18);
    setTimeout(() => { if (!splashState.gone){ r.hidden = false; r.classList.add('stamp'); } }, 1400);
    clearTimeout(splashState.timer); splashState.timer = setTimeout(splashState.close, pj.punch.length > 18 ? 5200 : 4400);
    return;
  }
  if (!m) return;
  splashState.personalized = true;
  $('splashKicker').textContent = 'הודעה מהמלך רותם';
  $('splashTitle').textContent = `${greeting()}, ${m.name}`;
  // two beats: a set-up line that sounds nice, then the punchline lands in a different style
  const jk = jokeFor(m);
  const su = $('splashSetup'); su.textContent = jk.setup; su.hidden = !jk.setup;
  const r = $('splashRoast'); r.hidden = true; r.textContent = jk.punch; r.classList.toggle('long', r.textContent.length > 18);
  setTimeout(() => { if (!splashState.gone){ r.hidden = false; r.classList.add('stamp'); } }, jk.setup ? 1400 : 700);
  clearTimeout(splashState.timer); splashState.timer = setTimeout(splashState.close, r.textContent.length > 18 ? 5200 : 4400); // time for the set-up and the punchline
}
(function splash(){
  const el = $('splash'); if (!el) return;
  el.hidden = false;
  splashState.close = () => { if (splashState.gone) return; splashState.gone = true; el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 450); };
  el.addEventListener('click', () => splashState.close());
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // wait (up to 6s) until we know who is signed in, so a child sees the personal line
  const start = Date.now();
  const tryClose = () => { if (splashState.personalized) return; if (S.adminChecked && S.bindLoaded || Date.now() - start > 6000) splashState.close(); else splashState.timer = setTimeout(tryClose, 300); };
  splashState.timer = setTimeout(tryClose, reduce ? 1800 : 3200);
})();

/* ---------- boot ---------- */
if (/[?&]kitchen=1/.test(location.search)) S.kitchenOpen = true;
buildStatic(); render();
let lastDay = today();
setInterval(() => { if (today() !== lastDay){ lastDay = today(); render(); } }, 60000);
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open === 'kitchen'){ S.kitchenOpen = true; S.tab = 'family'; render(); } });

if (!firebaseConfig || String(firebaseConfig.apiKey).startsWith('PASTE')){
  $('setup').hidden = false;
} else {
  const app = initializeApp(firebaseConfig); fbApp = app;
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const auth = getAuth(app);
  getRedirectResult(auth).catch(e => console.error(e));

  // Google sign-in through Google's own button / account chooser (works inside the installed phone app,
  // where Firebase's popup and redirect flows break). Falls back to the popup when no client ID is set.
  const hasGIS = () => cfg.googleClientId && !String(cfg.googleClientId).startsWith('PASTE');
  let gisLoad = null, gisInit = false;
  const loadGIS = () => gisLoad || (gisLoad = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisLoad = null; rej(new Error('gsi load failed')); }; document.head.appendChild(s); }));
  async function showGoogleButton(boxId = 'ag-gbtn'){
    const box = $(boxId); if (!hasGIS()){ box.hidden = true; if (boxId === 'login-gbtn') $('login-gfallback').hidden = false; return; }
    try{
      await loadGIS();
      if (!gisInit){
        google.accounts.id.initialize({ client_id: cfg.googleClientId, use_fedcm_for_prompt: true, auto_select: false, cancel_on_tap_outside: true,
          callback: async r => {
            try{ await signInWithCredential(auth, GoogleAuthProvider.credential(r.credential)); closeAdminGate(); toast('נכנסת עם גוגל'); }
            catch(e){ console.error(e); toast('הכניסה עם גוגל לא הצליחה'); }
          } });
        gisInit = true;
      }
      box.hidden = false; box.replaceChildren();
      google.accounts.id.renderButton(box, { theme:'outline', size:'large', shape:'pill', text:'signin_with', locale:'he', width: 260 });
    }catch(e){ console.error(e); box.hidden = true; if (boxId === 'login-gbtn') $('login-gfallback').hidden = false; }
  }
  openAdminGateHook = () => showGoogleButton('ag-gbtn');
  loginGoogleHook = id => showGoogleButton(id);
  async function adminSignIn(){
    if (hasGIS()){ try{ await loadGIS(); showGoogleButton(); google.accounts.id.prompt(); }catch(e){ console.error(e); } return; }
    const provider = new GoogleAuthProvider();
    try{ await signInWithPopup(auth, provider); }
    catch(e){
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment'){ await signInWithRedirect(auth, provider); }
      else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request'){ console.error(e); toast('הכניסה לא הצליחה'); }
    }
  }
  let taps = [];
  $('appTitle').addEventListener('click', () => {
    const now = Date.now(); taps = taps.filter(t => now - t < 4000); taps.push(now);
    if (taps.length >= 5){ taps = []; if (S.isAdmin && S.plain){ S.plain = false; store.set('ft-plain', '0'); S.tab = 'admin'; render(); toast('חזרת לניהול 👑'); } else if (!S.isAdmin) openAdminGate(); }
  });
  $('ag-google').addEventListener('click', () => { if (!hasGIS()) closeAdminGate(); adminSignIn(); });
  $('login-go').addEventListener('click', loginGo);
  $('login-code').addEventListener('keydown', e => { if (e.key === 'Enter') loginGo(); });
  $('login-back').addEventListener('click', () => { S.loginPick = null; S.loginErr = ''; render(); });
  $('switchUser').addEventListener('click', switchUser);
  $('login-gfallback').addEventListener('click', adminSignIn);
  $('join-go').addEventListener('click', sendJoin);
  $('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') sendJoin(); });
  $('join-link').addEventListener('change', () => { $('join-link').blur(); render(); });
  $('join-out').addEventListener('click', () => signOut(auth));
  $('wait-out').addEventListener('click', () => signOut(auth));
  $('wait-cancel').addEventListener('click', cancelJoin);
  // Leaving admin mode: drop the code session; a Google sign-in is signed out (the device returns to its family member).
  $('plainBtn').addEventListener('click', () => { S.plain = true; store.set('ft-plain', '1'); S.tab = 'today'; render(); window.scrollTo(0, 0); toast('מצב רגיל. השליטה נשארת אצלך. 5 לחיצות על הכותרת מחזירות לניהול.'); });
  $('logoutBtn').addEventListener('click', async () => {
    S.plain = false; store.set('ft-plain', '0');
    S.tab = 'today';
    try{ if (S.user) await deleteDoc(doc(db,'adminSessions',S.user.uid)); }catch(e){}
    S.codeAdmin = false;
    if (S.user && !S.user.isAnonymous) await signOut(auth);
    toast('יצאת ממצב מנהל'); render();
  });

  onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    // Admin = allowed to read private/admin (Google account of the admin, or this device's admin code).
    S.user = user; S.isAdmin = false; S.realAdmin = false; S.viewAs = null; S.adminChecked = false; S.joins = []; S.myJoin = null;
    if (!user){ signInAnonymously(auth).catch(e => { console.error(e); status('לא הצלחנו להתחבר. בדקו שכניסה אנונימית מופעלת ב-Firebase.'); }); render(); return; }
    status('');
    const sub = (name, fn) => unsubs.push(onSnapshot(collection(db, name),
      s => { fn(s.docs.map(x => ({ id:x.id, ...x.data({ serverTimestamps:'estimate' }) }))); render(); },
      e => { console.error(e); status(e.code === 'permission-denied' ? 'אין הרשאה לקרוא את הנתונים. בדקו את חוקי האבטחה ב-Firebase.' : 'בעיה בחיבור לנתונים.'); }));
    sub('members', a => { S.members = a.sort((x,y) => (x.order||0) - (y.order||0)); if (!S.memInit){ S.memInit = true; resetMemberForm(); } });
    sub('tasks', a => { S.tasks = a; });
    sub('logs', a => { S.logs = a; S.logsLoaded = true; });
    sub('complaints', a => { S.complaints = a; });
    unsubs.push(onSnapshot(doc(db,'nudges','challenge'), s => { S.nudgeCh = s.exists() ? s.data() : null; render(); }, () => {}));
    sub('cpComments', a => { S.cpComments = a; });
    sub('challengeJoins', a => { S.cjoins = Object.fromEntries(a.map(j => [j.id, j])); });
    sub('challengeItems', a => { S.citems = Object.fromEntries(a.map(d => [d.id, d])); });
    sub('dishes', a => kDishesIn(a));
    sub('photos', a => { S.photos = Object.fromEntries(a.map(p => [p.id, p])); });
    sub('timers', a => { S.timers = a; });
    sub('messages', a => { S.messages = a; });
    sub('profiles', a => { S.profiles = Object.fromEntries(a.map(p => [p.id, p])); });
    sub('rewards', a => { S.rewards = a; });
    S.binding = null; S.bindLoaded = false;
    unsubs.push(onSnapshot(doc(db,'bindings',user.uid), s => {
      S.binding = s.exists() ? s.data() : null; S.bindLoaded = true; render();
    }, e => { console.error(e); S.bindLoaded = true; render(); }));
    S.pins = {}; let pinsUnsub = null;
    const startAdminSubs = () => { if (pinsUnsub) return;
      pinsUnsub = onSnapshot(collection(db,'pins'), s => { S.pins = Object.fromEntries(s.docs.map(p => [p.id, p.data().pin])); render(); }, e => console.error(e));
      unsubs.push(() => { pinsUnsub && pinsUnsub(); pinsUnsub = null; }); };
    let joinsUnsub = null;
    const startJoinsSub = () => { if (joinsUnsub) return;
      joinsUnsub = onSnapshot(collection(db,'joinRequests'), s => { S.joins = s.docs.map(d => ({ id:d.id, ...d.data() })); render(); }, e => console.error(e));
      unsubs.push(() => { joinsUnsub && joinsUnsub(); joinsUnsub = null; }); };
    let devUnsub = null;
    const startDevSub = () => { if (devUnsub) return;
      devUnsub = onSnapshot(collection(db,'devNotes'), s => { S.devNotes = s.docs.map(d => ({ id:d.id, ...d.data() })); render(); }, e => console.error(e));
      unsubs.push(() => { devUnsub && devUnsub(); devUnsub = null; }); };
    const checkAdmin = async hasSession => {
      let ok = false;
      if (hasSession || !user.isAnonymous){ try{ await getDoc(doc(db,'private','admin')); ok = true; }catch(e){ ok = false; } }
      S.isAdmin = ok; S.realAdmin = ok; if (!ok) S.viewAs = null; S.adminChecked = true;
      if (ok){ startAdminSubs(); startJoinsSub(); startDevSub(); unsubs.push(onSnapshot(collection(db,'pushTokens'), s => { S.tokens = s.docs.map(d => ({ id:d.id, ...d.data() })); render(); }, e => console.error(e))); } else { S.pins = {}; S.joins = []; S.devNotes = []; }
      render();
    };
    // Admin by code: this device holds adminSessions/<uid> with the admin code; it counts while the code is current.
    unsubs.push(onSnapshot(doc(db,'adminSessions',user.uid), s => checkAdmin(s.exists()), e => { console.error(e); checkAdmin(false); }));
    // A Google account that isn't on the board yet: its own join request, if it sent one.
    if (!user.isAnonymous) unsubs.push(onSnapshot(doc(db,'joinRequests',user.uid), s => { S.myJoin = s.exists() ? s.data() : null; render(); }, e => console.error(e)));
    unsubs.push(onSnapshot(doc(db,'settings','goal'), s => {
      S.goal = s.exists() ? s.data() : null;
      if (S.goal && document.activeElement !== $('gl-target') && document.activeElement !== $('gl-prize')){ $('gl-target').value = S.goal.target || ''; $('gl-prize').value = S.goal.prize || ''; }
      render();
    }, e => console.error(e)));
    unsubs.push(onSnapshot(doc(db,'settings','challenge'), s => {
      S.challenge = s.exists() ? s.data() : null; const c = S.challenge;
      render();
    }, e => console.error(e)));
    unsubs.push(onSnapshot(doc(db,'settings','perms'), s => { S.perms = s.exists() ? s.data() : {}; render(); }, e => console.error(e)));
    unsubs.push(onSnapshot(doc(db,'settings','money'), s => {
      const m = s.exists() ? s.data() : { points:100, shekels:0 };
      S.money = { points:Number(m.points) || 100, shekels:Number(m.shekels) || 0 };
      if (document.activeElement !== $('mo-points') && document.activeElement !== $('mo-shekels')){
        $('mo-points').value = S.money.points; $('mo-shekels').value = S.money.shekels;
      }
      updateHint(); render();
    }, e => console.error(e)));
    render();
  });
}
