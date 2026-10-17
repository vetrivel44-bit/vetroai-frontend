// The document for a ```3d block: Three.js (as a classic script, see
// scripts/threeClassic.mjs), a small stage runtime, and the model's code.
//
// The model writes only the scene: what to build and how it moves. The stage
// supplies the renderer, camera, lights, drag-to-rotate, pinch/ctrl-wheel
// zoom, a slow turn until touched, labels pinned to 3D points, tabs for
// several models, a caption, and automatic framing. It all runs in a sandboxed
// iframe (allow-scripts only), so the model's code never touches the app.

// Runs inside the frame, after THREE has loaded. Placeholders are filled in by
// buildThreeDocument.
const RUNTIME = String.raw`(function () {
  var FRAME_ID = __FRAME_ID__, DARK = __DARK__;
  function post(msg) { msg.source = "vetro-3d"; msg.id = FRAME_ID; try { parent.postMessage(msg, "*"); } catch (e) {} }
  var failed = false;
  function fail(message) {
    if (failed) return; failed = true;
    var box = document.getElementById("error");
    box.textContent = "Couldn't draw this 3D model: " + message;
    box.hidden = false;
    post({ type: "error", message: String(message) });
    report();
  }
  window.addEventListener("error", function (e) { fail(e.message || "script error"); });
  window.__vetroFail = function (e) { fail(e && e.message ? e.message : String(e)); };

  var last = 0;
  function report() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (h && Math.abs(h - last) > 1) { last = h; post({ type: "height", height: h }); }
  }
  window.addEventListener("load", report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);

  var THREE = self.THREE;
  var host = document.getElementById("canvas");
  var labelsEl = document.getElementById("labels");
  var tabsEl = document.getElementById("tabs");
  var captionEl = document.getElementById("caption");
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    window.view = null;
    fail("3D graphics (WebGL) aren't available in this browser.");
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(40, 1, 0.01, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, DARK ? 0x30303a : 0x9a9aa8, 1.6));
  var keyLight = new THREE.DirectionalLight(0xffffff, 2.2); keyLight.position.set(5, 9, 7); scene.add(keyLight);
  var fillLight = new THREE.DirectionalLight(0xffffff, 0.7); fillLight.position.set(-7, 3, -5); scene.add(fillLight);

  // pivot turns with the user's drag; inner holds the model, offset so its
  // centre sits on the pivot.
  var pivot = new THREE.Group(); scene.add(pivot);
  var inner = new THREE.Group(); pivot.add(inner);
  var frameFns = [], labels = [];
  var orbit = { yaw: -0.6, pitch: 0.42, dist: 8, radius: 2, autoRotate: true, touchedAt: 0 };

  function toVector(at) {
    if (!at) return new THREE.Vector3();
    if (at.isVector3) return at.clone();
    if (Array.isArray(at)) return new THREE.Vector3(+at[0] || 0, +at[1] || 0, +at[2] || 0);
    return new THREE.Vector3(+at.x || 0, +at.y || 0, +at.z || 0);
  }

  function disposeAll(object) {
    object.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); });
    });
  }

  function clear() {
    while (inner.children.length) { var c = inner.children[0]; inner.remove(c); disposeAll(c); }
    frameFns = [];
    labels.forEach(function (l) { l.el.remove(); });
    labels = [];
    inner.position.set(0, 0, 0);
    view.caption("");
  }

  // Frames the model so it fills the view at any turn: the model only turns
  // about the vertical axis, so what matters is its radius around that axis
  // and its height, seen at the camera's tilt.
  function fit() {
    inner.position.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0); // measured unturned; tick() reapplies the turn
    pivot.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(inner);
    if (box.isEmpty()) return;
    var center = box.getCenter(new THREE.Vector3());
    inner.position.copy(center).multiplyScalar(-1);
    // Distance from the vertical axis, measured on the vertices themselves:
    // a box's corners overstate anything round (an orbit, a planet) by ~40%.
    var rxz = 0, v = new THREE.Vector3();
    inner.traverse(function (o) {
      var pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      if (!pos) return;
      var step = Math.max(1, Math.floor(pos.count / 4000));
      for (var i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        rxz = Math.max(rxz, Math.hypot(v.x - center.x, v.z - center.z));
      }
    });
    if (!rxz) [box.min.x, box.max.x].forEach(function (x) { [box.min.z, box.max.z].forEach(function (z) {
      rxz = Math.max(rxz, Math.hypot(x - center.x, z - center.z));
    }); });
    var halfH = (box.max.y - box.min.y) / 2;
    rxz = Math.max(rxz, 0.001);
    var vFov = camera.fov * Math.PI / 180;
    var hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    var p = Math.abs(orbit.pitch);
    var vertical = halfH * Math.cos(p) + rxz * Math.sin(p);
    var need = Math.max(vertical / Math.tan(vFov / 2), rxz / Math.tan(hFov / 2));
    orbit.radius = Math.max(rxz, halfH);
    orbit.dist = need * 1.06 + rxz * 0.55; // the near side sits closer to the camera
    camera.near = orbit.radius / 100; camera.far = orbit.radius * 100; camera.updateProjectionMatrix();
  }

  var view = {
    THREE: THREE, scene: scene, camera: camera, renderer: renderer, root: inner,
    // Add objects to the model.
    add: function () { for (var i = 0; i < arguments.length; i++) inner.add(arguments[i]); return arguments[0]; },
    // Run fn(seconds, delta) every frame — for spinning, orbiting, waving.
    animate: function (fn) { if (typeof fn === "function") frameFns.push(fn); },
    // A shaded mesh in one call: view.mesh(new THREE.SphereGeometry(1, 32, 16), "#f5c542", { emissive: "#553300" })
    mesh: function (geometry, color, opts) {
      var o = opts || {};
      var material = new THREE.MeshStandardMaterial(Object.assign({ color: color == null ? "#9aa4b2" : color, roughness: 0.55, metalness: 0.08 }, o));
      return new THREE.Mesh(geometry, material);
    },
    // A line through [[x,y,z], …] points.
    line: function (points, color) {
      var geometry = new THREE.BufferGeometry().setFromPoints(points.map(toVector));
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: color == null ? "#8a8f98" : color }));
    },
    // A smooth tube through [[x,y,z], …] points.
    tube: function (points, radius, color, closed) {
      var curve = new THREE.CatmullRomCurve3(points.map(toVector), !!closed);
      return view.mesh(new THREE.TubeGeometry(curve, Math.max(32, points.length * 8), radius || 0.05, 10, !!closed), color);
    },
    // Parts placed by where they are, so nothing ends up facing the wrong way
    // (a bare CylinderGeometry stands upright). Each adds itself and is returned.
    // A cylinder from one point to another; radiusTo makes it a cone or taper:
    // view.cylinder([-3, 0, 0], [3, 0, 0], 0.5, "#e8ecf2") is a body lying along X.
    cylinder: function (from, to, radius, color, radiusTo, opts) {
      var a = toVector(from), b = toVector(to);
      var axis = new THREE.Vector3().subVectors(b, a);
      var r = radius == null ? 0.1 : radius;
      var m = view.mesh(new THREE.CylinderGeometry(radiusTo == null ? r : radiusTo, r, Math.max(axis.length(), 1e-4), 32), color, opts);
      m.position.copy(a).addScaledVector(axis, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.lengthSq() ? axis.clone().normalize() : new THREE.Vector3(0, 1, 0));
      inner.add(m);
      return m;
    },
    // A box centred at a point, [width (x), height (y), depth (z)], optionally turned [rx, ry, rz] in radians.
    box: function (center, size, color, rotation, opts) {
      var s = size || [1, 1, 1];
      var m = view.mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), color, opts);
      m.position.copy(toVector(center));
      if (rotation) m.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      inner.add(m);
      return m;
    },
    // A sphere at a point; scale [sx, sy, sz] stretches it into an egg or a lens.
    sphere: function (center, radius, color, scale, opts) {
      var m = view.mesh(new THREE.SphereGeometry(radius == null ? 0.5 : radius, 32, 20), color, opts);
      m.position.copy(toVector(center));
      if (scale) m.scale.set(scale[0], scale[1], scale[2]);
      inner.add(m);
      return m;
    },
    // A text label pinned to a point or object: view.label("Roof", [0, 2, 0]) or view.label("Sun", sunMesh).
    label: function (text, at) {
      var el = document.createElement("div");
      el.className = "lbl";
      el.textContent = String(text);
      labelsEl.appendChild(el);
      labels.push({ el: el, object: at && at.isObject3D ? at : null, point: at && at.isObject3D ? null : toVector(at) });
      return el;
    },
    // A short line of text under the model.
    caption: function (text) { captionEl.textContent = text ? String(text) : ""; captionEl.hidden = !text; report(); },
    // Several models behind tabs: view.models({ "Solar system": function () { …; return "caption" }, … })
    models: function (defs) {
      var names = Object.keys(defs || {});
      tabsEl.innerHTML = "";
      tabsEl.hidden = names.length < 2;
      function show(name) {
        clear();
        // A broken model only marks itself; the other tabs still draw.
        failed = false;
        document.getElementById("error").hidden = true;
        Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle("on", b.textContent === name); b.setAttribute("aria-pressed", b.textContent === name); });
        try {
          var result = defs[name]();
          if (typeof result === "string") view.caption(result);
          fit();
        } catch (e) { fail(e.message || String(e)); }
      }
      names.forEach(function (name) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = name;
        b.addEventListener("click", function () { show(name); });
        tabsEl.appendChild(b);
      });
      view.__tabs = true;
      if (names.length) show(names[0]);
      report();
    },
    fit: fit,
    __orbit: orbit,
    get autoRotate() { return orbit.autoRotate; },
    set autoRotate(v) { orbit.autoRotate = !!v; },
    __built: function () {
      if (failed) return;
      if (!view.__tabs) fit();
      if (!inner.children.length) fail("the code didn't add anything to the scene (use view.add).");
      report();
    },
  };
  window.view = view;

  // Drag to turn (touch: sideways drags, so vertical swipes still scroll the
  // chat); pinch or ctrl+wheel (trackpad pinch) to zoom.
  var pointers = {}, pinchFrom = 0;
  function pointerCount() { return Object.keys(pointers).length; }
  host.addEventListener("pointerdown", function (e) {
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    orbit.touchedAt = performance.now();
    if (e.pointerType === "mouse") host.setPointerCapture(e.pointerId);
    if (pointerCount() === 2) { var p = Object.values(pointers); pinchFrom = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
  });
  host.addEventListener("pointermove", function (e) {
    var prev = pointers[e.pointerId];
    if (!prev) return;
    var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    orbit.touchedAt = performance.now();
    if (pointerCount() === 2) {
      var p = Object.values(pointers), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinchFrom) orbit.dist = Math.min(orbit.radius * 12, Math.max(orbit.radius * 1.1, orbit.dist * pinchFrom / d));
      pinchFrom = d;
      return;
    }
    orbit.yaw += dx * 0.012;
    if (e.pointerType === "mouse") orbit.pitch = Math.max(-1.35, Math.min(1.35, orbit.pitch + dy * 0.01));
  });
  function up(e) { delete pointers[e.pointerId]; pinchFrom = 0; }
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("wheel", function (e) {
    if (!e.ctrlKey) return; // plain scrolling keeps scrolling the chat
    e.preventDefault();
    orbit.dist = Math.min(orbit.radius * 12, Math.max(orbit.radius * 1.1, orbit.dist * (1 + e.deltaY * 0.01)));
    orbit.touchedAt = performance.now();
  }, { passive: false });

  var lastT = performance.now(), start = lastT, tmp = new THREE.Vector3();
  function resize() {
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
  resize();

  function tick(now) {
    requestAnimationFrame(tick);
    var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (orbit.autoRotate && now - orbit.touchedAt > 3500) orbit.yaw += dt * 0.35;
    pivot.rotation.y = orbit.yaw;
    camera.position.set(0, Math.sin(orbit.pitch) * orbit.dist, Math.cos(orbit.pitch) * orbit.dist);
    camera.lookAt(0, 0, 0);
    var t = (now - start) / 1000;
    for (var i = 0; i < frameFns.length; i++) {
      try { frameFns[i](t, dt); } catch (e) { fail(e.message || String(e)); frameFns = []; break; }
    }
    renderer.render(scene, camera);
    if (labels.length) {
      var w = host.clientWidth, h = host.clientHeight;
      scene.updateMatrixWorld();
      labels.forEach(function (l) {
        if (l.object) l.object.getWorldPosition(tmp); else tmp.copy(l.point).applyMatrix4(inner.matrixWorld);
        tmp.project(camera);
        var visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
        l.el.style.display = visible ? "" : "none";
        if (visible) l.el.style.transform = "translate(-50%, -130%) translate(" + ((tmp.x + 1) / 2 * w).toFixed(1) + "px," + ((1 - tmp.y) / 2 * h).toFixed(1) + "px)";
      });
    }
  }
  requestAnimationFrame(tick);
})();`;

const escapeScript = (code) => String(code).replace(/<\/(script)/gi, "<\\/$1");

/** The full srcdoc for a ```3d block. */
export function buildThreeDocument({ three, code, frameId, theme }) {
  const dark = theme === "dark";
  const runtime = RUNTIME.replace("__FRAME_ID__", JSON.stringify(frameId)).replace("__DARK__", dark ? "true" : "false");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: ${dark ? "dark" : "light"}; }
  html, body { margin: 0; background: ${dark ? "#1d1c1b" : "#faf9f7"}; color: ${dark ? "#ece9e4" : "#1f1d1a"};
    font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; }
  #tabs { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 12px 0; }
  #tabs[hidden] { display: none; }
  #tabs button { font: inherit; font-size: 13px; padding: 7px 14px; border-radius: 10px; cursor: pointer;
    color: inherit; background: transparent; border: 1px solid ${dark ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.14)"}; }
  #tabs button.on { background: ${dark ? "#ece9e4" : "#1f1d1a"}; color: ${dark ? "#1d1c1b" : "#faf9f7"}; border-color: transparent; }
  #stage { position: relative; }
  #canvas { width: 100%; height: clamp(260px, 70vw, 400px); touch-action: pan-y; cursor: grab; }
  #canvas:active { cursor: grabbing; }
  #canvas canvas { display: block; width: 100% !important; height: 100% !important; }
  #labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .lbl { position: absolute; left: 0; top: 0; white-space: nowrap; font-size: 12px; padding: 2px 7px; border-radius: 6px;
    background: ${dark ? "rgba(29,28,27,.82)" : "rgba(255,255,255,.88)"}; border: 1px solid ${dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)"}; }
  #caption { margin: 0; padding: 0 14px 12px; font-size: 13px; line-height: 1.5; color: ${dark ? "rgba(236,233,228,.62)" : "rgba(31,29,26,.62)"}; }
  #caption[hidden], #error[hidden] { display: none; }
  #error { margin: 12px; padding: 10px 12px; border-radius: 10px; font-size: 13px; color: #b42318; background: rgba(240,68,56,.1); }
</style></head><body>
<div id="tabs" hidden></div>
<div id="stage"><div id="canvas"></div><div id="labels"></div></div>
<p id="caption" hidden></p>
<div id="error" hidden></div>
<script>(function () {
  // Sandboxed without same-origin, touching storage throws — give scripts
  // working in-memory storage instead (same shim as the html widgets).
  function mem() { var d = {}; return { getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; }, setItem: function (k, v) { d[String(k)] = String(v); }, removeItem: function (k) { delete d[String(k)]; }, clear: function () { d = {}; }, key: function (i) { return Object.keys(d)[i] || null; }, get length() { return Object.keys(d).length; } }; }
  ["localStorage", "sessionStorage"].forEach(function (n) { try { window[n].getItem("x"); } catch (e) { try { Object.defineProperty(window, n, { value: mem(), configurable: true }); } catch (e2) {} } });
})();</script>
<script>${escapeScript(three)}</script>
<script>${escapeScript(runtime)}</script>
<script>
if (window.view) {
  try {
    (function (THREE, view, scene, camera, renderer) {
${escapeScript(code)}
    })(THREE, view, view.scene, view.camera, view.renderer);
    view.__built();
  } catch (e) { window.__vetroFail(e); }
}
</script>
</body></html>`;
}

/** The block's title: a leading `// title: …` comment, else "3D model". */
export function threeTitle(code) {
  const m = /^\s*\/\/\s*title\s*:\s*(.{1,60})$/im.exec(String(code || ""));
  return (m ? m[1] : "3D model").trim();
}
