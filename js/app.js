import { renderStatic } from './static.js';

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

const params = new URLSearchParams(location.search);
const forceStatic = params.has('static');
// Reduced motion keeps the glass but swaps the shatter for a gentle cross-fade.
// ?motion forces the full shatter anyway.
const calm = !params.has('motion') && matchMedia('(prefers-reduced-motion: reduce)').matches;

if (forceStatic || !hasWebGL2()) renderStatic();
else {
  import('./glass.js')
    .then(m => m.start({ calm }))
    .catch(err => { console.error(err); renderStatic(); });
}
