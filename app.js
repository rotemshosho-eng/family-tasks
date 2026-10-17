import * as cfg from './firebase-config.js';
const firebaseConfig = cfg.firebaseConfig;
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithCredential } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const DAYS = ['א','ב','ג','ד','ה','ו','ש'];
const COLORS = ['#2A7F9E','#C0504D','#7B5EA7','#C97F14','#3B8C4A','#C2577F','#4F6D7A','#8A6D3B'];
const S = { rewards:[], joins:[], myJoin:null, adminChecked:false, boundId:null, profiles:{}, profileOpen:null, seen:{}, binding:null, bindLoaded:false, pins:{}, loginPick:null, loginErr:'', members:[], tasks:[], logs:[], timers:[], messages:[], chatOpen:null, chatDraft:'', delAsk:null, money:{ points:100, shekels:0 }, me:'all', tab:'today', isAdmin:false, user:null,
  editTask:null, editMember:null, armed:null, busy:new Set(), openPick:null, memInit:false };
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
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const dow = () => new Date().getDay();
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return dstr(d); };
const store = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} } };
S.me = store.get('ft-me') || 'all';
S.seen = (() => { try{ return JSON.parse(store.get('ft-seen') || '{}') || {}; }catch(e){ return {}; } })();

let toastT;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function fail(e){ console.error(e); const c = e && e.code;
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
const counted = l => l.approved !== false;
const doneCount = t => S.logs.filter(l => l.taskId === t.id && (l.kind === 'task' || l.kind === 'timed')).length;
// Rotation: the turn moves to the next person each time the task is done.
function whoseTurn(t){
  if (t.assignee !== 'rotate') return t.assignee || 'all';
  const r = (t.rotation || []).filter(id => member(id));
  return r.length ? r[doneCount(t) % r.length] : 'all';
}
function assigneeLabel(t){
  const w = whoseTurn(t);
  if (t.assignee === 'rotate') return w === 'all' ? 'תורנות' : `תורנות · התור של ${mName(w)}`;
  return w === 'all' ? 'מי שרוצה' : mName(w);
}
const isMine = t => { const w = whoseTurn(t); return S.me === 'all' || w === S.me || w === 'all'; };
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
function isDue(t){
  if (t.pending) return false;
  if (t.type === 'once') return !S.logs.some(l => l.taskId === t.id);
  return (t.days || []).includes(dow()) && !S.logs.some(l => l.taskId === t.id && l.day === today());
}
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
    await addDoc(collection(db,'logs'), { kind:'task', taskId:t.id, title:t.title, memberId, points:Number(t.points)||0, ...(t.check ? { approved:false } : {}), day:today(), at:Date.now() });
    toast(t.check ? `נשלח לאישור: ${t.points} נקודות יתווספו אחרי בדיקה` : `${mName(memberId)} קיבל/ה ${t.points} נקודות`);
  }catch(e){ fail(e); } finally{ S.busy.delete(t.id); render(); }
}
async function startTimer(t, memberId){
  const id = timerId(t.id, memberId);
  if (!db || S.busy.has(id)) return; S.busy.add(id); S.openPick = null; render();
  try{
    await setDoc(doc(db,'timers',id), { taskId:t.id, memberId, startedAt: serverTimestamp() });
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
      minutes:r.minutes, points:r.points, timerId:tm.id, ...(t.check ? { approved:false } : {}), day:today(), at:Date.now() });
    b.delete(doc(db,'timers',tm.id));
    await b.commit();
    toast(`${mName(tm.memberId)}: ${r.minutes} דקות, ${r.points} נקודות`);
  }catch(e){ fail(e); } finally{ S.busy.delete(tm.id); render(); }
}
async function cancelTimer(tm){ try{ await deleteDoc(doc(db,'timers',tm.id)); toast('הטיימר בוטל'); }catch(e){ fail(e); } }
async function removeLog(l){ try{ await deleteDoc(doc(db,'logs',l.id)); toast('בוטל'); }catch(e){ fail(e); } }

/* ---------- render ---------- */
function render(){
  // The admin's own screen gets a gold background.
  document.body.classList.toggle('royal', !!S.isAdmin || (!!S.boundId && isAdminMember(S.boundId)));
  const typing = document.activeElement && document.activeElement.id === 'chat-input';
  const d = new Date();
  $('dateline').textContent = `יום ${DAYS[d.getDay()]}׳, ${d.getDate()}.${d.getMonth()+1}`;
  if (!S.isAdmin && S.tab === 'admin') S.tab = 'today';
  $('tabs').hidden = !S.user;
  $('tabs').querySelector('[data-tab="admin"]').hidden = !S.isAdmin;
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab));
  if (!['today','tasks','rewards','family','admin'].includes(S.tab)) S.tab = 'today';
  const VIEWS = ['today','tasks','rewards','family','admin'];
  const hideViews = () => VIEWS.forEach(v => $('view-'+v).hidden = true);
  VIEWS.forEach(v => $('view-'+v).hidden = S.tab !== v);
  // A family member's device is locked to whoever signed in with their code. Only the admin can view as anyone.
  // Who this device belongs to: a Google account linked to a member, or a member's code.
  const isGoogle = !!S.user && !S.user.isAnonymous;
  const gMember = isGoogle ? S.members.find(m => m.uid && m.uid === S.user.uid) : null;
  const bound = S.isAdmin ? null : (gMember ? gMember.id : (S.binding && member(S.binding.memberId) ? S.binding.memberId : null));
  S.boundId = bound;
  const ready = S.bindLoaded && S.adminChecked;
  const needLogin = !!S.user && !S.isAdmin && ready && !bound;
  if (bound) S.me = bound;
  else if (!S.isAdmin) S.me = 'all';
  if (S.me !== 'all' && !member(S.me) && S.members.length) S.me = 'all';
  $('login').hidden = !needLogin;
  if (needLogin){ hideViews(); $('tabs').hidden = true; S.chatOpen = null; S.profileOpen = null; renderChatSheet(); renderProfileSheet(); renderLogin(); }
  if (!S.isAdmin && !ready && S.user){ hideViews(); $('tabs').hidden = true; return; }
  renderHero(bound);
  $('who').hidden = !S.isAdmin;
  $('meBar').hidden = !bound;
  if (bound){ const m = member(bound); $('meName').textContent = `שלום, ${m.name}`; $('meAva').textContent = avatarOf(m.id); $('meAva').style.background = m.color; }
  const nPend = S.tasks.filter(t => t.pending || t.reviewed === false).length + (S.isAdmin ? S.joins.length + S.logs.filter(l => !counted(l)).length : 0);
  $('tabs').querySelector('[data-tab="admin"] .nl').textContent = nPend ? `ניהול (${nPend})` : 'ניהול';
  renderChatSheet(); renderProfileSheet(); updateSplash();
  $('sgSec').hidden = !S.user || S.isAdmin || !bound || needLogin;
  if (needLogin) return;
  renderWho(); renderBoard(); renderToday(); renderProgress(); renderGoal(); renderAllTasks(); renderRewards(); renderPending(); renderAuth(); syncSelects();
  if (S.isAdmin){ renderAdminLists(); renderJoins(); }
  const cl = $('chat-list'); if (cl) cl.scrollTop = cl.scrollHeight;
  if (typing){ const ci = $('chat-input'); if (ci){ ci.focus({ preventScroll:true }); const n = ci.value.length; try{ ci.setSelectionRange(n, n); }catch(e){} } }
}
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
    if (S.myJoin) $('wait-name').textContent = S.myJoin.name;
    else if (!$('join-name').value && S.user.displayName && document.activeElement !== $('join-name')) $('join-name').value = S.user.displayName.split(' ')[0].slice(0, 20);
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
async function sendJoin(){
  const name = $('join-name').value.trim(); const color = (document.querySelector('input[name=join-color]:checked') || {}).value || COLORS[0];
  if (!name){ toast('כתבו איך לקרוא לך'); $('join-name').focus(); return; }
  const btn = $('join-go'); btn.disabled = true;
  try{ await setDoc(doc(db,'joinRequests',S.user.uid), { name, color, email: S.user.email || '', at: Date.now() }); toast('הבקשה נשלחה'); }
  catch(e){ fail(e); } finally{ btn.disabled = false; }
}
async function cancelJoin(){ try{ await deleteDoc(doc(db,'joinRequests',S.user.uid)); }catch(e){ fail(e); } }
async function approveJoin(j){
  try{
    const b = writeBatch(db);
    b.set(doc(collection(db,'members')), { name: j.name, color: j.color || COLORS[0], order: Date.now(), uid: j.id, email: j.email || '' });
    b.delete(doc(db,'joinRequests',j.id));
    await b.commit(); toast(`${j.name} הצטרף/ה ללוח`);
  }catch(e){ fail(e); }
}
async function rejectJoin(j){ try{ await deleteDoc(doc(db,'joinRequests',j.id)); toast('הבקשה נדחתה'); }catch(e){ fail(e); } }
function renderJoins(){
  $('joinsPanel').hidden = !S.joins.length; $('joinsCount').textContent = S.joins.length ? String(S.joins.length) : '';
  const L = $('joinsList'); L.replaceChildren();
  S.joins.slice().sort((a,b) => (a.at||0) - (b.at||0)).forEach(j => L.append(h('div', { class:'arow' },
    h('div', { class:'ava sm', style:`background:${j.color || COLORS[0]}` }, (j.name || '?').charAt(0)),
    h('div', { class:'t' }, h('strong', null, j.name), h('small', null, j.email || '')),
    h('button', { type:'button', class:'btn small', onclick:() => approveJoin(j) }, 'אישור'),
    armedBtn('j'+j.id, 'דחייה', () => rejectJoin(j)))));
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
  $('sg-panel').hidden = !open; $('sg-toggle').hidden = open; $('sg-toggle').setAttribute('aria-expanded', String(open));
  if (open){ if (S.me !== 'all' && member(S.me)) $('sg-assignee').value = S.me; $('sg-title').focus(); }
}
function setSgMode(m){ $(m === 'timed' ? 'sg-mode-timed' : 'sg-mode-fixed').checked = true; $('sg-fixed-row').hidden = m === 'timed'; $('sg-timed-row').hidden = m !== 'timed'; }
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
  if (!timed && (!Number.isFinite(points) || points < 0 || points > 1000)){ toast('נקודות: מספר בין 0 ל-1000'); return; }
  if (timed && (!(ratePerMin >= 1) || ratePerMin > 100)){ toast('נקודות לדקה: מספר בין 1 ל-100'); return; }
  if (timed && (!(maxMinutes >= 1) || maxMinutes > 240)){ toast('תקרה: בין 1 ל-240 דקות'); return; }
  const assignee = $('sg-assignee').value || 'all';
  const rotation = assignee === 'rotate' ? [...$('sg-rot').querySelectorAll('input:checked')].map(i => i.value) : [];
  if (assignee === 'rotate' && rotation.length < 2){ toast('בתורנות צריך לפחות שני בני משפחה'); return; }
  const btn = $('sg-save'); btn.disabled = true;
  try{
    await addDoc(collection(db,'tasks'), { title, assignee, type, days, timed, check: $('sg-check').checked,
      ...(assignee === 'rotate' ? { rotation } : {}),
      ...(timed ? { ratePerMin, maxMinutes } : { points }), reviewed:false,
      suggestedBy: S.me !== 'all' && member(S.me) ? S.me : null, createdAt: Date.now() });
    toast('המשימה נוספה');
    $('sg-title').value = ''; $('sg-check').checked = false; $('sg-rot').querySelectorAll('input').forEach(i => i.checked = false); setSgMode('fixed'); toggleSuggest(false);
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
    own ? h('section', { class:'panel' }, h('h2', null, 'בחירת תמונה'),
      h('div', { class:'ava-grid' },
        (isAdminMember(m.id) ? ADMIN_AVATARS : []).map(a => h('button', { type:'button', class:'ava-pick special', title:'תמונה של מנהל', 'aria-pressed':String(S.profiles[m.id]?.avatar === a), onclick:() => setAvatar(m.id, a) }, a)),
        AVATARS.map(a => h('button', { type:'button', class:'ava-pick', 'aria-pressed':String(S.profiles[m.id]?.avatar === a), onclick:() => setAvatar(m.id, a) }, a)))) : null,
    own ? notifPanel(m.id) : null,
    h('section', { class:'panel' }, h('h2', null, 'מה נעשה לאחרונה'),
      st.recent.length ? h('div', null, st.recent.map(l => { const p = Number(l.points) || 0; const [, mo, da] = (l.day || '--').split('-');
        return h('div', { class:'arow' }, h('div', { class:'t' }, h('strong', null, l.kind === 'bonus' ? `עדכון: ${l.title}` : l.title), h('small', null, `${+da}.${+mo}${l.minutes ? ` · ${l.minutes} דק׳` : ''}`)),
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
    note = 'התראות פעילות בטלפון הזה: הודעות בצ\'אט, משימות חדשות ותזכורת בערב על מה שנשאר.';
    btn = h('button', { type:'button', class:'btn ghost', onclick:() => disablePush() }, 'כיבוי התראות');
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
  try{ await addDoc(collection(db,'messages'), { taskId:t.id, memberId:S.me, text:text.slice(0,1000), at: serverTimestamp() }); }
  catch(e){ S.chatDraft = text; fail(e); render(); }
}
function renderWho(){
  const w = $('who'); w.replaceChildren(h('span', { class:'lbl' }, 'מי משתמש עכשיו:'));
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
    for (const l of S.logs){ if (l.memberId !== m.id || l.kind === 'redeem' || !counted(l)) continue; const p = Number(l.points) || 0; tot += p; if (l.day >= ws) wk += p; }
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
  const due = S.tasks.filter(t => isDue(t) && mine(t)).sort((a,b) => (!!b.pinned - !!a.pinned) || (a.type === 'once') - (b.type === 'once') || ((b.points||0) - (a.points||0)));
  $('todoTitle').textContent = S.me === 'all' ? 'מה נשאר להיום' : `מה נשאר ל${mName(S.me)} היום`;
  $('todoCount').textContent = due.length ? `${due.length} משימות` : '';
  const L = $('todo'); L.replaceChildren();
  if (!S.tasks.length) L.append(h('div', { class:'empty' }, h('strong', null, 'אין עדיין משימות'),
    S.isAdmin ? 'הוסיפו משימה בלשונית ניהול: שם, כמה נקודות, של מי, ובאילו ימים.' : 'עוד לא נוספו משימות ללוח.'));
  else if (!due.length) L.append(h('div', { class:'empty' }, h('strong', null, 'הכל בוצע להיום'), 'משימות חוזרות יופיעו שוב ביום שלהן.'));
  due.forEach(t => L.append(taskCard(t, true)));
  const td = today();
  const done = S.logs.filter(l => (l.kind === 'task' || l.kind === 'timed') && l.day === td && (S.me === 'all' || l.memberId === S.me)).sort((a,b) => b.at - a.at);
  $('doneSec').hidden = !done.length;
  $('doneCount').textContent = done.length ? `${done.filter(counted).reduce((s,l) => s + (Number(l.points)||0), 0)} נקודות` : '';
  const D = $('doneList'); D.replaceChildren();
  done.forEach(l => D.append(h('div', { class:'done' + (counted(l) ? '' : ' waiting') },
    h('span', { class:'dot', style:`background:${mColor(l.memberId)}` }),
    h('span', { class:'t' }, `${l.title} · ${mName(l.memberId)}` + (l.minutes ? ` · ${l.minutes} דק׳` : '')),
    counted(l) ? h('span', { class:'num gold' }, `+${l.points}`) : h('span', { class:'wait-tag' }, 'מחכה לאישור'),
    h('button', { type:'button', class:'btn ghost small', onclick:() => removeLog(l) }, 'ביטול'))));
}


/* ---------- home: greeting, progress, task cards ---------- */
function greeting(){ const hr = new Date().getHours(); return hr < 5 ? 'לילה טוב' : hr < 12 ? 'בוקר טוב' : hr < 17 ? 'צהריים טובים' : hr < 21 ? 'ערב טוב' : 'לילה טוב'; }
function renderHero(bound){
  const who = bound || (S.me !== 'all' ? S.me : null);
  const m = who ? member(who) : null;
  $('appTitle').textContent = m ? `${greeting()}, ${m.name}!` : `${greeting()}!`;
  const hr = $('heroRoast'); const showRoast = !!m && !S.isAdmin && roleOf(m.id) !== 'admin';
  hr.hidden = !showRoast; if (showRoast) hr.textContent = `${greeting()} ${m.name}, ${roastOf(m)}`;
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
function renderProgress(){
  const mine = isMine;
  const left = S.tasks.filter(t => isDue(t) && mine(t)).length;
  const td = today();
  const doneIds = new Set(S.logs.filter(l => (l.kind === 'task' || l.kind === 'timed') && l.day === td && (S.me === 'all' || l.memberId === S.me)).map(l => l.taskId));
  const done = doneIds.size, total = done + left;
  const pct = total ? Math.round(done / total * 100) : 0;
  $('progress').hidden = !total;
  $('progPct').textContent = `${pct}%`;
  $('progFill').style.width = `${pct}%`;
  $('progText').textContent = left ? `${done} מתוך ${total} משימות הושלמו` : 'כל המשימות של היום הושלמו 🎉';
}
const ICONS = [[/זבל|פח/, '🗑️'], [/כלים|מדיח/, '🍽️'], [/כביס|לתלות|לקפל/, '🧺'], [/מיטה|חדר|לסדר|מדפ/, '🛏️'], [/כלב/, '🐕'], [/חתול/, '🐈'],
  [/לקרוא|ספר/, '📚'], [/שיעורי|ללמוד|מבחן/, '✏️'], [/להשקות|גינה|עציצ|צמח/, '🪴'], [/לבשל|ארוחה|מטבח|אוכל|שולחן/, '🍳'], [/שיניים|מקלחת|אמבט/, '🪥'],
  [/שואב|לטאטא|לנקות|ניקיון|אבק/, '🧹'], [/רצפה|לשטוף/, '🧽'], [/קניות|סופר/, '🛒'], [/נגינה|לנגן|פסנתר|גיטרה/, '🎵'], [/ספורט|ריצה|אימון|כדור/, '⚽']];
const taskIcon = t => (ICONS.find(([re]) => re.test(t.title || '')) || [null, '📋'])[1];
// One task as a card. canAct: show the finish/start control (tasks due today).
function taskCard(t, canAct){
  const turn = whoseTurn(t); const who = turn === 'all' ? (S.me !== 'all' ? S.me : null) : turn;
  const timed = isTimed(t);
  const running = timed ? S.timers.filter(tm => tm.taskId === t.id && member(tm.memberId) && (S.me === 'all' || tm.memberId === S.me)) : [];
  const whoRunning = who && running.some(tm => tm.memberId === who);
  const busy = S.busy.has(t.id) || (who && S.busy.has(timerId(t.id, who)));
  const act = timed ? (m => startTimer(t, m)) : (m => complete(t, m));
  const go = () => { if (who && member(who)) act(who); else { S.openPick = S.openPick === t.id ? null : t.id; render(); } };
  const meta = [h('span', { class:'pts-line' }, h('span', { class:'star', 'aria-hidden':'true' }, '★'), timed ? `${t.ratePerMin} נקודות לדקה, עד ${t.maxMinutes} דק׳` : `${t.points} נקודות`)];
  const sub = [assigneeLabel(t), recLabel(t)];
  if (t.check) sub.push('צריך אישור');
  if (t.pinned) sub.unshift('נעוצה');
  let control = null;
  if (canAct && !whoRunning){
    control = timed
      ? h('button', { type:'button', class:'btn small start', disabled: busy || !S.members.length, onclick: go }, busy ? 'שומר…' : 'התחלתי')
      : h('button', { type:'button', class:'donecheck', 'aria-label':`סיימתי: ${t.title}`, disabled: busy || !S.members.length, onclick: go }, busy ? '…' : '');
  }
  const card = h('div', { class:'task' + (t.pinned ? ' pinned' : '') },
    h('div', { class:'ticon', 'aria-hidden':'true' }, taskIcon(t)),
    h('div', { class:'body' }, h('span', { class:'title' }, t.title), h('div', { class:'meta' }, meta),
      h('span', { class:'task-sub' }, sub.join(' · '))),
    chatButton(t),
    control);
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
  if (canAct && S.openPick === t.id) card.append(h('div', { class:'pickwho' }, h('span', { class:'lbl' }, timed ? 'מי מתחיל?' : 'מי עשה?'),
    S.members.filter(m => !running.some(tm => tm.memberId === m.id)).map(m => h('button', { type:'button', class:'chip', onclick:() => act(m.id) },
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
    items.sort((a,b) => (!!b.pinned - !!a.pinned) || (a.title||'').localeCompare(b.title||'','he')).forEach(t => L.append(taskCard(t, canAct))); };
  group('להיום', dueNow, true);
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
async function redeem(memberId, title, cost){
  const w = walletOf(memberId);
  if (!(cost >= 1)){ toast('כמות נקודות: לפחות 1'); return false; }
  if (cost > w.balance){ toast(`אין מספיק נקודות: יש ${w.balance}, צריך ${cost}`); return false; }
  try{
    await addDoc(collection(db,'logs'), { kind:'redeem', title, memberId, points:cost, day:today(), at:Date.now() });
    toast(`${mName(memberId)}: ירדו ${cost} נקודות`); return true;
  }catch(e){ fail(e); return false; }
}
function renderRewards(){
  const who = rewardsWho();
  const rw = $('rw-who'); rw.replaceChildren(); rw.hidden = !S.isAdmin;
  if (S.isAdmin){ rw.append(h('span', { class:'lbl' }, 'של מי:'));
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
      h('span', { class:'num neg' }, `-${l.points}` + (v != null ? ` (${fmtILS(v)})` : '')),
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

/* ---------- admin ---------- */
function syncSelects(){
  const fill = (sel, withAll) => { const v = sel.value; sel.replaceChildren();
    if (withAll) sel.append(h('option', { value:'all' }, 'מי שרוצה (כולם)'));
    S.members.forEach(m => sel.append(h('option', { value:m.id }, m.name)));
    if ([...sel.options].some(o => o.value === v)) sel.value = v; };
  const prevAssignee = $('tf-assignee').value;
  fill($('tf-assignee'), true); fill($('bf-member'), false);
  { const sel = $('tf-assignee'), v = sel.dataset.want || prevAssignee; if (![...sel.options].some(o => o.value === 'rotate')) sel.append(h('option', { value:'rotate' }, 'תורנות (מתחלף)')); if (v) sel.value = v; delete sel.dataset.want; }
  const rot = $('tf-rot'); const picked = new Set([...rot.querySelectorAll('input:checked')].map(i => i.value).concat(rot.dataset.want ? JSON.parse(rot.dataset.want) : []));
  delete rot.dataset.want; rot.replaceChildren(...S.members.map(m => h('label', null, h('input', { type:'checkbox', value:m.id, checked: picked.has(m.id) }), m.name)));
  $('tf-rotwrap').hidden = $('tf-assignee').value !== 'rotate';
  const sgPrev = $('sg-assignee').value;
  const sg = $('sg-assignee'), had = sg.options.length; fill(sg, true);
  if (![...sg.options].some(o => o.value === 'rotate')) sg.append(h('option', { value:'rotate' }, 'תורנות (מתחלף)'));
  if (sgPrev === 'rotate') sg.value = 'rotate';
  { const rot = $('sg-rot'); const picked = new Set([...rot.querySelectorAll('input:checked')].map(i => i.value));
    rot.replaceChildren(...S.members.map(m => h('label', null, h('input', { type:'checkbox', value:m.id, checked: picked.has(m.id) }), m.name)));
    $('sg-rotwrap').hidden = sg.value !== 'rotate'; }
  if (!had && S.me !== 'all' && member(S.me)) sg.value = S.me;
}
function renderAdminLists(){
  { // logs waiting for approval
    const R = $('reviewList'); R.replaceChildren();
    const wait = S.logs.filter(l => !counted(l)).sort((a,b) => a.at - b.at);
    $('reviewPanel').hidden = !wait.length; $('reviewCount').textContent = wait.length ? String(wait.length) : '';
    wait.forEach(l => { const [, mo, da] = (l.day || '--').split('-');
      R.append(h('div', { class:'arow' },
        h('div', { class:'t' }, h('strong', null, `${l.title} · ${mName(l.memberId)}`), h('small', null, `${+da}.${+mo}${l.minutes ? ` · ${l.minutes} דק׳` : ''}`)),
        h('span', { class:'num gold' }, `+${l.points}`),
        h('button', { type:'button', class:'btn small', onclick: async () => { try{ await updateDoc(doc(db,'logs',l.id), { approved:true }); toast(`אושר: ${mName(l.memberId)} קיבל/ה ${l.points} נקודות`); }catch(e){ fail(e); } } }, 'אישור'),
        armedBtn('rv' + l.id, 'לא בוצע', () => removeLog(l)))); });
  }
  const A = $('atList'); A.replaceChildren(); $('atCount').textContent = S.tasks.length ? String(S.tasks.length) : '';
  if (!S.tasks.length) A.append(h('p', { class:'sub' }, 'אין משימות עדיין. הוסיפו את הראשונה למעלה.'));
  const isNew = t => t.pending || t.reviewed === false;
  S.tasks.slice().sort((a,b) => (!!b.pinned - !!a.pinned) || (isNew(b) - isNew(a)) || (a.title||'').localeCompare(b.title||'','he')).forEach(t => {
    const doneOnce = t.type === 'once' && S.logs.some(l => l.taskId === t.id);
    const by = t.suggestedBy && member(t.suggestedBy) ? ` · נוספה ע״י ${mName(t.suggestedBy)}` : '';
    const row = h('div', { class:'arow wrap' },
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
      armedBtn('m'+m.id, 'הסרה', async () => { try{
        const b = writeBatch(db); b.delete(doc(db,'members',m.id)); b.delete(doc(db,'pins',m.id)); await b.commit(); toast(`${m.name} הוסר/ה`);
      }catch(e){ fail(e); } }))); });

  const H = $('histList'); H.replaceChildren();
  const hist = S.logs.slice().sort((a,b) => b.at - a.at).slice(0, 40);
  if (!hist.length) H.append(h('p', { class:'sub' }, 'כאן יופיע כל מה שבוצע וכל שינוי נקודות.'));
  hist.forEach(l => { const p = (l.kind === 'redeem' ? -1 : 1) * (Number(l.points) || 0); const [, mo, da] = (l.day || '--').split('-');
    H.append(h('div', { class:'arow' },
      h('div', { class:'t' }, h('strong', null, mName(l.memberId)), h('small', null, `${+da}.${+mo} · ${l.kind === 'bonus' ? 'עדכון: ' : l.kind === 'redeem' ? 'שימוש: ' : ''}${l.title}${l.minutes ? ` (${l.minutes} דק׳)` : ''}`)),
      h('span', { class:'num ' + (p < 0 ? 'neg' : 'gold') }, (p > 0 ? '+' : '') + p),
      armedBtn('l'+l.id, 'מחיקה', () => removeLog(l)))); });
}
function editTask(t){
  S.editTask = t.id; $('tfHead').textContent = t.pending ? `קביעת ניקוד: ${t.title}` : 'עריכת משימה'; $('tf-save').textContent = 'שמירת שינויים'; $('tf-cancel').hidden = false;
  $('tf-title').value = t.title; $('tf-assignee').dataset.want = t.assignee === 'rotate' ? 'rotate' : (member(t.assignee) ? t.assignee : 'all');
  $('tf-rot').dataset.want = JSON.stringify(t.rotation || []); $('tf-rot').querySelectorAll('input').forEach(i => i.checked = false); $('tf-check').checked = !!t.check; syncSelects();
  setMode(isTimed(t) ? 'timed' : 'fixed');
  $('tf-points').value = t.points ?? 10; $('tf-rate').value = t.ratePerMin ?? 1; $('tf-max').value = t.maxMinutes ?? 30; updateHint();
  $(t.type === 'once' ? 'tf-type-once' : 'tf-type-repeat').checked = true; $('tf-dayswrap').hidden = t.type === 'once';
  DAYS.forEach((_, i) => $('tf-day-'+i).checked = (t.days || []).includes(i) || t.type === 'once');
  $('tf-title').scrollIntoView({ behavior:'smooth', block:'center' }); $('tf-title').focus({ preventScroll:true });
}
function resetTaskForm(){
  S.editTask = null; $('tfHead').textContent = 'משימה חדשה'; $('tf-save').textContent = 'הוספת משימה'; $('tf-cancel').hidden = true;
  $('tf-title').value = ''; $('tf-assignee').dataset.want = 'all'; $('tf-check').checked = false; $('tf-rot').querySelectorAll('input').forEach(i => i.checked = false); $('tf-points').value = 10; $('tf-rate').value = 1; $('tf-max').value = 30; setMode('fixed'); updateHint();
  $('tf-type-repeat').checked = true; $('tf-dayswrap').hidden = false;
  DAYS.forEach((_, i) => $('tf-day-'+i).checked = true);
}
function setMode(m){ $(m === 'timed' ? 'tf-mode-timed' : 'tf-mode-fixed').checked = true; $('tf-fixed-row').hidden = m === 'timed'; $('tf-timed-row').hidden = m !== 'timed'; $('tf-timed-hint').hidden = m !== 'timed'; }
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
  if (!timed && (!Number.isFinite(points) || points < 0 || points > 1000)){ toast('נקודות: מספר בין 0 ל-1000'); return; }
  if (timed && (!(ratePerMin >= 1) || ratePerMin > 100)){ toast('נקודות לדקה: מספר בין 1 ל-100'); return; }
  if (timed && (!(maxMinutes >= 1) || maxMinutes > 240)){ toast('תקרה: בין 1 ל-240 דקות'); return; }
  if (type === 'repeat' && !days.length){ toast('בחרו לפחות יום אחד'); return; }
  const assignee = $('tf-assignee').value || 'all';
  const rotation = assignee === 'rotate' ? [...$('tf-rot').querySelectorAll('input:checked')].map(i => i.value) : [];
  if (assignee === 'rotate' && rotation.length < 2){ toast('בתורנות צריך לפחות שני בני משפחה'); return; }
  const data = { title, assignee, type, days, timed, check: $('tf-check').checked,
    ...(assignee === 'rotate' ? { rotation } : {}),
    ...(timed ? { ratePerMin, maxMinutes } : { points }) };
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
  S.editMember = m.id; $('mf-name').value = m.name; $('mf-pin').value = S.pins[m.id] || ''; $('mf-role').value = roleOf(m.id); $('mf-gender').value = m.gender === 'f' ? 'f' : 'm'; $('mf-save').textContent = 'שמירה'; $('mf-cancel').hidden = false;
  const i = COLORS.indexOf(m.color); if (i >= 0) $('mf-color-'+i).checked = true; $('mf-name').focus();
}
function resetMemberForm(){
  S.editMember = null; $('mf-name').value = ''; $('mf-pin').value = ''; $('mf-role').value = 'child'; $('mf-gender').value = 'm'; $('mf-save').textContent = 'הוספה'; $('mf-cancel').hidden = true;
  const used = new Set(S.members.map(m => m.color)); const i = Math.max(0, COLORS.findIndex(c => !used.has(c))); $('mf-color-'+i).checked = true;
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
    if (S.editMember) b.update(ref, { name, color, role, admin, gender }); else b.set(ref, { name, color, role, admin, gender, order: Date.now() });
    if (pin) b.set(doc(db,'pins',ref.id), { pin });
    await b.commit();
    toast(S.editMember ? 'נשמר' : `${name} נוסף/ה` + (pin ? '' : '. בלי קוד אי אפשר להיכנס בשמו/ה.'));
    resetMemberForm();
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
async function saveBonus(){
  const memberId = $('bf-member').value; const points = Math.round(Number($('bf-points').value));
  const reason = $('bf-reason').value.trim() || (points < 0 ? 'הורדת נקודות' : 'בונוס');
  if (!memberId){ toast('קודם הוסיפו בני משפחה'); return; }
  if (!Number.isFinite(points) || points === 0){ toast('כתבו מספר נקודות (לא 0)'); return; }
  const btn = $('bf-save'); btn.disabled = true;
  try{
    await addDoc(collection(db,'logs'), { kind:'bonus', title:reason, memberId, points, day:today(), at:Date.now() });
    toast(`${mName(memberId)}: ${points > 0 ? '+' : ''}${points}`); $('bf-reason').value = '';
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
  const dw = $('tf-days'); DAYS.forEach((d, i) => dw.append(h('label', { title:'יום '+d }, h('input', { type:'checkbox', id:'tf-day-'+i, value:i, checked:true }), d)));
  const sw = $('mf-colors'); COLORS.forEach((c, i) => sw.append(h('label', { style:`background:${c}`, title:'צבע' }, h('input', { type:'radio', name:'mf-color', id:'mf-color-'+i, value:c, checked: i === 0 }))));
  const jc = $('join-colors'); COLORS.forEach((c, i) => jc.append(h('label', { style:`background:${c}`, title:'צבע' }, h('input', { type:'radio', name:'join-color', id:'join-color-'+i, value:c, checked: i === 0 }))));
  document.querySelectorAll('input[name=tf-type]').forEach(r => r.addEventListener('change', () => { $('tf-dayswrap').hidden = $('tf-type-once').checked; }));
  $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.tab; S.openPick = null; render(); window.scrollTo(0, 0); });
  $('tf-save').addEventListener('click', saveTask); $('tf-cancel').addEventListener('click', resetTaskForm);
  $('mf-save').addEventListener('click', saveMember); $('mf-cancel').addEventListener('click', resetMemberForm);
  $('bf-save').addEventListener('click', saveBonus);
  $('mo-save').addEventListener('click', saveMoney);
  $('sg-assignee').addEventListener('change', () => { $('sg-rotwrap').hidden = $('sg-assignee').value !== 'rotate'; });
  $('gl-save').addEventListener('click', saveGoal);
  $('tf-assignee').addEventListener('change', () => { $('tf-rotwrap').hidden = $('tf-assignee').value !== 'rotate'; });
  $('ru-save').addEventListener('click', saveUse);
  $('chatBack').addEventListener('click', closeChat);
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
  document.querySelectorAll('input[name=sg-mode]').forEach(r => r.addEventListener('change', () => setSgMode($('sg-mode-timed').checked ? 'timed' : 'fixed')));
  document.querySelectorAll('input[name=tf-mode]').forEach(r => r.addEventListener('change', () => setMode($('tf-mode-timed').checked ? 'timed' : 'fixed')));
  ['tf-rate','tf-max'].forEach(id => $(id).addEventListener('input', updateHint));
  updateHint();
}

/* ---------- opening splash ---------- */
// The admin sees "bow to King Rotem". Children and parents see "good morning, <name>" and a different
// teasing nickname every time the app opens.
const ROASTS = {
  m: ['יא לוזר', 'ראש ביצה סרוחה', 'יא עצלן', 'מלך השינה עד הצהריים', 'יא חמוץ', 'אלוף העולם בלהתחמק ממשימות', 'יא שפן', 'נתין קטן של המלך',
      'יא גרב מסריחה', 'יא פיתה בלי חומוס', 'שר החדר המבולגן', 'יא תפוח אדמה עם רגליים', 'יא לוזר מקצועי', 'נסיך הכלים המלוכלכים', 'יא חלזון', 'יא קוטלט שרוף'],
  f: ['יא לוזרית', 'ראש ביצה סרוחה', 'יא עצלנית', 'מלכת השינה עד הצהריים', 'יא חמוצה', 'אלופת העולם בלהתחמק ממשימות', 'יא שפנפנה', 'נתינה קטנה של המלך',
      'יא גרב מסריחה', 'יא פיתה בלי חומוס', 'שרת החדר המבולגן', 'יא תפוח אדמה עם רגליים', 'יא לוזרית מקצועית', 'נסיכת הכלים המלוכלכים', 'יא חלזונית', 'יא קציצה שרופה'] };
const roastFor = {};
function roastOf(m){ return roastFor[m.id] || (roastFor[m.id] = pickRoast(m.gender)); }
function pickRoast(g){
  const list = ROASTS[g === 'f' ? 'f' : 'm'];
  let last = -1; try{ last = Number(localStorage.getItem('ft-roast')); }catch(e){}
  let i = Math.floor(Math.random() * list.length); if (i === last) i = (i + 1) % list.length;
  try{ localStorage.setItem('ft-roast', String(i)); }catch(e){}
  return list[i];
}
const splashState = { gone: false, close: null, personalized: false, timer: null };
function updateSplash(){
  if (splashState.gone || splashState.personalized) return;
  const id = S.boundId; if (!id || S.isAdmin) return;
  const m = member(id); if (!m || roleOf(id) === 'admin') return;
  splashState.personalized = true;
  $('splashKicker').textContent = 'הודעה מהמלך רותם 👑';
  $('splashTitle').textContent = `${greeting()}, ${m.name}`;
  const r = $('splashRoast'); r.textContent = `${greeting()} ${m.name}, ${roastOf(m)}`; r.hidden = false;
  clearTimeout(splashState.timer); splashState.timer = setTimeout(splashState.close, 3200); // give the new text time on screen
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
buildStatic(); render();
let lastDay = today();
setInterval(() => { if (today() !== lastDay){ lastDay = today(); render(); } }, 60000);
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

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
    if (taps.length >= 5){ taps = []; if (!S.isAdmin) openAdminGate(); }
  });
  $('ag-google').addEventListener('click', () => { if (!hasGIS()) closeAdminGate(); adminSignIn(); });
  $('login-go').addEventListener('click', loginGo);
  $('login-code').addEventListener('keydown', e => { if (e.key === 'Enter') loginGo(); });
  $('login-back').addEventListener('click', () => { S.loginPick = null; S.loginErr = ''; render(); });
  $('switchUser').addEventListener('click', switchUser);
  $('login-gfallback').addEventListener('click', adminSignIn);
  $('join-go').addEventListener('click', sendJoin);
  $('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') sendJoin(); });
  $('join-out').addEventListener('click', () => signOut(auth));
  $('wait-out').addEventListener('click', () => signOut(auth));
  $('wait-cancel').addEventListener('click', cancelJoin);
  // Leaving admin mode: drop the code session; a Google sign-in is signed out (the device returns to its family member).
  $('logoutBtn').addEventListener('click', async () => {
    S.tab = 'today';
    try{ if (S.user) await deleteDoc(doc(db,'adminSessions',S.user.uid)); }catch(e){}
    S.codeAdmin = false;
    if (S.user && !S.user.isAnonymous) await signOut(auth);
    toast('יצאת ממצב מנהל'); render();
  });

  onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    // Admin = allowed to read private/admin (Google account of the admin, or this device's admin code).
    S.user = user; S.isAdmin = false; S.adminChecked = false; S.joins = []; S.myJoin = null;
    if (!user){ signInAnonymously(auth).catch(e => { console.error(e); status('לא הצלחנו להתחבר. בדקו שכניסה אנונימית מופעלת ב-Firebase.'); }); render(); return; }
    status('');
    const sub = (name, fn) => unsubs.push(onSnapshot(collection(db, name),
      s => { fn(s.docs.map(x => ({ id:x.id, ...x.data({ serverTimestamps:'estimate' }) }))); render(); },
      e => { console.error(e); status(e.code === 'permission-denied' ? 'אין הרשאה לקרוא את הנתונים. בדקו את חוקי האבטחה ב-Firebase.' : 'בעיה בחיבור לנתונים.'); }));
    sub('members', a => { S.members = a.sort((x,y) => (x.order||0) - (y.order||0)); if (!S.memInit){ S.memInit = true; resetMemberForm(); } });
    sub('tasks', a => { S.tasks = a; });
    sub('logs', a => { S.logs = a; });
    sub('timers', a => { S.timers = a; });
    sub('messages', a => { S.messages = a; });
    sub('profiles', a => { S.profiles = Object.fromEntries(a.map(p => [p.id, p])); });
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
    const checkAdmin = async hasSession => {
      let ok = false;
      if (hasSession || !user.isAnonymous){ try{ await getDoc(doc(db,'private','admin')); ok = true; }catch(e){ ok = false; } }
      S.isAdmin = ok; S.adminChecked = true;
      if (ok){ startAdminSubs(); startJoinsSub(); } else { S.pins = {}; S.joins = []; }
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
