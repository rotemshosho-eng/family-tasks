import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const DAYS = ['א','ב','ג','ד','ה','ו','ש'];
const COLORS = ['#2A7F9E','#C0504D','#7B5EA7','#C97F14','#3B8C4A','#C2577F','#4F6D7A','#8A6D3B'];
const S = { members:[], tasks:[], logs:[], timers:[], money:{ points:100, shekels:0 }, me:'all', tab:'today', isAdmin:false, user:null,
  editTask:null, editMember:null, armed:null, busy:new Set(), openPick:null, memInit:false };
let db = null, unsubs = [];

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

let toastT;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function fail(e){ console.error(e); const c = e && e.code;
  toast(c === 'permission-denied' ? (S.isAdmin ? 'אין הרשאה. בדקו שהמייל בחוקי האבטחה נכון.' : 'אין הרשאה לפעולה הזו.')
      : c === 'unavailable' ? 'אין חיבור. זה יישמר כשהאינטרנט יחזור.' : 'השמירה לא הצליחה. נסו שוב.'); }
function status(msg){ const s = $('status'); s.textContent = msg || ''; s.hidden = !msg; }

const member = id => S.members.find(m => m.id === id);
const mName = id => id === 'all' ? 'כולם' : (member(id)?.name || 'לא משויך');
const mColor = id => member(id)?.color || '#8A9690';
const isTimed = t => t.timed === true;
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
    await addDoc(collection(db,'logs'), { kind:'task', taskId:t.id, title:t.title, memberId, points:Number(t.points)||0, day:today(), at:Date.now() });
    toast(`${mName(memberId)} קיבל/ה ${t.points} נקודות`);
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
      minutes:r.minutes, points:r.points, timerId:tm.id, day:today(), at:Date.now() });
    b.delete(doc(db,'timers',tm.id));
    await b.commit();
    toast(`${mName(tm.memberId)}: ${r.minutes} דקות, ${r.points} נקודות`);
  }catch(e){ fail(e); } finally{ S.busy.delete(tm.id); render(); }
}
async function cancelTimer(tm){ try{ await deleteDoc(doc(db,'timers',tm.id)); toast('הטיימר בוטל'); }catch(e){ fail(e); } }
async function removeLog(l){ try{ await deleteDoc(doc(db,'logs',l.id)); toast('בוטל'); }catch(e){ fail(e); } }

/* ---------- render ---------- */
function render(){
  const d = new Date();
  $('dateline').textContent = `יום ${DAYS[d.getDay()]}׳, ${d.getDate()}.${d.getMonth()+1}`;
  if (!S.isAdmin && S.tab === 'admin') S.tab = 'today';
  $('tabs').hidden = !S.isAdmin;
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab));
  $('view-today').hidden = S.tab !== 'today'; $('view-admin').hidden = S.tab !== 'admin';
  if (S.me !== 'all' && !member(S.me) && S.members.length) S.me = 'all';
  const nPend = S.tasks.filter(t => t.pending).length;
  $('tabs').querySelector('[data-tab="admin"]').textContent = nPend ? `ניהול (${nPend})` : 'ניהול';
  $('sgSec').hidden = !S.user || S.isAdmin || !S.members.length;
  renderWho(); renderBoard(); renderToday(); renderPending(); renderAuth(); syncSelects();
  if (S.isAdmin){ renderAdminLists(); }
}
// Nothing on screen says who manages the board: the admin entry is a hidden gesture (5 quick taps on the title).
function renderAuth(){}
function renderPending(){
  const mine = t => S.me === 'all' || t.assignee === S.me || t.assignee === 'all' || t.suggestedBy === S.me;
  const list = S.tasks.filter(t => t.pending && mine(t)).sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  $('pendSec').hidden = !list.length; $('pendCount').textContent = list.length ? String(list.length) : '';
  const P = $('pendList'); P.replaceChildren();
  list.forEach(t => P.append(h('div', { class:'task' },
    h('div', { class:'body' }, h('span', { class:'title' }, t.title),
      h('div', { class:'meta' },
        h('span', { class:'tag' }, h('span', { class:'dot', style:`background:${t.assignee === 'all' ? 'var(--muted)' : mColor(t.assignee)}` }),
          t.assignee === 'all' ? 'מי שרוצה' : mName(t.assignee)),
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
async function saveSuggestion(){
  const title = $('sg-title').value.trim();
  const type = $('sg-type-repeat').checked ? 'repeat' : 'once';
  const days = type === 'repeat' ? DAYS.map((_, i) => i).filter(i => $('sg-day-'+i).checked) : [];
  if (!title){ toast('כתבו מה צריך לעשות'); $('sg-title').focus(); return; }
  if (type === 'repeat' && !days.length){ toast('בחרו לפחות יום אחד'); return; }
  const btn = $('sg-save'); btn.disabled = true;
  try{
    await addDoc(collection(db,'tasks'), { title, assignee: $('sg-assignee').value || 'all', type, days, pending:true,
      suggestedBy: S.me !== 'all' && member(S.me) ? S.me : null, createdAt: Date.now() });
    toast('המשימה נוספה ומחכה לניקוד');
    $('sg-title').value = ''; toggleSuggest(false);
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
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
    for (const l of S.logs){ if (l.memberId !== m.id) continue; const p = Number(l.points) || 0; tot += p; if (l.day >= ws) wk += p; }
    return { m, wk, tot }; }).sort((a,b) => b.wk - a.wk);
  const top = rows[0].wk;
  rows.forEach(r => { const lead = top > 0 && r.wk === top;
    const wkILS = shekelsFor(r.wk), totILS = shekelsFor(r.tot);
    b.append(h('div', { class:'score' + (lead ? ' lead' : '') },
      h('div', { class:'ava', style:`background:${r.m.color}` }, (r.m.name || '?').trim().charAt(0)),
      h('div', { class:'info' },
        lead ? h('span', { class:'crown' }, 'מוביל/ה השבוע') : null,
        h('span', { class:'name' }, r.m.name),
        h('span', { class:'pts' }, r.wk),
        wkILS != null ? h('span', { class:'money' }, `${fmtILS(wkILS)} השבוע`) : null,
        h('span', { class:'tot' }, `סה״כ ${r.tot}` + (totILS != null ? ` · ${fmtILS(totILS)}` : ''))))); });
}
function renderToday(){
  const mine = t => S.me === 'all' || t.assignee === S.me || t.assignee === 'all';
  const due = S.tasks.filter(t => isDue(t) && mine(t)).sort((a,b) => (a.type === 'once') - (b.type === 'once') || (b.points - a.points));
  $('todoTitle').textContent = S.me === 'all' ? 'מה נשאר להיום' : `מה נשאר ל${mName(S.me)} היום`;
  $('todoCount').textContent = due.length ? `${due.length} משימות` : '';
  const L = $('todo'); L.replaceChildren();
  if (!S.tasks.length) L.append(h('div', { class:'empty' }, h('strong', null, 'אין עדיין משימות'),
    S.isAdmin ? 'הוסיפו משימה בלשונית ניהול: שם, כמה נקודות, של מי, ובאילו ימים.' : 'עוד לא נוספו משימות ללוח.'));
  else if (!due.length) L.append(h('div', { class:'empty' }, h('strong', null, 'הכל בוצע להיום'), 'משימות חוזרות יופיעו שוב ביום שלהן.'));
  due.forEach(t => {
    const who = t.assignee === 'all' ? (S.me !== 'all' ? S.me : null) : t.assignee;
    const timed = isTimed(t);
    const running = timed ? S.timers.filter(tm => tm.taskId === t.id && member(tm.memberId) && (S.me === 'all' || tm.memberId === S.me)) : [];
    const whoRunning = who && running.some(tm => tm.memberId === who);
    const busy = S.busy.has(t.id) || (who && S.busy.has(timerId(t.id, who)));
    const act = timed ? (m => startTimer(t, m)) : (m => complete(t, m));
    const meta = [
      h('span', { class:'tag' }, h('span', { class:'dot', style:`background:${t.assignee === 'all' ? 'var(--muted)' : mColor(t.assignee)}` }),
        t.assignee === 'all' ? 'מי שרוצה' : mName(t.assignee)),
      h('span', null, '·'), h('span', null, recLabel(t))];
    if (timed) meta.push(h('span', null, '·'), h('span', null, `עד ${t.maxMinutes} דק׳`));
    const card = h('div', { class:'task' },
      h('div', { class:'body' }, h('span', { class:'title' }, t.title), h('div', { class:'meta' }, meta)),
      h('span', { class:'pts-pill' }, pill(t)),
      whoRunning ? null : h('button', { type:'button', class:'btn', disabled: busy || !S.members.length, onclick:() => {
        if (who && member(who)) act(who); else { S.openPick = S.openPick === t.id ? null : t.id; render(); } } },
        busy ? 'שומר…' : (timed ? 'התחלתי' : 'סיימתי')));
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
    if (S.openPick === t.id) card.append(h('div', { class:'pickwho' }, h('span', { class:'lbl' }, timed ? 'מי מתחיל?' : 'מי עשה?'),
      S.members.filter(m => !running.some(tm => tm.memberId === m.id)).map(m => h('button', { type:'button', class:'chip', onclick:() => act(m.id) },
        h('span', { class:'dot', style:`background:${m.color}` }), m.name))));
    L.append(card);
  });
  const td = today();
  const done = S.logs.filter(l => (l.kind === 'task' || l.kind === 'timed') && l.day === td && (S.me === 'all' || l.memberId === S.me)).sort((a,b) => b.at - a.at);
  $('doneSec').hidden = !done.length;
  $('doneCount').textContent = done.length ? `${done.reduce((s,l) => s + (Number(l.points)||0), 0)} נקודות` : '';
  const D = $('doneList'); D.replaceChildren();
  done.forEach(l => D.append(h('div', { class:'done' },
    h('span', { class:'dot', style:`background:${mColor(l.memberId)}` }),
    h('span', { class:'t' }, `${l.title} · ${mName(l.memberId)}` + (l.minutes ? ` · ${l.minutes} דק׳` : '')),
    h('span', { class:'num gold' }, `+${l.points}`),
    h('button', { type:'button', class:'btn ghost small', onclick:() => removeLog(l) }, 'ביטול'))));
}

/* ---------- admin ---------- */
function syncSelects(){
  const fill = (sel, withAll) => { const v = sel.value; sel.replaceChildren();
    if (withAll) sel.append(h('option', { value:'all' }, 'מי שרוצה (כולם)'));
    S.members.forEach(m => sel.append(h('option', { value:m.id }, m.name)));
    if ([...sel.options].some(o => o.value === v)) sel.value = v; };
  fill($('tf-assignee'), true); fill($('bf-member'), false);
  const sg = $('sg-assignee'), had = sg.options.length; fill(sg, true);
  if (!had && S.me !== 'all' && member(S.me)) sg.value = S.me;
}
function renderAdminLists(){
  const A = $('atList'); A.replaceChildren(); $('atCount').textContent = S.tasks.length ? String(S.tasks.length) : '';
  if (!S.tasks.length) A.append(h('p', { class:'sub' }, 'אין משימות עדיין. הוסיפו את הראשונה למעלה.'));
  S.tasks.slice().sort((a,b) => (!!b.pending - !!a.pending) || (a.title||'').localeCompare(b.title||'','he')).forEach(t => {
    const doneOnce = t.type === 'once' && S.logs.some(l => l.taskId === t.id);
    A.append(h('div', { class:'arow' },
      h('div', { class:'t' }, h('strong', null, t.title), h('small', null, `${t.pending ? 'מחכה לניקוד · ' : ''}${mName(t.assignee)} · ${recLabel(t)}${isTimed(t) ? ` · לפי זמן, עד ${t.maxMinutes} דק׳` : ''}${doneOnce ? ' · בוצעה' : ''}`)),
      t.pending ? null : h('span', { class:'pts-pill' }, pill(t)),
      h('button', { type:'button', class:'btn ' + (t.pending ? '' : 'ghost ') + 'small', onclick:() => editTask(t) }, t.pending ? 'קביעת ניקוד' : 'עריכה'),
      armedBtn('t'+t.id, 'מחיקה', async () => { try{ await deleteDoc(doc(db,'tasks',t.id)); toast('המשימה נמחקה'); if (S.editTask === t.id) resetTaskForm(); }catch(e){ fail(e); } })));
  });

  const M = $('amList'); M.replaceChildren();
  if (!S.members.length) M.append(h('p', { class:'sub' }, 'הוסיפו את בני המשפחה, אחד אחד.'));
  S.members.forEach(m => M.append(h('div', { class:'arow' },
    h('div', { class:'ava sm', style:`background:${m.color}` }, m.name.charAt(0)),
    h('div', { class:'t' }, h('strong', null, m.name)),
    h('button', { type:'button', class:'btn ghost small', onclick:() => editMember(m) }, 'עריכה'),
    armedBtn('m'+m.id, 'הסרה', async () => { try{ await deleteDoc(doc(db,'members',m.id)); toast(`${m.name} הוסר/ה`); }catch(e){ fail(e); } }))));

  const H = $('histList'); H.replaceChildren();
  const hist = S.logs.slice().sort((a,b) => b.at - a.at).slice(0, 40);
  if (!hist.length) H.append(h('p', { class:'sub' }, 'כאן יופיע כל מה שבוצע וכל שינוי נקודות.'));
  hist.forEach(l => { const p = Number(l.points) || 0; const [, mo, da] = (l.day || '--').split('-');
    H.append(h('div', { class:'arow' },
      h('div', { class:'t' }, h('strong', null, mName(l.memberId)), h('small', null, `${+da}.${+mo} · ${l.kind === 'bonus' ? 'עדכון: ' : ''}${l.title}${l.minutes ? ` (${l.minutes} דק׳)` : ''}`)),
      h('span', { class:'num ' + (p < 0 ? 'neg' : 'gold') }, (p > 0 ? '+' : '') + p),
      armedBtn('l'+l.id, 'מחיקה', () => removeLog(l)))); });
}
function editTask(t){
  S.editTask = t.id; $('tfHead').textContent = t.pending ? `קביעת ניקוד: ${t.title}` : 'עריכת משימה'; $('tf-save').textContent = 'שמירת שינויים'; $('tf-cancel').hidden = false;
  $('tf-title').value = t.title; $('tf-assignee').value = member(t.assignee) ? t.assignee : 'all';
  setMode(isTimed(t) ? 'timed' : 'fixed');
  $('tf-points').value = t.points ?? 10; $('tf-rate').value = t.ratePerMin ?? 1; $('tf-max').value = t.maxMinutes ?? 30; updateHint();
  $(t.type === 'once' ? 'tf-type-once' : 'tf-type-repeat').checked = true; $('tf-dayswrap').hidden = t.type === 'once';
  DAYS.forEach((_, i) => $('tf-day-'+i).checked = (t.days || []).includes(i) || t.type === 'once');
  $('tf-title').scrollIntoView({ behavior:'smooth', block:'center' }); $('tf-title').focus({ preventScroll:true });
}
function resetTaskForm(){
  S.editTask = null; $('tfHead').textContent = 'משימה חדשה'; $('tf-save').textContent = 'הוספת משימה'; $('tf-cancel').hidden = true;
  $('tf-title').value = ''; $('tf-points').value = 10; $('tf-rate').value = 1; $('tf-max').value = 30; setMode('fixed'); updateHint();
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
  const data = { title, assignee: $('tf-assignee').value || 'all', type, days, timed,
    ...(timed ? { ratePerMin, maxMinutes } : { points }) };
  const btn = $('tf-save'); btn.disabled = true;
  try{
    if (S.editTask){
      const old = S.tasks.find(x => x.id === S.editTask);
      await setDoc(doc(db,'tasks',S.editTask), { ...data, createdAt: old?.createdAt || Date.now() });
      toast('המשימה עודכנה');
    }
    else { await addDoc(collection(db,'tasks'), { ...data, createdAt: Date.now() }); toast('המשימה נוספה'); }
    resetTaskForm();
  }catch(e){ fail(e); } finally{ btn.disabled = false; }
}
function editMember(m){
  S.editMember = m.id; $('mf-name').value = m.name; $('mf-save').textContent = 'שמירה'; $('mf-cancel').hidden = false;
  const i = COLORS.indexOf(m.color); if (i >= 0) $('mf-color-'+i).checked = true; $('mf-name').focus();
}
function resetMemberForm(){
  S.editMember = null; $('mf-name').value = ''; $('mf-save').textContent = 'הוספה'; $('mf-cancel').hidden = true;
  const used = new Set(S.members.map(m => m.color)); const i = Math.max(0, COLORS.findIndex(c => !used.has(c))); $('mf-color-'+i).checked = true;
}
async function saveMember(){
  const name = $('mf-name').value.trim(); const color = (document.querySelector('input[name=mf-color]:checked') || {}).value || COLORS[0];
  if (!name){ toast('כתבו שם'); $('mf-name').focus(); return; }
  const btn = $('mf-save'); btn.disabled = true;
  try{
    if (S.editMember){ await updateDoc(doc(db,'members',S.editMember), { name, color }); toast('נשמר'); }
    else { await addDoc(collection(db,'members'), { name, color, order: Date.now() }); toast(`${name} נוסף/ה`); }
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
  document.querySelectorAll('input[name=tf-type]').forEach(r => r.addEventListener('change', () => { $('tf-dayswrap').hidden = $('tf-type-once').checked; }));
  $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.tab; render(); });
  $('tf-save').addEventListener('click', saveTask); $('tf-cancel').addEventListener('click', resetTaskForm);
  $('mf-save').addEventListener('click', saveMember); $('mf-cancel').addEventListener('click', resetMemberForm);
  $('bf-save').addEventListener('click', saveBonus);
  $('mo-save').addEventListener('click', saveMoney);
  const sd = $('sg-days'); DAYS.forEach((d, i) => sd.append(h('label', { title:'יום '+d }, h('input', { type:'checkbox', id:'sg-day-'+i, value:i, checked:true }), d)));
  document.querySelectorAll('input[name=sg-type]').forEach(r => r.addEventListener('change', () => { $('sg-dayswrap').hidden = !$('sg-type-repeat').checked; }));
  $('sg-toggle').addEventListener('click', () => toggleSuggest(true));
  $('sg-cancel').addEventListener('click', () => toggleSuggest(false));
  $('sg-save').addEventListener('click', saveSuggestion);
  document.querySelectorAll('input[name=tf-mode]').forEach(r => r.addEventListener('change', () => setMode($('tf-mode-timed').checked ? 'timed' : 'fixed')));
  ['tf-rate','tf-max'].forEach(id => $(id).addEventListener('input', updateHint));
  updateHint();
}

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
  const app = initializeApp(firebaseConfig);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const auth = getAuth(app);
  getRedirectResult(auth).catch(e => console.error(e));

  async function adminSignIn(){
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
    if (taps.length >= 5){ taps = []; const u = auth.currentUser; if (!u || u.isAnonymous) adminSignIn(); }
  });
  $('logoutBtn').addEventListener('click', async () => { S.tab = 'today'; await signOut(auth); toast('יצאת'); });

  onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    S.user = user; S.isAdmin = !!user && !user.isAnonymous;
    if (!user){ signInAnonymously(auth).catch(e => { console.error(e); status('לא הצלחנו להתחבר. בדקו שכניסה אנונימית מופעלת ב-Firebase.'); }); render(); return; }
    status('');
    const sub = (name, fn) => unsubs.push(onSnapshot(collection(db, name),
      s => { fn(s.docs.map(x => ({ id:x.id, ...x.data({ serverTimestamps:'estimate' }) }))); render(); },
      e => { console.error(e); status(e.code === 'permission-denied' ? 'אין הרשאה לקרוא את הנתונים. בדקו את חוקי האבטחה ב-Firebase.' : 'בעיה בחיבור לנתונים.'); }));
    sub('members', a => { S.members = a.sort((x,y) => (x.order||0) - (y.order||0)); if (!S.memInit){ S.memInit = true; resetMemberForm(); } });
    sub('tasks', a => { S.tasks = a; });
    sub('logs', a => { S.logs = a; });
    sub('timers', a => { S.timers = a; });
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
