# Stockfish for Chess Arena

Chess Arena runs Stockfish 19 from stockfish.js 19.0.1 (npm `stockfish`) in a
Web Worker (`src/utils/stockfish.js`).

- `stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm`: the lite,
  single-threaded build, copied unchanged from the package's `bin/` folder. AI
  vs AI and Spectator play it, and Master falls back to it. The `.js` file
  loads the `.wasm` file of the same name from next to it, so the two must
  stay together.
- `full/` (generated, not in git): Master's engine, the full build with
  Stockfish's big network, in two flavours: `stockfish-19` (multi-threaded,
  needs a cross-origin isolated page, which Chess Arena's own page `/chess`
  is) and `stockfish-19-single` (anywhere else). `scripts/stockfishFull.mjs`
  copies their loaders here and cuts each 94.5 MiB `.wasm` into parts under
  25 MiB (Cloudflare's per-file limit) before every `npm run dev` and
  `npm run build`, from the `stockfish` package pinned in `package.json`.
  `full/manifest.json` lists the parts; `src/utils/stockfishFull.js`
  downloads them, keeps them in the Cache API and joins them in the browser.
- `Copying.txt`: the license, GNU GPL v3.

Headers (`public/_headers`): Chess Arena's own page, `/chess`, is served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
credentialless`, which makes it cross-origin isolated so the multi-threaded
build gets SharedArrayBuffer. Only that page: the rest of the app signs in
through popups, which an isolated page never hears back from. Workers started
by an isolated page need COEP on their own script, so everything in
`/stockfish/` and `/assets/` (the arena's engine worker) sends it too.

Source code: https://github.com/nmrugg/stockfish.js (engine wrapper) and
https://github.com/official-stockfish/Stockfish (the engine).

To update the lite build, copy the same two files from a newer `stockfish`
package and change the file name in `STOCKFISH_URL` if the version number in
it changed. To update the full build, change the `stockfish` version in
`package.json` (and the build names in `scripts/stockfishFull.mjs` if the
version number in them changed).
