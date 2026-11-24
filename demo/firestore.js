// In-memory stand-in for firebase-firestore.js, used only by ?demo=1 (see the import map in index.html).
// Same function names app.js imports; every write stays in this tab and is gone on reload.
import { COLLECTIONS, DOCS } from './data.js';

const store = new Map();            // 'col/id' -> data
for (const [name, list] of Object.entries(COLLECTIONS)) for (const { id, ...r } of list) store.set(name + '/' + id, r);
for (const [path, v] of Object.entries(DOCS)) store.set(path, v);

const listeners = new Set();
let n = 0; const newId = () => 'demo' + Date.now().toString(36) + (n++);

const SENT = Symbol('sentinel');
export const serverTimestamp = () => ({ [SENT]: 'ts' });
export const deleteField = () => ({ [SENT]: 'del' });
export const arrayUnion = (...v) => ({ [SENT]: 'union', v });
export const arrayRemove = (...v) => ({ [SENT]: 'remove', v });

export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

export const collection = (db, name) => ({ kind: 'col', name });
export const where = (field, op, value) => ({ field, op, value });
export const query = (ref, ...filters) => ({ ...ref, filters });
export function doc(a, ...p){
  if (a && a.kind === 'col') return { kind: 'doc', path: a.name + '/' + (p[0] || newId()), id: p[0] };
  const path = p.join('/'); return { kind: 'doc', path, id: path.split('/').pop() };
}

const docSnap = path => { const v = store.get(path); return { id: path.split('/').pop(), exists: () => v !== undefined, data: () => v === undefined ? undefined : { ...v } }; };
function colSnap(ref){
  const pre = ref.name + '/', docs = [];
  for (const [k, v] of store) if (k.startsWith(pre) && !k.slice(pre.length).includes('/')){
    if ((ref.filters || []).every(f => f.op !== '==' || v[f.field] === f.value)) docs.push({ id: k.slice(pre.length), data: () => ({ ...v }) });
  }
  return { docs, size: docs.length, empty: !docs.length };
}
const emit = l => { try{ l.ok(l.ref.kind === 'col' ? colSnap(l.ref) : docSnap(l.ref.path)); }catch(e){ console.error(e); } };
const touched = path => { const col = path.split('/')[0]; queueMicrotask(() => { for (const l of listeners) if (l.ref.kind === 'col' ? l.ref.name === col : l.ref.path === path) emit(l); }); };

export function onSnapshot(ref, ok){ const l = { ref, ok }; listeners.add(l); setTimeout(() => listeners.has(l) && emit(l), 0); return () => listeners.delete(l); }
export async function getDoc(ref){ return docSnap(ref.path); }

function apply(old, data){
  const out = { ...(old || {}) };
  for (const [k, v] of Object.entries(data)){
    const s = v && v[SENT];
    if (s === 'del') delete out[k];
    else if (s === 'ts'){ const t = Date.now(); out[k] = { toMillis: () => t }; }
    else if (s === 'union') out[k] = [...new Set([...(out[k] || []), ...v.v])];
    else if (s === 'remove') out[k] = (out[k] || []).filter(x => !v.v.includes(x));
    else out[k] = v;
  }
  return out;
}
const write = (ref, data, merge) => { store.set(ref.path, apply(merge ? store.get(ref.path) : null, data)); touched(ref.path); };
const update = (ref, data) => { if (!store.has(ref.path)) throw Object.assign(new Error('not found'), { code: 'not-found' }); write(ref, data, true); };
const remove = ref => { store.delete(ref.path); touched(ref.path); };

export async function setDoc(ref, data, opts){ write(ref, data, opts && opts.merge); }
export async function updateDoc(ref, data){ update(ref, data); }
export async function deleteDoc(ref){ remove(ref); }
export async function addDoc(colRef, data){ const ref = doc(colRef); write(ref, data); return ref; }
export function writeBatch(){
  const ops = [];
  return { set(r, d, o){ ops.push(() => write(r, d, o && o.merge)); return this; }, update(r, d){ ops.push(() => update(r, d)); return this; },
    delete(r){ ops.push(() => remove(r)); return this; }, async commit(){ ops.forEach(f => f()); } };
}
