// Ask Security: find every guard in the crowd and ask to hold their gun.
// The scene is one SVG in a fixed 1600x900 coordinate space; the page scales
// it, and on narrow screens the wrapper scrolls sideways instead of shrinking
// the people past tappable size.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1600;
  const H = 900;
  const GUARDS = 8;
  const DECOYS = 2;
  const CIVILIANS = 38;
  const BEST_KEY = "scarevenger.askSecurity.best";

  const GUARD_LINES = [
    "No.", "Go away.", "F*** off.", "Absolutely not.", "Nope.", "Not a chance.",
    "Keep walking.", "Get lost.", "Beat it.", "Hard pass.", "Lol. No.", "Sir. No.",
    "Ma'am. No.", "Why would I let you hold it?", "Is this a scavenger hunt thing?",
    "You're the fifth one tonight.", "I'm calling my supervisor.", "Not even a little.",
    "Absolutely f***ing not.", "Go hold a churro.", "Buddy. No.", "Move along.",
  ];
  const REPEAT_LINES = [
    "I SAID NO.", "Again?! F*** off.", "We've been over this.", "Still no.",
    "Do NOT make me radio this in.", "The answer hasn't changed.",
  ];
  const DECOY_LINES = [
    "It's a costume, man.", "I'm dressed as a mall cop. Happy Halloween!",
    "Ha! Fooled you.", "This badge is a sticker.", "I work at the pretzel place.",
  ];
  const CIVILIAN_LINES = [
    "I'm not security.", "Happy Halloween!", "Ask a guard?", "Do I look armed?",
    "Nice costume.", "Wrong person, pal.", "I'm just here for a movie.", "Spencer's is that way.",
    "Leave me out of this.", "Is this for that hunt?", "Boo.",
    "Try the guy in the navy shirt.", "I'm a ghost. I can't hold anything.",
  ];

  const SKIN = ["#f1c7a5", "#e0ac84", "#c68b62", "#a8714a", "#8a5634", "#5e3a22"];
  const SHIRTS = ["#d94f4f", "#4fa36b", "#e0b33c", "#9b6bd6", "#3fa7b5", "#e27ab2", "#f08a3c", "#7c8a99", "#ececec"];
  const PANTS = ["#3b4a6b", "#2a2a2a", "#6b5a45", "#4a4f57", "#2f3f5c"];
  const COSTUMES = ["shopper", "shopper", "shopper", "witch", "ghost", "pumpkin", "vampire", "skeleton", "cat", "devil", "cowboy"];

  // Feet-y range and scale for each depth band, back to front.
  const BANDS = [
    { y0: 505, y1: 545, s: 0.8 },
    { y0: 630, y1: 690, s: 1.05 },
    { y0: 790, y1: 870, s: 1.3 },
  ];

  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const rand = (a, b) => a + Math.random() * (b - a);

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  // Draws lines without repeats until the bag runs out.
  function bag(lines) {
    let left = [];
    return () => {
      if (!left.length) left = [...lines].sort(() => Math.random() - 0.5);
      return left.pop();
    };
  }
  const guardLine = bag(GUARD_LINES);
  const repeatLine = bag(REPEAT_LINES);
  const decoyLine = bag(DECOY_LINES);
  const civilianLine = bag(CIVILIAN_LINES);

  const svg = document.getElementById("scene");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // ---------- scenery ----------

  function drawScenery() {
    const defs = el("defs", {}, svg);
    const sky = el("linearGradient", { id: "sky", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#0b0716" }, sky);
    el("stop", { offset: "1", "stop-color": "#3a1d4a" }, sky);
    const ground = el("linearGradient", { id: "ground", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#4a3a44" }, ground);
    el("stop", { offset: "1", "stop-color": "#221a24" }, ground);
    const glow = el("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    el("feGaussianBlur", { stdDeviation: 4, result: "b" }, glow);
    const merge = el("feMerge", {}, glow);
    el("feMergeNode", { in: "b" }, merge);
    el("feMergeNode", { in: "SourceGraphic" }, merge);

    el("rect", { x: 0, y: 0, width: W, height: 480, fill: "url(#sky)" }, svg);
    for (let i = 0; i < 70; i++) {
      el("circle", { cx: rand(0, W), cy: rand(0, 300), r: rand(0.6, 1.8), fill: "#fff", opacity: rand(0.3, 0.9) }, svg);
    }
    el("circle", { cx: 1360, cy: 110, r: 48, fill: "#f6ecd0", filter: "url(#glow)" }, svg);
    el("circle", { cx: 1345, cy: 100, r: 9, fill: "#e4d7b4" }, svg);
    el("circle", { cx: 1378, cy: 126, r: 6, fill: "#e4d7b4" }, svg);
    for (const [x, y, s] of [[260, 120, 1], [330, 90, 0.7], [1180, 170, 0.8]]) {
      el("path", {
        d: "M0 0 q8 -8 16 0 q4 -6 8 -2 q4 -4 8 2 q8 -8 16 0 q-10 -2 -16 6 q-4 -4 -8 0 q-6 -8 -24 -6z",
        transform: `translate(${x} ${y}) scale(${s * 1.6})`, fill: "#120a1a",
      }, svg);
    }
    el("path", {
      d: "M0 410 L110 350 L210 380 L330 300 L470 365 L600 325 L760 385 L900 335 L1040 370 L1180 310 L1320 360 L1460 330 L1600 370 L1600 480 L0 480Z",
      fill: "#24182f",
    }, svg);

    el("rect", { x: 0, y: 470, width: W, height: H - 470, fill: "url(#ground)" }, svg);
    for (const y of [520, 590, 680, 790]) {
      el("line", { x1: 0, y1: y, x2: W, y2: y, stroke: "#ffffff", "stroke-opacity": 0.05, "stroke-width": 2 }, svg);
    }

    const stores = [
      [0, 230, 275, "BARNES & NOBLE", "#6fe0a0", "#24453a"],
      [230, 450, 260, "CLAIRE'S", "#ff7ad9", "#5a2a55"],
      [450, 680, 240, "AMC", "#ff4a4a", "#3a1a1f"],
      [920, 1150, 255, "SPENCER'S", "#ffe14a", "#2a2a2a"],
      [1150, 1380, 280, "JOURNEYS", "#f3f0ea", "#1f1f26"],
      [1380, 1600, 265, "H&M", "#ff3b3b", "#4a2a2e"],
    ];
    for (const [x0, x1, top, name, neon, wall] of stores) {
      const w = x1 - x0;
      el("rect", { x: x0, y: top, width: w, height: 470 - top, fill: wall, stroke: "#120c18", "stroke-width": 3 }, svg);
      el("rect", { x: x0 + 12, y: 375, width: w - 24, height: 90, fill: "#ffcf7a", opacity: 0.55 }, svg);
      el("rect", { x: x0 + w / 2 - 18, y: 400, width: 36, height: 65, fill: "#2a1a10", opacity: 0.8 }, svg);
      for (let i = 0; i < Math.floor(w / 28); i++) {
        el("rect", { x: x0 + i * 28, y: 352, width: 28, height: 20, fill: i % 2 ? "#f3e9dc" : neon, opacity: 0.85 }, svg);
      }
      el("text", {
        x: x0 + w / 2, y: top + 52, "text-anchor": "middle", fill: neon, filter: "url(#glow)",
        // Long names shrink to fit the storefront.
        "font-family": "ui-sans-serif, system-ui, sans-serif", "font-weight": 800,
        "font-size": Math.min(name.length <= 3 ? 40 : 26, (w - 28) / (name.length * 0.78)), "letter-spacing": 2,
      }, svg).textContent = name;
    }

    el("rect", { x: 680, y: 150, width: 240, height: 320, fill: "#6b4a3a", stroke: "#120c18", "stroke-width": 3 }, svg);
    el("rect", { x: 680, y: 150, width: 240, height: 18, fill: "#8a5f48" }, svg);
    el("text", {
      x: 800, y: 228, "text-anchor": "middle", fill: "#ff7a1a", filter: "url(#glow)",
      "font-family": "ui-sans-serif, system-ui, sans-serif", "font-weight": 900, "font-size": 30, "letter-spacing": 3,
    }, svg).textContent = "DESERT";
    el("text", {
      x: 800, y: 266, "text-anchor": "middle", fill: "#ff7a1a", filter: "url(#glow)",
      "font-family": "ui-sans-serif, system-ui, sans-serif", "font-weight": 900, "font-size": 30, "letter-spacing": 3,
    }, svg).textContent = "RIDGE";
    el("rect", { x: 740, y: 330, width: 120, height: 140, rx: 60, fill: "#ffcf7a", opacity: 0.45 }, svg);
  }

  function kiosk(parent, x, base) {
    el("rect", { x: x - 60, y: base - 64, width: 120, height: 64, fill: "#3a2a1f", stroke: "#120c18", "stroke-width": 3 }, parent);
    el("rect", { x: x - 52, y: base - 56, width: 104, height: 22, fill: "#ffcf7a", opacity: 0.7 }, parent);
    el("path", { d: `M${x - 72} ${base - 64} L${x} ${base - 100} L${x + 72} ${base - 64}Z`, fill: "#ff7a1a", stroke: "#120c18", "stroke-width": 3 }, parent);
    el("text", {
      x, y: base - 70, "text-anchor": "middle", fill: "#1a0d02",
      "font-family": "ui-sans-serif, system-ui, sans-serif", "font-weight": 800, "font-size": 13,
    }, parent).textContent = "PRETZELS";
  }

  function bench(parent, x, base) {
    el("rect", { x: x - 50, y: base - 22, width: 100, height: 8, fill: "#6b4a3a" }, parent);
    el("rect", { x: x - 50, y: base - 36, width: 100, height: 6, fill: "#6b4a3a" }, parent);
    el("rect", { x: x - 44, y: base - 14, width: 6, height: 14, fill: "#2a1a10" }, parent);
    el("rect", { x: x + 38, y: base - 14, width: 6, height: 14, fill: "#2a1a10" }, parent);
  }

  function fountain(parent, x, base) {
    el("rect", { x: x - 140, y: base - 42, width: 280, height: 42, fill: "#8a7a80", stroke: "#120c18", "stroke-width": 3 }, parent);
    el("ellipse", { cx: x, cy: base - 42, rx: 140, ry: 16, fill: "#3fa7b5", stroke: "#120c18", "stroke-width": 3 }, parent);
    el("rect", { x: x - 8, y: base - 120, width: 16, height: 80, fill: "#8a7a80", stroke: "#120c18", "stroke-width": 2 }, parent);
    el("ellipse", { cx: x, cy: base - 120, rx: 46, ry: 8, fill: "#8a7a80", stroke: "#120c18", "stroke-width": 2 }, parent);
    for (const dx of [-1, 1]) {
      el("path", {
        d: `M${x} ${base - 150} q${dx * 50} -10 ${dx * 70} ${100}`,
        fill: "none", stroke: "#bfe9f0", "stroke-width": 4, opacity: 0.7,
      }, parent);
    }
  }

  function jackOLantern(parent, x, base, s = 1) {
    const g = el("g", { transform: `translate(${x} ${base}) scale(${s})` }, parent);
    el("ellipse", { cx: 0, cy: -16, rx: 20, ry: 16, fill: "#ff7a1a", stroke: "#120c18", "stroke-width": 2 }, g);
    el("rect", { x: -2, y: -36, width: 4, height: 7, fill: "#4fa36b" }, g);
    el("path", { d: "M-10 -20 l4 -6 l4 6z M2 -20 l4 -6 l4 6z M-10 -10 q10 8 20 0 l-4 3 l-4 -3 l-4 3z", fill: "#ffe08a" }, g);
  }

  function palm(parent, x, base) {
    el("path", {
      d: `M${x - 9} ${base} C${x - 4} ${base - 200} ${x + 14} ${base - 360} ${x + 8} ${base - 500} L${x + 20} ${base - 500} C${x + 26} ${base - 360} ${x + 10} ${base - 200} ${x + 9} ${base}Z`,
      fill: "#3a2a22", stroke: "#120c18", "stroke-width": 2,
    }, parent);
    const top = { x: x + 14, y: base - 500 };
    for (const [dx, dy] of [[-110, 40], [-80, 70], [110, 40], [80, 75], [-30, 85], [40, 90], [0, -40]]) {
      el("path", {
        d: `M${top.x} ${top.y} q${dx / 2} ${dy / 2 - 40} ${dx} ${dy}`,
        fill: "none", stroke: "#1f3b2a", "stroke-width": 14, "stroke-linecap": "round",
      }, parent);
    }
  }

  function saguaro(parent, x, base, h) {
    const c = { fill: "#2f5a3a", stroke: "#120c18", "stroke-width": 2 };
    el("rect", { x: x - 14, y: base - h, width: 28, height: h, rx: 14, ...c }, parent);
    el("path", { d: `M${x - 14} ${base - h * 0.45} h-24 a10 10 0 0 1 -10 -10 v-${h * 0.25} a10 10 0 0 1 20 0 v${h * 0.15} h14z`, ...c }, parent);
    el("path", { d: `M${x + 14} ${base - h * 0.6} h22 a10 10 0 0 0 10 -10 v-${h * 0.2} a10 10 0 0 0 -20 0 v${h * 0.1} h-12z`, ...c }, parent);
  }

  function stringLights(parent, points) {
    const colors = ["#ff7a1a", "#b47aff", "#ffe08a", "#4fd6a0"];
    let n = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const sag = 50;
      el("path", { d: `M${x0} ${y0} Q${(x0 + x1) / 2} ${(y0 + y1) / 2 + sag * 2} ${x1} ${y1}`, fill: "none", stroke: "#120c18", "stroke-width": 2 }, parent);
      for (let t = 0.08; t < 1; t += 0.08) {
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2 + sag * 2;
        const bx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1;
        const by = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1;
        el("circle", { cx: bx, cy: by + 5, r: 5, fill: colors[n++ % colors.length], filter: "url(#glow)" }, parent);
      }
    }
  }

  // ---------- people ----------

  function drawPerson(kind, g) {
    const skin = pick(SKIN);
    const costume = kind === "civilian" ? pick(COSTUMES) : kind;
    let shirt = pick(SHIRTS);
    let pants = pick(PANTS);
    if (costume === "guard" || costume === "decoy") { shirt = "#23314f"; pants = "#14161c"; }
    if (["witch", "vampire", "skeleton", "cat"].includes(costume)) { shirt = "#1a1420"; pants = "#1a1420"; }
    if (costume === "devil") shirt = "#c22b2b";
    if (costume === "pumpkin") shirt = "#3a7a4a";
    if (costume === "vampire") shirt = "#ececec";

    if (costume === "ghost") {
      el("path", { d: "M-14 0 Q-16 -40 -11 -54 Q0 -72 11 -54 Q16 -40 14 0 l-5 -6 l-5 6 l-4 -6 l-4 6 l-5 -6z", fill: "#f3f0ea", stroke: "#120c18", "stroke-width": 2 }, g);
      el("ellipse", { cx: -4, cy: -52, rx: 2.5, ry: 4, fill: "#120c18" }, g);
      el("ellipse", { cx: 5, cy: -52, rx: 2.5, ry: 4, fill: "#120c18" }, g);
      return;
    }

    if (costume === "vampire") {
      el("path", { d: "M-14 -46 L-20 -4 L20 -4 L14 -46Z", fill: "#1a0a10", stroke: "#120c18", "stroke-width": 2 }, g);
      el("path", { d: "M-12 -46 L-16 -8 L16 -8 L12 -46Z", fill: "#8a1a2a" }, g);
    }
    el("rect", { x: -7, y: -21, width: 5, height: 21, fill: pants }, g);
    el("rect", { x: 2, y: -21, width: 5, height: 21, fill: pants }, g);
    if (costume === "witch") {
      el("path", { d: "M-9 -44 L-15 -6 L15 -6 L9 -44Z", fill: "#2a1a3a", stroke: "#120c18", "stroke-width": 2 }, g);
    } else {
      el("rect", { x: -10, y: -45, width: 20, height: 26, rx: 4, fill: shirt, stroke: "#120c18", "stroke-width": 2 }, g);
    }
    el("rect", { x: -14, y: -43, width: 5, height: 20, rx: 2, fill: shirt, stroke: "#120c18", "stroke-width": 1.5 }, g);
    el("rect", { x: 9, y: -43, width: 5, height: 20, rx: 2, fill: shirt, stroke: "#120c18", "stroke-width": 1.5 }, g);

    if (costume === "skeleton") {
      for (const y of [-40, -35, -30, -25]) el("line", { x1: -6, y1: y, x2: 6, y2: y, stroke: "#f3f0ea", "stroke-width": 2 }, g);
      el("line", { x1: 0, y1: -43, x2: 0, y2: -22, stroke: "#f3f0ea", "stroke-width": 2 }, g);
    }
    if (costume === "guard") {
      el("circle", { cx: -4, cy: -38, r: 2.6, fill: "#e8c24a" }, g);
      el("rect", { x: -10, y: -23, width: 20, height: 3, fill: "#0a0a0a" }, g);
      el("rect", { x: 5, y: -27, width: 4, height: 7, fill: "#0a0a0a" }, g);
    }
    if (costume === "decoy") {
      el("path", { d: "M-6 -41 l1.5 3 l3 .4 l-2.2 2 l.6 3 l-2.9 -1.5 l-2.9 1.5 l.6 -3 l-2.2 -2 l3 -.4z", fill: "#ff7a1a" }, g);
      el("rect", { x: 10, y: -26, width: 9, height: 10, rx: 2, fill: "#ff7a1a", stroke: "#120c18", "stroke-width": 1.5 }, g);
    }
    if (costume === "shopper" && Math.random() < 0.4) {
      el("rect", { x: 11, y: -26, width: 11, height: 13, fill: pick(["#f3e9dc", "#c04fd6", "#4fa36b"]), stroke: "#120c18", "stroke-width": 1.5 }, g);
    }

    const headFill = costume === "skeleton" ? "#f3f0ea" : costume === "pumpkin" ? "#ff7a1a" : costume === "witch" && Math.random() < 0.5 ? "#7ac46a" : skin;
    el("circle", { cx: 0, cy: -53, r: costume === "pumpkin" ? 10 : 8, fill: headFill, stroke: "#120c18", "stroke-width": 2 }, g);
    if (costume === "pumpkin") el("rect", { x: -1.5, y: -66, width: 3, height: 5, fill: "#3a7a4a" }, g);
    if (costume === "skeleton") {
      el("circle", { cx: -3, cy: -54, r: 2, fill: "#120c18" }, g);
      el("circle", { cx: 3, cy: -54, r: 2, fill: "#120c18" }, g);
    }

    if (costume === "guard" || costume === "decoy") {
      el("rect", { x: -9, y: -64, width: 18, height: 7, rx: 3, fill: costume === "guard" ? "#23314f" : "#2b3a5c", stroke: "#120c18", "stroke-width": 1.5 }, g);
      el("rect", { x: 2, y: -59, width: 11, height: 3, rx: 1, fill: "#0e1424" }, g);
    }
    if (costume === "witch") {
      el("path", { d: "M-15 -58 h30 l-4 -3 h-6 l-4 -22 l-6 22 h-6z", fill: "#3a1a4a", stroke: "#120c18", "stroke-width": 1.5 }, g);
    }
    if (costume === "cat") {
      el("path", { d: "M-8 -57 l2 -10 l5 6z M8 -57 l-2 -10 l-5 6z", fill: "#1a1420", stroke: "#120c18", "stroke-width": 1 }, g);
    }
    if (costume === "devil") {
      el("path", { d: "M-6 -59 l-2 -8 l5 5z M6 -59 l2 -8 l-5 5z", fill: "#c22b2b" }, g);
    }
    if (costume === "cowboy") {
      el("ellipse", { cx: 0, cy: -59, rx: 15, ry: 3, fill: "#7a5230", stroke: "#120c18", "stroke-width": 1.5 }, g);
      el("rect", { x: -7, y: -68, width: 14, height: 9, rx: 3, fill: "#7a5230", stroke: "#120c18", "stroke-width": 1.5 }, g);
    }
  }

  // ---------- game state ----------

  let layers;
  let people = [];
  let found = 0;
  let misses = 0;
  let startedAt = 0;
  let finished = false;
  let last = 0;

  const $ = (id) => document.getElementById(id);
  $("guards-total").textContent = GUARDS;

  function build() {
    svg.textContent = "";
    drawScenery();
    const L = (name) => el("g", { "data-layer": name }, svg);
    layers = {
      back: L("back"),
      backProps: L("backProps"),
      mid: L("mid"),
      midProps: L("midProps"),
      front: L("front"),
      frontProps: L("frontProps"),
      bubbles: L("bubbles"),
    };
    kiosk(layers.backProps, 330, 580);
    bench(layers.backProps, 1060, 575);
    bench(layers.backProps, 1300, 575);
    fountain(layers.midProps, 800, 765);
    jackOLantern(layers.midProps, 690, 727, 0.8);
    jackOLantern(layers.midProps, 905, 727, 0.8);
    palm(layers.frontProps, 90, 900);
    palm(layers.frontProps, 560, 905);
    palm(layers.frontProps, 1050, 905);
    palm(layers.frontProps, 1510, 900);
    saguaro(layers.frontProps, 330, 895, 170);
    saguaro(layers.frontProps, 1280, 895, 190);
    jackOLantern(layers.frontProps, 200, 890);
    jackOLantern(layers.frontProps, 1400, 892, 1.1);
    stringLights(layers.frontProps, [[-10, 380], [104, 400], [574, 405], [1064, 405], [1524, 400], [1610, 380]]);

    const kinds = [
      ...Array(GUARDS).fill("guard"),
      ...Array(DECOYS).fill("decoy"),
      ...Array(CIVILIANS).fill("civilian"),
    ];
    people = kinds.map((kind) => {
      const bandIndex = kind === "civilian" ? Math.floor(Math.random() * 3) : pick([0, 1, 1, 2, 2]);
      const band = BANDS[bandIndex];
      const walker = kind === "guard" ? Math.random() < 0.7 : Math.random() < 0.35;
      return {
        kind,
        bandIndex,
        x: rand(40, W - 40),
        y: rand(band.y0, band.y1),
        s: band.s * rand(0.95, 1.08),
        vx: walker ? pick([-1, 1]) * rand(12, 32) : 0,
        phase: rand(0, Math.PI * 2),
        asked: false,
      };
    });
    spreadGuards();

    for (const p of [...people].sort((a, b) => a.y - b.y)) {
      const layer = [layers.back, layers.mid, layers.front][p.bandIndex];
      p.g = el("g", { class: "person" }, layer);
      el("ellipse", { cx: 0, cy: 0, rx: 14, ry: 4, fill: "#000", opacity: 0.35 }, p.g);
      p.ring = el("ellipse", { cx: 0, cy: 0, rx: 18, ry: 6, fill: "none", stroke: "#ff7a1a", "stroke-width": 3, opacity: 0 }, p.g);
      p.body = el("g", {}, p.g);
      drawPerson(p.kind, p.body);
      // Bigger than the figure so small people are still easy to tap.
      el("rect", { x: -18, y: -76, width: 36, height: 80, fill: "transparent" }, p.g);
      p.g.addEventListener("click", () => ask(p));
      place(p, 0);
    }
  }

  // Keep guards from clumping so the hunt covers the whole mall.
  function spreadGuards() {
    const guards = people.filter((p) => p.kind === "guard");
    const slot = (W - 80) / guards.length;
    guards.sort(() => Math.random() - 0.5).forEach((p, i) => {
      p.x = 40 + slot * i + rand(10, slot - 10);
    });
  }

  function place(p, t) {
    const bob = p.vx ? -Math.abs(Math.sin(t * 7 + p.phase)) * 2.5 : Math.sin(t * 1.5 + p.phase) * 0.6;
    const dir = p.vx < 0 ? -1 : 1;
    p.g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${(p.y + bob).toFixed(1)}) scale(${p.s.toFixed(3)})`);
    p.body.setAttribute("transform", `scale(${dir} 1)`);
    if (p.bubble) positionBubble(p);
  }

  function say(p, text) {
    if (p.bubble) { p.bubble.g.remove(); clearTimeout(p.bubble.timer); }
    const g = el("g", { class: "bubble" }, layers.bubbles);
    const box = el("rect", { rx: 12, fill: "#f3e9dc", stroke: "#120c18", "stroke-width": 3, height: 44 }, g);
    const tail = el("path", { fill: "#f3e9dc", stroke: "#120c18", "stroke-width": 3 }, g);
    const label = el("text", {
      "text-anchor": "middle", fill: "#1a1020",
      "font-family": "ui-sans-serif, system-ui, sans-serif", "font-weight": 700, "font-size": 22,
    }, g);
    label.textContent = text;
    const w = label.getComputedTextLength() + 32;
    box.setAttribute("width", w);
    p.bubble = { g, box, tail, label, w };
    p.bubble.timer = setTimeout(() => {
      g.classList.add("fading");
      setTimeout(() => { g.remove(); if (p.bubble && p.bubble.g === g) p.bubble = null; }, 300);
    }, 2200);
    positionBubble(p);
  }

  function positionBubble(p) {
    const { box, tail, label, w } = p.bubble;
    const headY = p.y - 72 * p.s - 14;
    const cx = Math.min(Math.max(p.x, w / 2 + 8), W - w / 2 - 8);
    box.setAttribute("x", cx - w / 2);
    box.setAttribute("y", headY - 56);
    label.setAttribute("x", cx);
    label.setAttribute("y", headY - 27);
    tail.setAttribute("d", `M${p.x - 8} ${headY - 13} L${p.x} ${headY} L${p.x + 8} ${headY - 13}`);
  }

  function ask(p) {
    if (finished) return;
    if (!startedAt) startedAt = performance.now();

    if (p.kind !== "guard") {
      misses++;
      $("misses").textContent = misses;
      say(p, p.kind === "decoy" ? decoyLine() : civilianLine());
      return;
    }
    if (p.asked) { say(p, repeatLine()); return; }

    p.asked = true;
    p.ring.setAttribute("opacity", 1);
    found++;
    $("guards-found").textContent = found;
    say(p, guardLine());
    if (found === GUARDS) setTimeout(win, 1400);
  }

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  function readBest() {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
  }

  function win() {
    finished = true;
    const time = performance.now() - startedAt;
    const best = readBest();
    if (!best || time < best) {
      try { localStorage.setItem(BEST_KEY, String(Math.round(time))); } catch {}
    }
    $("win-time").textContent = fmt(time);
    $("win-misses").textContent = misses;
    $("win-best").textContent = !best ? "First try on record." : time < best ? `New best! Previous: ${fmt(best)}` : `Your best: ${fmt(best)}`;
    $("win").hidden = false;
  }

  function reset() {
    found = 0;
    misses = 0;
    startedAt = 0;
    finished = false;
    $("guards-found").textContent = 0;
    $("misses").textContent = 0;
    $("timer").textContent = "0:00";
    $("win").hidden = true;
    build();
  }

  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0);
    last = t;
    for (const p of people) {
      if (p.vx) {
        p.x += p.vx * p.s * dt;
        if (p.x < 30 || p.x > W - 30) {
          p.vx = -p.vx;
          p.x = Math.min(Math.max(p.x, 30), W - 30);
        } else if (Math.random() < dt * 0.08) {
          p.vx = -p.vx;
        }
      }
      place(p, t);
    }
    if (startedAt && !finished) $("timer").textContent = fmt(now - startedAt);
    requestAnimationFrame(frame);
  }

  $("restart").addEventListener("click", reset);
  $("play-again").addEventListener("click", reset);

  build();
  const scroller = $("scroller");
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  requestAnimationFrame(frame);
})();
