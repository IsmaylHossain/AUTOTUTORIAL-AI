(() => {
  const safe = (v) => (typeof v === "string" ? v.slice(0, 500) : v);
  const cssPath = (el) => {
    if (!(el instanceof Element)) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let n = el;
    for (let i = 0; i < 6 && n && n.nodeType === 1; i++, n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.classList.length)
        p +=
          "." + Array.from(n.classList).slice(0, 2).map(CSS.escape).join(".");
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  const isSensitive = (el) => {
    if (!el) return false;
    if ((el.type || "").toLowerCase() === "email") return false;
    const name =
      `${el.name || ""} ${el.id || ""} ${el.getAttribute?.("autocomplete") || ""} ${el.getAttribute?.("aria-label") || ""}`.toLowerCase();
    return (
      el.type === "password" ||
      /password|passcode|token|secret|api[_ -]?key|credit.?card|cvv|ssn|authorization/.test(
        name,
      )
    );
  };
  const isTextEntryElement = (el) => {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName?.toLowerCase?.() || "";
    if (tag === "textarea") return true;
    if (tag !== "input") return false;
    const type = (el.type || "").toLowerCase();
    return [
      "text",
      "search",
      "email",
      "url",
      "tel",
      "number",
      "password",
      "date",
      "time",
      "datetime-local",
      "month",
      "week",
    ].includes(type);
  };
  const isMeaningfulClick = (el) => {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName?.toLowerCase?.() || "";
    if (tag === "label" && el.control) return false;
    if (tag === "input") {
      const type = (el.type || "").toLowerCase();
      return ["button", "submit", "reset", "range"].includes(type);
    }
    if (tag === "textarea") return false;
    if (tag === "select") return false;
    return true;
  };
  const rect = (el) => {
    if (!(el instanceof Element)) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const fieldLabel = (el) => {
    const label =
      el.labels?.[0]?.innerText ||
      el.getAttribute?.("aria-label") ||
      el.getAttribute?.("placeholder") ||
      el.name ||
      el.id;
    return String(label || "text field")
      .trim()
      .slice(0, 100);
  };
  const fieldKind = (el) => {
    const tag = el?.tagName?.toLowerCase?.() || "control";
    return tag === "input" ? (el.type || "text").toLowerCase() : tag;
  };
  const emit = (action) =>
    console.log(
      "AUTOTUTORIAL_ACTION:" +
        JSON.stringify({
          ...action,
          url: location.href,
          title: document.title,
          ts: Date.now(),
        }),
    );
  const emitCapture = (capture) =>
    console.log(
      "AUTOTUTORIAL_CAPTURE:" +
        JSON.stringify({
          ...capture,
          ts: Date.now(),
        }),
    );
  const loadingBadge = document.createElement("div");
  loadingBadge.id = "autotutorial-loading-badge";
  loadingBadge.setAttribute("role", "status");
  loadingBadge.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;background:rgba(17,21,26,.94);border:1px solid rgba(255,255,255,.14);color:#fff;font:600 12px/1.2 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none";
  loadingBadge.textContent = "AutoTutorial AI · Loading website…";
  if (document.documentElement) {
    document.documentElement.appendChild(loadingBadge);
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (!window.__autotutorialStarted)
          document.documentElement.appendChild(loadingBadge);
      },
      { once: true },
    );
  }
  window.__autotutorialBeginCapture = () => {
    loadingBadge.textContent = "AutoTutorial AI · Recording started";
    loadingBadge.style.background = "rgba(44, 87, 71, .96)";
    window.__autotutorialStart();
  };
  window.__autotutorialStart = () => {
    if (window.__autotutorialStarted) return;
    window.__autotutorialStarted = true;
    loadingBadge.remove();
    const completedTextFields = new WeakSet();
    const textFieldTimers = new Map();
    let captureSequence = 0;
    let pendingPointerCapture = null;
    const captureTokenFor = (el) => {
      const pending = pendingPointerCapture;
      if (!pending || Date.now() - pending.createdAt > 10000) return undefined;
      if (
        pending.target === el ||
        pending.target?.contains?.(el) ||
        el?.contains?.(pending.target)
      )
        return pending.token;
      return undefined;
    };
    const clearPointerCapture = (token) => {
      if (token && pendingPointerCapture?.token === token)
        pendingPointerCapture = null;
    };
    const completeTextField = (el) => {
      const timer = textFieldTimers.get(el);
      if (timer) clearTimeout(timer);
      textFieldTimers.delete(el);
      if (
        !isTextEntryElement(el) ||
        completedTextFields.has(el) ||
        !String(el.value || "").trim()
      )
        return;
      completedTextFields.add(el);
      emit({
        type: "input",
        selector: cssPath(el),
        fieldLabel: fieldLabel(el),
        fieldKind: fieldKind(el),
        sensitive: isSensitive(el),
        targetRect: rect(el),
      });
    };
    document.addEventListener(
      "focusin",
      (e) => {
        if (isTextEntryElement(e.target)) completedTextFields.delete(e.target);
      },
      true,
    );
    document.addEventListener(
      "input",
      (e) => {
        const el = e.target;
        if (!isTextEntryElement(el)) return;
        const timer = textFieldTimers.get(el);
        if (timer) clearTimeout(timer);
        textFieldTimers.set(
          el,
          setTimeout(() => completeTextField(el), 800),
        );
      },
      true,
    );
    document.addEventListener(
      "focusout",
      (e) => completeTextField(e.target),
      true,
    );
    document.addEventListener(
      "submit",
      (e) =>
        completeTextField(
          e.target?.querySelector?.("input:focus,textarea:focus"),
        ),
      true,
    );
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        const el = e.target;
        if (!(el instanceof Element) || isTextEntryElement(el)) return;
        const tag = el.tagName?.toLowerCase?.() || "";
        const type = (el.type || "").toLowerCase();
        const mayProduceAction =
          isMeaningfulClick(el) ||
          tag === "select" ||
          tag === "option" ||
          ["checkbox", "radio", "range", "file"].includes(type) ||
          (tag === "label" && !!el.control);
        if (!mayProduceAction) return;
        const token = `${Date.now()}-${++captureSequence}`;
        pendingPointerCapture = { token, target: el, createdAt: Date.now() };
        emitCapture({ token });
      },
      true,
    );
    document.addEventListener(
      "click",
      (e) => {
        const el = e.target;
        if (!isMeaningfulClick(el)) return;
        const captureToken = captureTokenFor(el);
        const value = safe(
          el?.innerText || el?.getAttribute?.("aria-label") || el?.value || "",
        );
        emit({
          type: "click",
          selector: cssPath(el),
          text: value,
          x: e.clientX,
          y: e.clientY,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          targetRect: rect(el),
          sensitive: isSensitive(el),
          captureToken,
        });
        clearPointerCapture(captureToken);
      },
      true,
    );
    document.addEventListener(
      "change",
      (e) => {
        const el = e.target;
        if (!(el instanceof Element) || isTextEntryElement(el)) return;
        const tag = (el.tagName || "").toLowerCase();
        const type = (el.type || "").toLowerCase();
        const captureToken = captureTokenFor(el);
        if (tag === "select") {
          emit({
            type: "select",
            selector: cssPath(el),
            fieldLabel: fieldLabel(el),
            fieldKind: fieldKind(el),
            targetRect: rect(el),
            captureToken,
          });
        } else if (["checkbox", "radio", "range", "file"].includes(type)) {
          emit({
            type: "change",
            selector: cssPath(el),
            fieldLabel: fieldLabel(el),
            fieldKind: fieldKind(el),
            targetRect: rect(el),
            captureToken,
          });
        }
        clearPointerCapture(captureToken);
      },
      true,
    );
    let lastScroll = 0;
    window.addEventListener(
      "scroll",
      () => {
        const now = Date.now();
        if (now - lastScroll < 300) return;
        lastScroll = now;
        emit({ type: "scroll", x: scrollX, y: scrollY });
      },
      { passive: true },
    );
    let lastMove = 0;
    document.addEventListener(
      "mousemove",
      (e) => {
        const now = Date.now();
        if (now - lastMove < 180) return;
        lastMove = now;
        emit({
          type: "move",
          x: e.clientX,
          y: e.clientY,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        });
      },
      true,
    );
  };
  try {
    window.__autotutorialStart();
  } catch {}
})();
