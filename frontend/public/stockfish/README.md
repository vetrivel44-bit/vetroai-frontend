# Stockfish for Chess Arena

Chess Arena's Master level runs these files in a Web Worker
(`src/utils/stockfish.js`).

- `stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm`: the lite,
  single-threaded build from stockfish.js 19.0.1 (npm `stockfish`), copied
  unchanged from the package's `bin/` folder. The `.js` file loads the `.wasm`
  file of the same name from next to it, so the two must stay together.
- `Copying.txt`: the license, GNU GPL v3.

Source code: https://github.com/nmrugg/stockfish.js (engine wrapper) and
https://github.com/official-stockfish/Stockfish (the engine).

To update, copy the same two files from a newer `stockfish` package and
change the file name in `STOCKFISH_URL` if the version number in it changed.
