import { renderStatic } from './static.js';

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

const params = new URLSearchParams(location.search);
const forceStatic = params.has('static');
// ?motion forces the WebGL version even when the OS asks for reduced motion
const reduceMotion = !params.has('motion') && matchMedia('(prefers-reduced-motion: reduce)').matches;

if (forceStatic || reduceMotion || !hasWebGL2()) renderStatic();
else {
  import('./glass.js')
    .then(m => m.start())
    .catch(err => { console.error(err); renderStatic(); });
}
