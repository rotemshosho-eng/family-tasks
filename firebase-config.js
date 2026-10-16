// ההגדרות של פרויקט Firebase "family-tasks".
// (הערכים האלה לא סודיים. מה שמגן על הנתונים הוא חוקי האבטחה ב-firestore.rules)
export const firebaseConfig = {
  apiKey: "AIzaSyDahgemU2SeGodaY0c8H-ujbb9sJ1dCFFo",
  authDomain: "family-tasks-b0fa7.firebaseapp.com",
  projectId: "family-tasks-b0fa7",
  storageBucket: "family-tasks-b0fa7.firebasestorage.app",
  messagingSenderId: "491523225113",
  appId: "1:491523225113:web:48bbbb3b44ab76edba5c88"
};

// מפתח להתראות (Web Push). Firebase → Project settings → Cloud Messaging → Web Push certificates → Key pair.
export const vapidKey = "BEuaxtn0g49tPcFagAX1xrHUFVyNjGw10IhC7xvpWvRlLTecEEsqPJoPWmwisoVS0ncL95jO_NBrdy6QmWe46jY";

// מזהה הכניסה עם גוגל (Web client ID). Firebase → Authentication → Sign-in method → Google → Web SDK configuration.
export const googleClientId = "PASTE_HERE";
