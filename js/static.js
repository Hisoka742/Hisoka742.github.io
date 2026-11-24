// Plain HTML version: used for reduced motion, no WebGL, failed CDN, or ?static.
import { PROFILE, T, PROJECTS, contactRows, metricValue } from './content.js';
import { state, setLang } from './state.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ext = 'target="_blank" rel="noopener"';

function html(lang) {
  const t = T[lang], tp = t.proj, forced = new URLSearchParams(location.search).has('static');
  const projects = PROJECTS.map((p, i) => {
    const P = p[lang];
    const links = [p.demo && `<a class="s-pill" href="${p.demo}" ${ext}>${esc(tp.demo)}</a>`, p.repo && `<a href="${p.repo}" ${ext}>${esc(tp.github)}</a>`].filter(Boolean).join('');
    return `<article class="s-proj" id="p-${p.id}">
      <p class="s-eyebrow">${esc(`${tp.project} ${String(i + 1).padStart(2, '0')} — ${P.kind} — ${p.year}`)}</p>
      <h3>${esc(P.title)}</h3>
      <p class="s-sub">${esc(P.tagline)}</p>
      <ul class="s-metrics">${p.metrics.map(m => `<li><b>${esc(metricValue(m, lang))}</b><span>${esc(m[lang])}</span></li>`).join('')}</ul>
      <details><summary>${esc(tp.case.replace(' →', ''))}</summary>${P.case.map(c => `<p><b>${esc(c.t)}</b> — ${esc(c.d)}</p>`).join('')}</details>
      <p class="s-stack">${esc(p.stack)}</p>
      ${links ? `<p class="s-cta">${links}</p>` : ''}
    </article>`;
  }).join('');
  return `
  <header class="s-nav">
    <a class="s-brand" href="#top"><span class="s-mark"></span>${esc(t.short)}</a>
    <nav><a href="#work">${esc(t.nav.work)}</a><a href="#skills">${esc(t.nav.skills)}</a><a href="#contact">${esc(t.nav.contact)}</a></nav>
    <div class="s-lang"><button data-l="en" class="${lang === 'en' ? 'on' : ''}">EN</button><span>/</span><button data-l="ru" class="${lang === 'ru' ? 'on' : ''}">RU</button></div>
  </header>
  <section class="s-hero" id="top">
    <p class="s-eyebrow">${esc(t.home.eyebrow)}</p>
    <h1>${t.nameLines.map(esc).join('<br>')}</h1>
    <p class="s-sub">${esc(t.home.sub)}</p>
    <p class="s-cta"><a class="s-pill" href="#work">${esc(t.home.cta)}</a><a href="${PROFILE.cv}" ${ext}>${esc(t.nav.cv)}</a>${forced ? `<a href="./">Interactive version →</a>` : ''}</p>
  </section>
  <section id="work">
    <p class="s-eyebrow">${esc(t.work.eyebrow)}</p>
    <h2>${esc(t.work.lines.join(' '))}</h2>
    ${projects}
  </section>
  <section id="skills">
    <p class="s-eyebrow">${esc(t.skills.eyebrow)}</p>
    <h2>${esc(t.skills.lines.join(' '))}</h2>
    <p class="s-sub">${esc(t.skills.about)}</p>
    <dl class="s-skills">${t.skills.groups.map(g => `<dt>${esc(g.t)}</dt><dd>${esc(g.d)}</dd>`).join('')}</dl>
    <h3>${esc(t.skills.reader.title)}</h3>
    ${t.skills.reader.paras.map(c => `<p><b>${esc(c.t)}</b> — ${esc(c.d)}</p>`).join('')}
    <p><a href="${PROFILE.certificates}" ${ext}>${esc(t.skills.reader.links[0].label)}</a></p>
  </section>
  <section id="contact">
    <p class="s-eyebrow">${esc(t.contact.eyebrow)}</p>
    <h2>${esc(t.contact.lines.join(' '))}</h2>
    <p class="s-sub">${esc(t.contact.sub)}</p>
    <dl class="s-contact">${contactRows().map(r => `<dt>${esc(r.label)}</dt><dd><a href="${r.href}" ${r.ext ? ext : ''}>${esc(r.value)}</a></dd>`).join('')}</dl>
    <p class="s-cta"><a class="s-pill" href="mailto:${PROFILE.email}">${esc(t.contact.cta)}</a><a href="${PROFILE.cv}" ${ext}>${esc(t.contact.link)}</a></p>
  </section>
  <footer class="s-foot"><span>${esc(t.home.footL)}</span><span>${esc(t.home.footR)}</span></footer>`;
}

export function renderStatic() {
  document.body.classList.remove('gl');
  document.body.classList.add('static');
  const root = document.getElementById('static');
  const render = () => {
    root.innerHTML = html(state.lang);
    document.title = `${T[state.lang].fullName} — ${T[state.lang].home.title}`;
    root.querySelectorAll('.s-lang button').forEach(b => b.addEventListener('click', () => { setLang(b.dataset.l); render(); }));
  };
  render();
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) document.getElementById('p-' + m[1])?.scrollIntoView();
}
