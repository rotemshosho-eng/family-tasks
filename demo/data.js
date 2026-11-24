// Demo family for ?demo=1. Lives only in memory: nothing here touches Firebase.
const D = 864e5, now = Date.now();
const iso = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const day = n => iso(now - n * D);
const ts = ms => ({ toMillis: () => ms });
const ALL = [0, 1, 2, 3, 4, 5, 6];

export const UID = 'demo-user';

export const COLLECTIONS = {
  members: [
    { id: 'm1', name: 'רותם', color: '#2A7F9E', role: 'admin', admin: true, gender: 'm', order: 0 },
    { id: 'm2', name: 'נועה', color: '#C0504D', role: 'child', gender: 'f', order: 1, canNudge: true },
    { id: 'm3', name: 'יואב', color: '#E0A030', role: 'child', gender: 'm', order: 2 },
    { id: 'm4', name: 'אמא', color: '#7B5EA7', role: 'parent', gender: 'f', order: 3 },
    { id: 'm5', name: 'אבא', color: '#3B8C4A', role: 'parent', gender: 'm', order: 4 },
  ],
  tasks: [
    { id: 't1', title: 'לסדר את החדר', assignee: 'each', type: 'repeat', days: ALL, timed: false, points: 10, createdAt: 1 },
    { id: 't2', title: 'להוציא את הזבל', assignee: 'rotate', rotation: ['m2', 'm3', 'm1'], type: 'repeat', days: [0, 2, 4], timed: false, points: 10, createdAt: 2 },
    { id: 't3', title: 'לפרוק את המדיח', assignee: 'all', type: 'repeat', days: ALL, timed: false, points: 15, createdAt: 3 },
    { id: 't4', title: 'קריאה', assignee: 'each', type: 'repeat', days: ALL, timed: true, ratePerMin: 1, maxMinutes: 30, createdAt: 4 },
    { id: 't5', title: 'לקפל כביסה', assignee: 'all', type: 'repeat', days: ALL, timed: false, points: 2, qtyPer: 5, qtyUnit: 'בגדים', createdAt: 5 },
    { id: 't6', title: 'לקום בזמן', assignee: 'each', type: 'repeat', days: [0, 1, 2, 3, 4], timed: false, points: 5, untilTime: '07:30', createdAt: 6 },
    { id: 't7', title: 'לסדר את המחסן', assignee: 'all', type: 'once', days: [], timed: false, points: 50, boss: true, createdAt: 7 },
  ],
  logs: [
    { id: 'l1', kind: 'task', taskId: 't1', title: 'לסדר את החדר', memberId: 'm2', points: 10, day: day(0), at: now - 2 * 36e5 },
    { id: 'l2', kind: 'task', taskId: 't3', title: 'לפרוק את המדיח', memberId: 'm3', points: 15, day: day(0), at: now - 36e5 },
    { id: 'l3', kind: 'timed', taskId: 't4', title: 'קריאה', memberId: 'm2', points: 20, minutes: 20, day: day(0), at: now - 30 * 6e4 },
    { id: 'l4', kind: 'task', taskId: 't5', title: 'לקפל כביסה', memberId: 'm3', points: 4, count: 10, approved: false, day: day(0), at: now - 5 * 6e4 },
    { id: 'l5', kind: 'redeem', title: '15 דקות טלוויזיה', memberId: 'm2', points: 10, approved: false, day: day(0), at: now - 2 * 6e4 },
    { id: 'l6', kind: 'task', taskId: 't1', title: 'לסדר את החדר', memberId: 'm1', points: 10, day: day(1), at: now - D },
    { id: 'l7', kind: 'task', taskId: 't2', title: 'להוציא את הזבל', memberId: 'm3', points: 10, day: day(1), at: now - D },
    { id: 'l8', kind: 'task', taskId: 't3', title: 'לפרוק את המדיח', memberId: 'm2', points: 15, day: day(2), at: now - 2 * D },
    { id: 'l9', kind: 'bonus', title: 'עזרה בקניות', memberId: 'm3', by: 'm4', points: 20, day: day(2), at: now - 2 * D },
    { id: 'l10', kind: 'task', taskId: 't1', title: 'לסדר את החדר', memberId: 'm3', points: 10, day: day(3), at: now - 3 * D },
    { id: 'l11', kind: 'timed', taskId: 't4', title: 'קריאה', memberId: 'm1', points: 30, minutes: 30, day: day(3), at: now - 3 * D },
    { id: 'l12', kind: 'task', taskId: 't6', title: 'לקום בזמן', memberId: 'm2', points: 5, day: day(4), at: now - 4 * D },
  ],
  rewards: [
    { id: 'r1', title: '15 דקות טלוויזיה', cost: 10, emoji: '📺', createdAt: 1 },
    { id: 'r2', title: 'לבחור מה אוכלים בערב', cost: 40, emoji: '🍕', createdAt: 2 },
    { id: 'r3', title: 'ללכת לישון חצי שעה מאוחר', cost: 30, emoji: '🌙', createdAt: 3 },
  ],
  messages: [
    { id: 'g1', taskId: 'general', memberId: 'm4', text: 'מי שמסדר את המחסן היום מקבל פיצה 🍕', at: ts(now - 3 * 36e5) },
    { id: 'g2', taskId: 'general', memberId: 'm3', text: 'אני בפנים!', at: ts(now - 2.5 * 36e5) },
  ],
  dishes: [
    { id: 'd1', from: 'm4', to: 'm1', e: '🧆', n: 'קציצות', a: 'heat', call: true, at: now - 3 * 6e4, w: 1 },
  ],
  challengeItems: [
    { id: 'ci1', key: 'demo', itemId: 'ci1', memberId: 'm2', at: now - D },
  ],
  complaints: [], cpComments: [], challengeJoins: [], photos: [], timers: [], profiles: [],
  pins: [], joinRequests: [], devNotes: [], pushTokens: [],
};

export const DOCS = {
  'settings/goal': { target: 300, prize: 'יום כיף בים 🏖️' },
  'settings/challenge': { cid: 'demo', title: 'אתגר סוף השבוע', target: 3, bonus: 10, prize: '',
    items: [{ id: 'ci1', title: 'לסדר את המחסן' }, { id: 'ci2', title: 'לשטוף את האוטו' }, { id: 'ci3', title: 'לנקות את המרפסת' }],
    start: day(1), until: day(-2) },
  'settings/money': { points: 100, shekels: 5 },
  'settings/perms': { parentPoints: true, nudgeEveryMin: 30 },
  [`bindings/${UID}`]: { memberId: 'm1' },
  [`adminSessions/${UID}`]: { code: 'demo' },
  'private/admin': { code: 'demo' },
};
