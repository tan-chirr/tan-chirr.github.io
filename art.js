const hero = document.querySelector(".hero");
const frame = hero.querySelector(".portrait-frame");
const photo = frame.querySelector("img");
const canvas = hero.querySelector(".particle-portrait");
const context = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

const settings = {
  count: 22000, size: 1, spacing: 1, contrast: 1.24, brightness: -.012, gamma: .94,
  opacity: .27, photoOpacity: .35, scale: 1, fadeStart: .85, progress: -1, view: "hybrid",
};
let grayscalePhoto;

function makeGrayscalePhoto() {
  const image = document.createElement("canvas");
  image.width = 800;
  image.height = Math.round(image.width * photo.naturalHeight / photo.naturalWidth);
  const paint = image.getContext("2d");
  paint.filter = "grayscale(1)";
  paint.drawImage(photo, 0, 0, image.width, image.height);
  const pixels = paint.getImageData(0, 0, image.width, image.height);
  // The supplied illustration already fades into a near-white background.
  // Convert those paper tones to transparency without tracing a new outline.
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luminance = pixels.data[i] / 255;
    pixels.data[i + 3] = Math.round(pixels.data[i + 3] * clamp((.955 - luminance) / .067));
  }
  paint.putImageData(pixels, 0, 0);
  return image;
}

const debugEnabled = new URLSearchParams(location.search).has("portrait-debug");
const palette = ["#A09C94", "#5C5953", "#302E2A", "#171614"];
const particleCache = new Map();

function makeGlyphAtlas() {
  const atlas = document.createElement("canvas");
  atlas.width = 96;
  atlas.height = 48;
  const glyphs = atlas.getContext("2d");
  glyphs.font = "bold 10px monospace";
  glyphs.textAlign = "center";
  glyphs.textBaseline = "middle";
  palette.forEach((ink, shade) => {
    glyphs.fillStyle = ink;
    for (let digit = 0; digit < 2; digit++) {
      glyphs.fillText(String(digit), digit * 48 + 24, shade * 12 + 6);
    }
  });
  return atlas;
}
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);
let randomState = 521;

function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}

function samplePortrait(columns, compact) {
  const cacheKey = columns + ':' + compact;
  if (particleCache.has(cacheKey)) return particleCache.get(cacheKey);

  const rows = Math.round(columns * grayscalePhoto.height / grayscalePhoto.width);
  const sample = document.createElement("canvas");
  sample.width = columns;
  sample.height = rows;
  const pixels = sample.getContext("2d", { willReadFrequently: true });
  pixels.drawImage(grayscalePhoto, 0, 0, columns, rows);
  const { data } = pixels.getImageData(0, 0, columns, rows);



  const luminance = new Float32Array(columns * rows);
  for (let i = 0; i < luminance.length; i++) {
    const offset = i * 4;
    luminance[i] = (data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722) / 255;
  }

  randomState = 521;
  const particles = [];
  const detailRadius = Math.max(2, Math.round(columns * .027));
  const faceCandidates = [];
  for (let row = 0; row < rows; row++) {
    const shoulderFade = ease(clamp((1 - (row + .5) / rows) / (1 - settings.fadeStart)));
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      const index = i * 4;
      const coverage = data[index + 3] / 255;
      if (!coverage) continue;

      const gray = luminance[i];
      let localSum = gray;
      let localCount = 1;
      for (const offset of [-detailRadius, detailRadius]) {
        const horizontal = i + offset;
        const vertical = i + offset * columns;
        if (column + offset >= 0 && column + offset < columns && data[horizontal * 4 + 3] > 230) {
          localSum += luminance[horizontal];
          localCount++;
        }
        if (vertical >= 0 && vertical < luminance.length && data[vertical * 4 + 3] > 230) {
          localSum += luminance[vertical];
          localCount++;
        }
      }

      const detail = gray - localSum / localCount;
      // Compress the ends of the range so hair texture and skin highlights survive.
      const adjusted = (gray - .52) * settings.contrast + .52 + settings.brightness + detail * .88;
      const tone = .045 + .91 * clamp(adjusted) ** settings.gamma;

      const ink = 1 - tone;
      const face = row / rows > .18 && row / rows < .76 && column / columns > .22 && column / columns < .78;
      const density = clamp((face ? .35 : .20) + ink * .70 + Math.abs(detail) * 2.4);
      if (random() > density * coverage * shoulderFade) continue;

      const originalX = (column + .5 + (random() - .5) * .10) / columns;
      const originalY = (row + .5 + (random() - .5) * .10) / rows;
      const particle = {
        originalX, originalY,
        x: originalX, y: originalY,
        targetX: 0, targetY: 0,
        dx: (random() - .5) * 2,
        dy: (random() - .5) * 2,
        curl: random() - .5,
        digit: Number(random() >= .5),
        shade: Math.min(3, Math.floor(ink * 4)),
        size: 3.15 + ink * 1.15,
        opacity: (settings.opacity + (1 - settings.opacity) * ink ** .7) * coverage * shoulderFade,
        delay: random() * .26,
      };
      faceCandidates.push({ particle, priority: random() ** (1 + ink + Number(face) + Math.abs(detail) * 3) });
    }
  }

  const limit = Math.round(settings.count * (compact ? .45 : 1));
  faceCandidates.sort((a, b) => b.priority - a.priority);
  for (const { particle } of faceCandidates.slice(0, limit)) particles.push(particle);
  particleCache.set(cacheKey, particles);
  return particles;
}

function startPortrait() {
  if (!context || !photo.naturalWidth) return;
  grayscalePhoto = makeGrayscalePhoto();

  let particles;
  const fadedPhoto = document.createElement("canvas");
  fadedPhoto.width = grayscalePhoto.width;
  fadedPhoto.height = grayscalePhoto.height;
  const photoContext = fadedPhoto.getContext("2d");
  let lastFadeStart;

  const atlas = makeGlyphAtlas();
  let layout;
  let frameId = 0;
  let lastScroll = NaN;
  let layoutDirty = true;
  const gpuCanvas = document.createElement("canvas");
  gpuCanvas.className = canvas.className;
  gpuCanvas.setAttribute("aria-hidden", "true");
  gpuCanvas.hidden = true;
  canvas.after(gpuCanvas);
  let gpu = null;
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let gpuAttempted = false;
  let lastDraw = 0;

  function useStaticPortrait() {
    gpu?.dispose();
    gpu = null;
    gpuCanvas.hidden = true;
  }

  function prepareGpu() {
    if (gpuAttempted || reducedMotion.matches || !window.createPortrait3D) return;
    gpuAttempted = true;
    try {
      gpu = window.createPortrait3D(gpuCanvas, atlas);
    } catch (error) {
      console.warn("Using the static binary portrait.", error);
      useStaticPortrait();
    }
  }

  function measure() {
    const bounds = hero.getBoundingClientRect();
    const subject = frame.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const compact = subject.width <= 360;
    const columns = Math.round((compact ? 132 : 199) / settings.spacing);
    particles = samplePortrait(columns, compact);
    if (lastFadeStart !== settings.fadeStart) {
      const height = fadedPhoto.height;
      photoContext.globalCompositeOperation = "source-over";
      photoContext.clearRect(0, 0, fadedPhoto.width, height);
      photoContext.drawImage(grayscalePhoto, 0, 0);
      const fade = photoContext.createLinearGradient(0, height * settings.fadeStart, 0, height);
      fade.addColorStop(0, "#000");
      fade.addColorStop(1, "#0000");
      photoContext.globalCompositeOperation = "destination-in";
      photoContext.fillStyle = fade;
      photoContext.fillRect(0, 0, fadedPhoto.width, height);
      lastFadeStart = settings.fadeStart;
    }
    layout = {
      width: bounds.width, height: bounds.height, compact,
      x: subject.left - bounds.left + subject.width * (1 - settings.scale) / 2, y: subject.top - bounds.top,
      subjectWidth: subject.width * settings.scale, subjectHeight: subject.height * settings.scale,
      pageTop: bounds.top + scrollY,
      distance: Math.min(innerHeight * .58, subject.height * .92),
    };
    canvas.width = Math.round(layout.width * ratio);
    canvas.height = Math.round(layout.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = getComputedStyle(hero).getPropertyValue("--ink").trim();
    for (const particle of particles) {
      const x = layout.x + particle.originalX * layout.subjectWidth;
      const y = layout.y + particle.originalY * layout.subjectHeight;
      particle.targetX = Math.max(3, Math.min(layout.width - 3, x + particle.dx * layout.width * .39));
      particle.targetY = Math.max(3, Math.min(layout.height - 3, y + particle.dy * subject.height * .55 + layout.distance * .52));
    }
    prepareGpu();
    gpu?.update(layout, particles, ratio);
    layoutDirty = false;
  }

  function draw(now = performance.now()) {
    frameId = 0;
    const redraw = layoutDirty;
    if (redraw) measure();

    const animated = Boolean(gpu) && !reducedMotion.matches && settings.view !== "original";
    const scroll = animated ? scrollY : 0;
    const visible = !document.hidden && scrollY < layout.pageTop + layout.height;
    const blend = 1 - Math.exp(-Math.min(50, now - lastDraw) / 90);
    lastDraw = now;
    yaw = animated ? yaw + (targetYaw - yaw) * blend : 0;
    pitch = animated ? pitch + (targetPitch - pitch) * blend : 0;
    if (Math.abs(targetYaw - yaw) < .0004) yaw = animated ? targetYaw : 0;
    if (Math.abs(targetPitch - pitch) < .0004) pitch = animated ? targetPitch : 0;
    if (!redraw && (!animated || !visible) && lastScroll === scroll) return;
    lastScroll = scroll;

    const progress = !animated ? 0 : settings.progress >= 0 ? settings.progress : clamp((scroll - Math.max(0, layout.pageTop - 64)) / layout.distance);
    const size = settings.size * layout.subjectWidth / (layout.compact ? 310 : 480);
    const idle = animated && visible ? Math.sin(now / 2300) * 1.18 : 0;
    const useGpu = animated;
    gpuCanvas.hidden = !useGpu;
    context.clearRect(0, 0, layout.width, layout.height);
    if (settings.view === "original" || settings.view === "hybrid") {
      const original = settings.view === "original";
      const photoFade = 1 - ease(clamp(progress / .20));
      const turnFade = 1 - .36 * clamp(Math.hypot(yaw, pitch) / .20);
      context.globalAlpha = original ? 1 : settings.photoOpacity * photoFade * turnFade;
      if (context.globalAlpha > 0) {
        context.drawImage(original ? grayscalePhoto : fadedPhoto, layout.x, layout.y + idle * -.7, layout.subjectWidth, layout.subjectHeight);
      }
      if (original) return;
    }

    if (useGpu) {
      gpu.render(progress, yaw, pitch, idle, size);
      if (visible) queueDraw();
      return;
    }

    for (const particle of particles) {
      const x = layout.x + particle.originalX * layout.subjectWidth;
      const y = layout.y + particle.originalY * layout.subjectHeight;
      const glyphSize = particle.size * size;
      context.globalAlpha = particle.opacity;
      context.drawImage(atlas, particle.digit * 48 + 18, particle.shade * 12, 12, 12,
        x - glyphSize / 2, y - glyphSize / 2, glyphSize, glyphSize);
    }
  }

  function queueDraw() {
    if (!frameId) frameId = requestAnimationFrame(draw);
  }

  function resize() {
    layoutDirty = true;
    queueDraw();
  }

  function movePointer(event) {
    if (!gpu || event.pointerType !== "mouse" || !finePointer.matches || reducedMotion.matches) return;
    const bounds = frame.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      clearPointer();
      return;
    }
    targetYaw = (x - .5) * 2 * Math.PI / 18;
    targetPitch = (y - .5) * 2 * Math.PI / 30;
    queueDraw();
  }

  function clearPointer() {
    targetYaw = 0;
    targetPitch = 0;
    queueDraw();
  }

  const observer = new ResizeObserver(resize);
  const listeners = new AbortController();
  const options = { passive: true, signal: listeners.signal };
  function connect() {
    observer.observe(hero);
    observer.observe(frame);
    resize();
  }

  addEventListener("scroll", queueDraw, options);
  addEventListener("resize", resize, options);
  reducedMotion.addEventListener("change", resize, options);
  hero.addEventListener("pointermove", movePointer, options);
  hero.addEventListener("pointerleave", clearPointer, options);
  document.addEventListener("visibilitychange", queueDraw, options);
  gpuCanvas.addEventListener("webglcontextlost", () => {
    useStaticPortrait();
    resize();
  }, options);
  addEventListener("pageshow", connect, options);
  addEventListener("pagehide", event => {
    observer.disconnect();
    cancelAnimationFrame(frameId);
    frameId = 0;
    targetYaw = targetPitch = yaw = pitch = 0;
    if (!event.persisted) {
      useStaticPortrait();
      listeners.abort();
    }
  }, options);

  if (debugEnabled) {
    const panel = document.createElement("details");
    panel.open = true;
    panel.style.cssText = "position:fixed;z-index:10;inset:auto 1rem 1rem auto;max-width:calc(100vw - 2rem);background:#f3f0e8;border:1px solid;padding:.75rem;font:14px system-ui";
    const title = document.createElement("summary");
    title.textContent = "Portrait tuning";
    panel.append(title);

    const controls = [
      ["count", "Character density (desktop maximum)", 1000, 28000, 500],
      ["size", "Binary font size", .5, 1.8, .05],
      ["spacing", "Character spacing", .7, 1.5, .05],
      ["photoOpacity", "Photographic opacity", 0, .7, .01],
      ["scale", "Portrait scale", .75, 1.25, .01],
      ["fadeStart", "Shoulder fade start", .65, .98, .01],
      ["contrast", "Contrast", .6, 2.2, .05],
      ["brightness", "Brightness", -.25, .2, .005],
      ["gamma", "Gamma", .5, 1.5, .02],
      ["opacity", "Minimum character opacity", 0, .8, .025],
      ["progress", "Dispersion (−1 uses scroll)", -1, 1, .01],
    ];
    for (const [key, name, min, max, step] of controls) {
      const label = document.createElement("label");
      label.style.display = "block";
      const output = document.createElement("output");
      output.value = settings[key];
      const input = document.createElement("input");
      Object.assign(input, { type: "range", min, max, step, value: settings[key] });
      label.append(name + " ", input, " ", output);
      input.addEventListener("input", () => {
        output.value = input.value;
        settings[key] = Number(input.value);
        if (["count", "contrast", "brightness", "gamma", "opacity", "fadeStart"].includes(key)) particleCache.clear();
        resize();
      });
      panel.append(label);
    }

    const label = document.createElement("label");
    label.append("Preview ");
    const select = document.createElement("select");
    for (const [value, name] of [["hybrid", "Hybrid portrait"], ["particles", "Pure binary"], ["original", "Original grayscale"]]) {
      select.add(new Option(name, value));
    }
    select.addEventListener("change", () => {
      settings.view = select.value;
      resize();
    });
    label.append(select);
    panel.append(label);
    document.body.append(panel);
  }
  draw();
  canvas.hidden = false;
  frame.classList.add("is-stippled");
  connect();
}

if (photo.complete) {
  startPortrait();
} else {
  photo.addEventListener("load", startPortrait, { once: true });
}
