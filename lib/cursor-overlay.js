(() => {
  if (window.__autotutorialCursorInstalled) return;
  window.__autotutorialCursorInstalled = true;

  const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
  const MAX_EVENTS = 50000;
  let overlay = null;
  let animation = null;
  let current = { x: 0, y: 0 };
  let visible = false;
  let recording = true;
  let replaying = false;
  let recordedEvents = [];
  let pendingPointer = null;
  let pointerFrame = 0;

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;
    if (!document.documentElement) return null;

    const style = document.createElement("style");
    style.id = "autotutorial-cursor-styles";
    style.textContent = `
      html.autotutorial-virtual-cursor,
      html.autotutorial-virtual-cursor * { cursor: none !important; }
      #autotutorial-cursor-overlay {
        position: fixed;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        pointer-events: none !important;
        z-index: 99999;
        opacity: 0;
        transform: translate3d(0, 0, 0);
        will-change: transform;
      }
      #autotutorial-cursor-overlay.is-visible { opacity: 1; }
      #autotutorial-cursor-overlay svg {
        position: absolute;
        left: -2px;
        top: -2px;
        width: 32px;
        height: 32px;
        overflow: visible;
      }
      .autotutorial-cursor-ripple {
        position: absolute;
        left: -10px;
        top: -10px;
        width: 20px;
        height: 20px;
        border: 2px solid rgba(99, 102, 241, 0.95);
        border-radius: 999px;
        background: rgba(99, 102, 241, 0.16);
        box-shadow: 0 0 0 1px rgba(255,255,255,.75);
        transform: scale(.25);
        transform-origin: center;
        animation: autotutorial-cursor-ripple 620ms cubic-bezier(.16,1,.3,1) forwards;
      }
      @keyframes autotutorial-cursor-ripple {
        0% { opacity: .95; transform: scale(.25); }
        55% { opacity: .55; }
        100% { opacity: 0; transform: scale(3.2); }
      }
    `;
    document.documentElement.appendChild(style);
    document.documentElement.classList.add("autotutorial-virtual-cursor");

    overlay = document.createElement("div");
    overlay.id = "autotutorial-cursor-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <svg viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="autotutorial-cursor-shadow" x="-70%" y="-50%" width="260%" height="260%">
            <feDropShadow dx="1.5" dy="2.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.48"/>
          </filter>
        </defs>
        <path
          d="M3 2.5v24.2l6.2-5.7 4.4 10.7 5.2-2.2-4.5-10.4 8.5-.2L3 2.5Z"
          fill="#171A21"
          stroke="#FFFFFF"
          stroke-width="2.2"
          stroke-linejoin="round"
          filter="url(#autotutorial-cursor-shadow)"
        />
      </svg>
    `;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function clampPoint(x, y) {
    return {
      x: Math.max(0, Math.min(innerWidth - 1, Number(x) || 0)),
      y: Math.max(0, Math.min(innerHeight - 1, Number(y) || 0)),
    };
  }

  function renderedPosition() {
    if (!overlay?.isConnected || !visible) return current;
    const rect = overlay.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  function transform(point) {
    return `translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, 0)`;
  }

  function addRecordedEvent(type, point, timestamp = Date.now()) {
    if (!recording || replaying) return;
    recordedEvents.push({
      x: Math.round(point.x * 100) / 100,
      y: Math.round(point.y * 100) / 100,
      timestamp: Number(timestamp),
      type,
    });
    if (recordedEvents.length > MAX_EVENTS)
      recordedEvents.splice(0, recordedEvents.length - MAX_EVENTS);
  }

  function moveTo(x, y, options = {}) {
    const node = ensureOverlay();
    const destination = clampPoint(x, y);
    if (!node) {
      current = destination;
      return Promise.resolve(destination);
    }
    const start = renderedPosition();
    const distance = Math.hypot(destination.x - start.x, destination.y - start.y);
    const duration = Math.max(
      0,
      Number.isFinite(Number(options.duration))
        ? Number(options.duration)
        : Math.min(680, Math.max(90, distance * 1.15)),
    );
    const easing = options.easing || EASING;
    const curved = options.curve !== false && duration > 100 && distance > 24;
    const frames = [{ transform: transform(start) }];
    if (curved) {
      const direction = (Math.round(start.x + destination.y) & 1) ? 1 : -1;
      const bend = Math.min(34, distance * 0.085) * direction;
      const dx = destination.x - start.x;
      const dy = destination.y - start.y;
      const length = Math.max(1, distance);
      frames.push({
        offset: 0.52,
        transform: transform({
          x: start.x + dx * 0.52 + (-dy / length) * bend,
          y: start.y + dy * 0.52 + (dx / length) * bend,
        }),
      });
    }
    frames.push({ transform: transform(destination) });
    animation?.cancel();
    current = destination;
    node.classList.add("is-visible");
    visible = true;
    node.style.transform = transform(destination);
    if (!duration) return Promise.resolve(destination);
    animation = node.animate(frames, {
      duration,
      easing,
      fill: "both",
    });
    return animation.finished
      .catch(() => undefined)
      .then(() => destination);
  }

  function pulse() {
    const node = ensureOverlay();
    if (!node) return;
    const ripple = document.createElement("span");
    ripple.className = "autotutorial-cursor-ripple";
    node.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), {
      once: true,
    });
    setTimeout(() => ripple.remove(), 900);
  }

  async function clickAt(selector, options = {}) {
    const element =
      typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!(element instanceof Element))
      throw new Error(`Cursor target not found: ${String(selector)}`);
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    await moveTo(point.x, point.y, options);
    pulse();
    addRecordedEvent("click", point);
    if (options.performClick !== false && element instanceof HTMLElement)
      element.click();
    return element;
  }

  function startRecording(options = {}) {
    if (options.reset !== false) recordedEvents = [];
    recording = true;
    return api;
  }

  function stopRecording() {
    recording = false;
    return recordedEvents.map((event) => ({ ...event }));
  }

  function getRecording() {
    return recordedEvents.map((event) => ({ ...event }));
  }

  async function replay(events = recordedEvents, options = {}) {
    const points = Array.from(events || [])
      .map((event) => ({
        x: Number(event.x),
        y: Number(event.y),
        timestamp: Number(event.timestamp ?? event.ts),
        type: String(event.type || "move"),
      }))
      .filter(
        (event) =>
          Number.isFinite(event.x) &&
          Number.isFinite(event.y) &&
          Number.isFinite(event.timestamp),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!points.length) return;
    const speed = Math.max(0.1, Number(options.speed) || 1);
    replaying = true;
    try {
      await moveTo(points[0].x, points[0].y, { duration: 0, curve: false });
      if (points[0].type === "click") pulse();
      for (let index = 1; index < points.length; index++) {
        const previous = points[index - 1];
        const event = points[index];
        const delay = Math.max(0, (event.timestamp - previous.timestamp) / speed);
        if (event.type === "move") {
          await moveTo(event.x, event.y, {
            duration: delay,
            easing: EASING,
            curve: false,
          });
        } else {
          if (delay)
            await new Promise((resolve) => setTimeout(resolve, delay));
          await moveTo(event.x, event.y, { duration: 70, curve: false });
          pulse();
        }
      }
    } finally {
      replaying = false;
    }
  }

  function show() {
    const node = ensureOverlay();
    if (node) {
      visible = true;
      node.classList.add("is-visible");
    }
  }

  function hide() {
    visible = false;
    overlay?.classList.remove("is-visible");
  }

  function destroy() {
    animation?.cancel();
    overlay?.remove();
    document.getElementById("autotutorial-cursor-styles")?.remove();
    document.documentElement?.classList.remove("autotutorial-virtual-cursor");
    overlay = null;
    visible = false;
  }

  const api = {
    moveTo,
    clickAt,
    replay,
    pulse,
    show,
    hide,
    destroy,
    startRecording,
    stopRecording,
    getRecording,
  };

  Object.defineProperty(window, "cursor", {
    configurable: true,
    value: api,
  });
  window.__autotutorialCursor = api;

  document.addEventListener(
    "pointermove",
    (event) => {
      if (replaying) return;
      pendingPointer = { x: event.clientX, y: event.clientY };
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        if (!pendingPointer) return;
        const point = pendingPointer;
        pendingPointer = null;
        moveTo(point.x, point.y, {
          duration: 58,
          easing: EASING,
          curve: false,
        });
        addRecordedEvent("move", point);
      });
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (replaying || event.button !== 0) return;
      const point = clampPoint(event.clientX, event.clientY);
      moveTo(point.x, point.y, { duration: 0, curve: false });
      pulse();
      addRecordedEvent("click", point);
    },
    true,
  );

  ensureOverlay();
})();
