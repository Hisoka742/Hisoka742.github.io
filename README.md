# Salman El Farissi Atmania — portfolio

Personal site: ML / NLP / Agentic AI. Every page is a slab of dark smoked glass with the content printed on the shards; moving between pages shatters the slab and the next page flies in. English and Russian.

Built with plain HTML, CSS and JavaScript and [three.js](https://threejs.org) 0.169 from a CDN. There is no build step.

## Run locally

```bash
python -m http.server 5178
# open http://localhost:5178
```

ES modules need a web server; opening `index.html` from disk does not work.

## Edit content

All text (both languages), projects, metrics and contact links live in [`js/content.js`](js/content.js). Layout adapts to text length automatically.

- `PROFILE.linkedin` / `PROFILE.hh`: paste profile URLs and they appear on the Contact page.
- `PROFILE.cv`: the PDF in `assets/`.
- `PROJECTS`: order here is the order on the Work page.

## URL options

| URL | Effect |
|---|---|
| `?lang=ru` / `?lang=en` | force a language (otherwise browser language, then last choice) |
| `?static` | plain HTML version |
| `?motion` | force the WebGL version even if the OS asks for reduced motion |
| `#/work`, `#/skills`, `#/contact`, `#/p/<id>`, `#/p/<id>/case` | deep links |

Visitors with "reduce motion" enabled, without WebGL2, or whose CDN load fails get the plain HTML version automatically.

## Deploy to GitHub Pages

1. Create a public repository named exactly `Hisoka742.github.io`.
2. Push the contents of this folder to its `main` branch.
3. The site goes live at `https://hisoka742.github.io` (Settings → Pages → Deploy from branch `main` / root, if not enabled automatically).
