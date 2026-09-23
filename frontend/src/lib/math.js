// Shared LaTeX helpers for chat rendering and file export.

// remark-math only understands $…$ and $$…$$, but models usually write LaTeX
// as \[…\] / \(…\) — or, once the backslash is lost, a line like
// "[ z = \frac{a}{b} ]". Rewrite those outside code so KaTeX renders them.
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

export function normalizeMathDelimiters(text) {
  if (!text || !/\\[[(]|\[\s[^\]\n]*\\[a-zA-Z]/.test(text)) return text;
  return String(text).split(CODE_SEGMENT).map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m.trim()}$`)
      .replace(/^[ \t]*\[[ \t]+([^\n]*\\[a-zA-Z]+[^\n]*?)[ \t]+\][ \t]*$/gm, (_, m) => `$$\n${m.trim()}\n$$`);
  }).join("");
}

const SYMBOLS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠",
  approx: "≈", equiv: "≡", propto: "∝", infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π", int: "∫",
  oint: "∮", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔",
  Leftrightarrow: "⇔", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀",
  exists: "∃", angle: "∠", circ: "°", degree: "°", prime: "′", ldots: "…", cdots: "⋯", dots: "…", hbar: "ħ",
  sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc", log: "log", ln: "ln", exp: "exp",
  lim: "lim", max: "max", min: "min", det: "det",
};
const SUPERSCRIPT = {
  0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼",
  "(": "⁽", ")": "⁾", "°": "°", "′": "′", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ",
  k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};
const SUBSCRIPT = {
  0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌",
  "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ",
  s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

// Reads one argument after a command: a {group} or a single token.
function readArg(src, i) {
  while (src[i] === " ") i++;
  if (src[i] === "{") {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) return [src.slice(i + 1, j), j + 1];
    }
    return [src.slice(i + 1), src.length];
  }
  if (src[i] === "\\") {
    const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
    return [m[0], i + m[0].length];
  }
  return [src[i] || "", i + 1];
}

// Parenthesize anything longer than one number, letter or bracketed group.
const SCRIPT_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ°′";
const SINGLE_TERM = new RegExp(`^(\\d+(\\.\\d+)?|[^\\s\\d()+\\-−=/*×·±])[${SCRIPT_CHARS}]*$`, "u");
const wrap = (s) => (SINGLE_TERM.test(s) || /^√?\(.*\)$/u.test(s) ? s : `(${s})`);
const script = (text, table, marker) => {
  const chars = [...text];
  return chars.every((c) => table[c]) ? chars.map((c) => table[c]).join("") : `${marker}${wrap(text)}`;
};

// LaTeX → readable Unicode text, for places that can't render math
// (spreadsheet cells, plain text). E.g. \dfrac{-b\pm\sqrt{b^2-4ac}}{2a}
// → (−b ± √(b² − 4ac))/(2a).
export function latexToText(latex = "") {
  const src = String(latex);
  let out = "";
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      const name = m[1];
      i += m[0].length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [num, a] = readArg(src, i);
        const [den, b] = readArg(src, a);
        i = b;
        out += `${wrap(latexToText(num))}/${wrap(latexToText(den))}`;
      } else if (name === "sqrt") {
        let index = "";
        if (src[i] === "[") { const end = src.indexOf("]", i); index = src.slice(i + 1, end); i = end + 1; }
        const [arg, next] = readArg(src, i);
        i = next;
        out += `${index ? script(latexToText(index), SUPERSCRIPT, "^") : ""}√${wrap(latexToText(arg))}`;
      } else if (["text", "mathrm", "mathbf", "mathit", "operatorname", "textbf", "mathsf", "boldsymbol", "vec", "hat", "bar", "overline"].includes(name)) {
        const [arg, next] = readArg(src, i);
        i = next;
        out += latexToText(arg) + (name === "vec" ? "⃗" : name === "hat" ? "̂" : name === "bar" || name === "overline" ? "̄" : "");
      } else if (name === "binom") {
        const [n, a] = readArg(src, i);
        const [k, b] = readArg(src, a);
        i = b;
        out += `C(${latexToText(n)}, ${latexToText(k)})`;
      } else if (["left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "limits", "!", "quad", "qquad", ",", ";", ":", " "].includes(name)) {
        out += ["quad", "qquad"].includes(name) ? "  " : [",", ";", ":", " "].includes(name) ? " " : "";
      } else if (SYMBOLS[name] !== undefined) {
        const symbol = SYMBOLS[name];
        // Function names (sin, log, lim…) read as words: keep them apart from
        // the letters around them.
        if (/^[a-z]{2,}$/.test(symbol)) {
          if (/[\w)]$/.test(out)) out += " ";
          out += symbol;
          if (/^\s*[A-Za-z0-9\\(]/.test(src.slice(i))) out += " ";
        } else out += symbol;
      } else if ("{}%$&#_".includes(name)) {
        out += name;
      } else {
        out += name;
      }
      continue;
    }
    if (ch === "^" || ch === "_") {
      const [arg, next] = readArg(src, i + 1);
      i = next;
      const text = latexToText(arg);
      out += ch === "^" ? script(text, SUPERSCRIPT, "^") : script(text, SUBSCRIPT, "_");
      continue;
    }
    if (ch === "{" || ch === "}") { i++; continue; }
    if (ch === "-") { out += "−"; i++; continue; }
    out += ch;
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}
