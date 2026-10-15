// Three.js ships only as ES modules (build/three.core.min.js plus
// build/three.module.min.js, which imports the core). The chat's 3D blocks run
// in a sandboxed iframe with an opaque origin, where a module can't be
// imported from the app and an inline module can't import another one. This
// turns the two files into one classic script that sets `self.THREE`, so it
// can be inlined into the frame. Used by the vite plugin in vite.config.js.

// `A as b, C` → `A:b, C` (destructuring) or `b:A`-style for exports.
const entries = (list) => list.split(",").map((s) => s.trim()).filter(Boolean).map((item) => {
  const [name, alias] = item.split(/\s+as\s+/);
  return { name: name.trim(), alias: (alias || name).trim() };
});

const IMPORT = /import\{([^}]*)\}from"\.\/three\.core\.min\.js";/;
const REEXPORT = /export\{([^}]*)\}from"\.\/three\.core\.min\.js";/;
const LAST_EXPORT = /export\{([^}]*)\};?\s*$/;

export function toClassicThree(coreSrc, moduleSrc) {
  const core = String(coreSrc);
  const mod = String(moduleSrc);
  const coreExport = LAST_EXPORT.exec(core);
  if (!coreExport) throw new Error("three.core.min.js: final export not found");
  const imp = IMPORT.exec(mod);
  const reexp = REEXPORT.exec(mod);
  const modExport = LAST_EXPORT.exec(mod);
  if (!imp || !modExport) throw new Error("three.module.min.js: import/export not found");
  if (/\bimport\s*\(|import\.meta|\bfrom\s*"/.test(core.slice(0, coreExport.index) + mod.replace(imp[0], "").replace(reexp ? reexp[0] : "", "").slice(0, -modExport[0].length))) {
    throw new Error("three: unexpected extra imports — update scripts/threeClassic.mjs");
  }

  const coreBody = core.slice(0, coreExport.index)
    + `return{${entries(coreExport[1]).map((e) => `${JSON.stringify(e.alias)}:${e.name}`).join(",")}};`;
  let modBody = mod.slice(0, modExport.index)
    + `Object.assign(__out,{${entries(modExport[1]).map((e) => `${JSON.stringify(e.alias)}:${e.name}`).join(",")}});`;
  modBody = modBody.replace(imp[0], `const{${entries(imp[1]).map((e) => `${e.name}:${e.alias}`).join(",")}}=__core;`);
  if (reexp) {
    modBody = modBody.replace(reexp[0], `Object.assign(__out,{${entries(reexp[1]).map((e) => `${JSON.stringify(e.alias)}:__core.${e.name}`).join(",")}});`);
  }
  return `(function(){"use strict";var __out={};var __core=(function(){"use strict";${coreBody}})();${modBody}\nself.THREE=__out;})();`;
}
