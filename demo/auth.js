// Stand-in for firebase-auth.js in ?demo=1: always signed in as the demo family's admin.
import { UID } from './data.js';
const user = { uid: UID, isAnonymous: true };
const no = async () => { throw Object.assign(new Error('demo'), { code: 'auth/demo' }); };
export const getAuth = () => ({ currentUser: user });
export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const signInAnonymously = async () => ({ user });
export const getRedirectResult = async () => null;
export const signOut = async () => {};
export class GoogleAuthProvider { static credential(){ return {}; } setCustomParameters(){} addScope(){} }
export const signInWithPopup = no, signInWithRedirect = no, signInWithCredential = no;
