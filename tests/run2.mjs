// Full render test: fake signed-in user and fake family data, then render every tab. ADMIN=1 for admin, PLAIN=1 for plain mode.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ADMIN = process.argv[2] === 'admin', PLAIN = process.argv[3] === 'plain', PARENT = process.argv[2] === 'parent';
let src = fs.readFileSync(process.argv[4] || fileURLToPath(new URL('../app.js', import.meta.url)),'utf8');
src = src.replace(/^import \* as cfg from .*$/m, "const cfg = { firebaseConfig:{}, vapidKey:'', googleClientId:'' };")
         .replace(/^import \{[\s\S]*?\} from 'https:[^']+';$/gm, '');
const stub = `
const P = new Proxy(function(){}, { get:(t,k)=> k==='then'?undefined:P, apply:()=>P, construct:()=>P });
const __now=new Date(); const d=new Date(__now.getTime()-__now.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const lw=new Date(__now.getTime()-7*864e5-__now.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const DATA = {
  members:[{id:'m1',name:'רותם',color:'#2A7F9E',role:'admin',admin:true,gender:'m',order:0},{id:'m2',name:'נועה',color:'#C0504D',role:'child',gender:'f',order:1},{id:'m3',name:'אמא',color:'#7B5EA7',role:'parent',gender:'f',order:2,watch:true,canMarkFor:['m2','m4']},{id:'m4',name:'אבא',color:'#3B8C4A',role:'parent',gender:'m',order:3}],
  tasks:[{id:'t1',title:'לסדר את החדר',assignee:'all',type:'repeat',days:[0,1,2,3,4,5,6],timed:false,points:10,createdAt:1},
         {id:'t2',title:'לקום',assignee:'each',type:'repeat',days:[0,1,2,3,4,5,6],timed:false,points:5,untilTime:'07:30',createdAt:2},
         {id:'t3',title:'גרביים',assignee:'m2',type:'repeat',days:[0,1,2,3,4,5,6],timed:false,points:3,qtyPer:5,qtyUnit:'גרביים',createdAt:3},
         {id:'t4',title:'קריאה',assignee:'rotate',rotation:['m1','m2'],type:'repeat',days:[0,1,2,3,4,5,6],timed:true,ratePerMin:1,maxMinutes:30,createdAt:4},
         {id:'t5',title:'מחסן',assignee:'all',type:'once',days:[],timed:false,points:50,boss:true,createdAt:5}],
  logs:[{id:'l1',kind:'task',taskId:'t1',title:'לסדר את החדר',memberId:'m2',points:10,day:d,at:Date.now()-3600e3},
        {id:'l2',kind:'task',taskId:'t3',title:'גרביים',memberId:'m2',points:3,count:5,approved:false,day:d,at:Date.now()-60e3},
        {id:'l4',kind:'bonus',title:'עזרה',memberId:'m3',by:'m3',points:20,flag:true,day:d,at:Date.now()},{id:'l3',kind:'redeem',title:'טלוויזיה',memberId:'m2',points:10,approved:false,loan:true,day:d,at:Date.now()},
        {id:'l5',kind:'bonus',title:'דמי כיס',memberId:'m4',points:500,wallet:true,day:d,at:Date.now()},{id:'l6',kind:'task',taskId:'t1',title:'לסדר את החדר',memberId:'m2',points:10,day:lw,at:Date.now()-7*864e5}],
  timers:[], messages:[], profiles:[], rewards:[{id:'r1',title:'15 דקות טלוויזיה',cost:10,emoji:'📺',createdAt:1}],
  complaints:[{id:'c1',text:'בדיקה',cat:'fun',by:'m2',about:'',status:'open',agree:[],at:Date.now()}], cpComments:[], challengeJoins:[], photos:[], devNotes:[{id:'n1',text:'x',kind:'bug',by:'m2',status:'doing',at:1}], joinRequests:[{id:'g1',name:'אבא',color:'#3B8C4A',email:'dad@example.com',linkTo:'m4',at:1}], pins:[]
};
const DOCS = { 'settings/goal':{target:100,prize:'פיצה'}, 'settings/challenge':{title:'חג',target:10,start:d,until:d,prize:'',bonus:5}, 'settings/money':{points:100,shadows:0}, 'settings/perms':{parentPoints:true},
  'bindings/u1': ${ADMIN ? 'null' : PARENT ? "{memberId:'m3',pin:'1'}" : "{memberId:'m2',pin:'1234'}"}, 'adminSessions/u1': ${ADMIN ? "{code:'x'}" : 'null'} };
const collection=(db,name)=>({kind:'col',name}); const doc=(a,...p)=>{ if (a && a.kind==='col' && p.length===0) return {kind:'doc',path:a.name+'/new'}; if (a && a.kind==='col') return {kind:'doc',path:a.name+'/'+p[0]}; return {kind:'doc',path:p.join('/')}; };
const snapCol=name=>({ docs:(DATA[name]||[]).map(x=>({id:x.id,data:()=>{const {id,...r}=x; return r;}})) });
const onSnapshot=(ref,ok)=>{ setTimeout(()=>{ try{ if(ref.kind==='col') ok(snapCol(ref.name)); else { const v=DOCS[ref.path]; ok({exists:()=>!!v,data:()=>v}); } }catch(e){ window.__errs.push('snapshot '+(ref.name||ref.path)+': '+e.stack); } },0); return ()=>{}; };
const getDoc=async ref=>{ if(${ADMIN} && ref.path==='private/admin') return {exists:()=>true,data:()=>({code:'x'})}; throw Object.assign(new Error('denied'),{code:'permission-denied'}); };
const onAuthStateChanged=(auth,cb)=>{ setTimeout(()=>cb({uid:'u1',isAnonymous:true}),0); return ()=>{}; };
const initializeApp=P,deleteField=P,initializeFirestore=P,persistentLocalCache=P,persistentMultipleTabManager=P,_addDoc=async()=>({id:'x'}),_updateDoc=async()=>{},_deleteDoc=async()=>{},_setDoc=async()=>{},_writeBatch=()=>({set(){},delete(){},update(){},commit:async()=>{}}),serverTimestamp=P,arrayUnion=P,arrayRemove=P,
getAuth=()=>({}),signInAnonymously=P,GoogleAuthProvider=P,signInWithPopup=P,signInWithRedirect=P,getRedirectResult=async()=>null,signOut=P,signInWithCredential=P,getMessaging=P,getToken=P,onMessage=P,isSupported=async()=>false;
try{ localStorage.setItem('ft-plain','${PLAIN ? '1' : '0'}'); }catch(e){}
`;
fs.writeFileSync(new URL('./app.test.mjs', import.meta.url), stub + src);
