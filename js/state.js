import { T, PROJECTS } from './content.js';

export const state = { lang: 'en' };

(function initLang() {
  let l = null;
  try { l = new URLSearchParams(location.search).get('lang'); } catch (e) { /* ignore */ }
  if (l !== 'en' && l !== 'ru') { try { l = localStorage.getItem('lang'); } catch (e) { /* ignore */ } }
  if (l !== 'en' && l !== 'ru') l = /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en';
  state.lang = l;
  document.documentElement.lang = l;
})();

export function setLang(l) {
  state.lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem('lang', l); } catch (e) { /* ignore */ }
}

// Routes: #/ · #/work · #/skills · #/skills/more · #/contact · #/p/<id> · #/p/<id>/case
export function parseRoute(hash = location.hash) {
  const h = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (h[0] === 'work') return { page: 'work', reader: false };
  if (h[0] === 'skills') return { page: 'skills', reader: h[1] === 'more' };
  if (h[0] === 'contact') return { page: 'contact', reader: false };
  if (h[0] === 'p' && PROJECTS.some(p => p.id === h[1])) return { page: 'p:' + h[1], reader: h[2] === 'case' };
  return { page: 'home', reader: false };
}

export function baseHash(r) {
  if (r.page === 'home') return '#/';
  if (r.page.startsWith('p:')) return '#/p/' + r.page.slice(2);
  return '#/' + r.page;
}

export function pageTitle(r, lang) {
  const t = T[lang];
  let p = t.home.title;
  if (r.page === 'work') p = t.nav.work;
  else if (r.page === 'skills') p = t.nav.skills;
  else if (r.page === 'contact') p = t.nav.contact;
  else if (r.page.startsWith('p:')) p = PROJECTS.find(x => x.id === r.page.slice(2))[lang].title;
  return `${p} — ${t.fullName}`;
}
