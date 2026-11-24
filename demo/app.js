// Stand-in for firebase-app.js in ?demo=1. Also shows the "demo" ribbon.
export function initializeApp(){
  const add = () => {
    if (document.getElementById('demoBar')) return;
    const b = document.createElement('div'); b.id = 'demoBar';
    b.textContent = 'מצב הדגמה · משפחה לדוגמה · שום דבר לא נשמר';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#172B4D;color:#fff;font:500 12px Rubik,system-ui,sans-serif;text-align:center;padding:4px 8px;pointer-events:none;opacity:.92';
    document.body.appendChild(b);
  };
  document.body ? add() : addEventListener('DOMContentLoaded', add);
  return { demo: true };
}
