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
    ].includes(type);
  };
  const isNativePicker = (el) => {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName?.toLowerCase?.() || "";
    if (tag === "select" || tag === "option") return true;
    return (
      tag === "input" &&
      ["date", "time", "datetime-local", "month", "week", "color"].includes(
        (el.type || "").toLowerCase(),
      )
    ) || isDatePickerControl(el);
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
  const actionableElement = (el) => {
    if (!(el instanceof Element)) return el;
    return (
      el.closest?.(
        'button,a[href],input,select,textarea,label,li,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="checkbox"],[role="radio"],[role="combobox"]',
      ) || el
    );
  };
  const controlRole = (el) => {
    if (!(el instanceof Element)) return "control";
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const type = tag === "input" ? (el.type || "text").toLowerCase() : "";
    return role || type || tag;
  };
  const controlLabel = (el) => {
    if (!(el instanceof Element)) return "";
    const labelledBy = el.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText || "")
          .join(" ")
      : "";
    return String(
      el.getAttribute("aria-label") ||
        labelledText ||
        el.getAttribute("title") ||
        el.innerText ||
        el.value ||
        "",
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  };
  const rect = (el) => {
    if (!(el instanceof Element)) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const focusedFieldRect = (el) => {
    if (!(el instanceof Element)) return null;
    const inputRect = el.getBoundingClientRect();
    let best = inputRect;
    let candidate = el;
    for (let depth = 0; depth < 4 && candidate; depth++) {
      const candidateRect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      const borderWidth =
        parseFloat(style.borderTopWidth || "0") +
        parseFloat(style.borderRightWidth || "0") +
        parseFloat(style.borderBottomWidth || "0") +
        parseFloat(style.borderLeftWidth || "0");
      const className =
        typeof candidate.className === "string" ? candidate.className : "";
      const hasFocusBoundary =
        borderWidth > 0 ||
        (style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth || "0") > 0) ||
        style.boxShadow !== "none" ||
        /(^|[\s_-])(input|textarea|field|form-control)([\s_-]|$)/i.test(
          className,
        ) ||
        candidate.getAttribute?.("role") === "textbox";
      const containsInput =
        candidateRect.left <= inputRect.left + 1 &&
        candidateRect.top <= inputRect.top + 1 &&
        candidateRect.right >= inputRect.right - 1 &&
        candidateRect.bottom >= inputRect.bottom - 1;
      const fieldSized =
        candidateRect.width <= Math.max(inputRect.width * 1.2, inputRect.width + 96) &&
        candidateRect.height <= inputRect.height + 24;
      if (
        hasFocusBoundary &&
        containsInput &&
        fieldSized &&
        candidateRect.width * candidateRect.height >= best.width * best.height
      )
        best = candidateRect;
      candidate = candidate.parentElement;
    }
    return { x: best.x, y: best.y, width: best.width, height: best.height };
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
  const isDatePickerControl = (el) => {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName?.toLowerCase?.() || "";
    const role = el.getAttribute?.("role") || "";
    if (!["input", "button"].includes(tag) && !["combobox", "button"].includes(role))
      return false;
    const type = String(el.type || "").toLowerCase();
    if (["date", "time", "datetime-local", "month", "week"].includes(type))
      return true;
    const container = el.closest?.(
      '[class*="datepicker" i],[class*="date-picker" i],[class*="calendar" i],[class*="dp--"],[class*="dp__"]',
    );
    const nearbyInput = container?.querySelector?.("input");
    const hint = [
      el.getAttribute?.("name"),
      el.id,
      el.getAttribute?.("placeholder"),
      el.getAttribute?.("aria-label"),
      typeof el.className === "string" ? el.className : "",
      fieldLabel(el),
      el.parentElement?.getAttribute?.("class"),
      container?.getAttribute?.("class"),
      nearbyInput?.getAttribute?.("name"),
      nearbyInput?.getAttribute?.("placeholder"),
      nearbyInput?.getAttribute?.("aria-label"),
    ]
      .filter(Boolean)
      .join(" ");
    return /date|calendar|datepicker|date-picker|dp[-_]/i.test(hint);
  };
  const isCalendarOption = (el) => {
    if (!(el instanceof Element)) return false;
    const candidate =
      el.closest?.(
        '[role="gridcell"],[class*="calendar-item"],[class*="calendar_item"],[class*="cell-inner"],[class*="cell_inner"],[class*="datepicker-day"],[class*="date-picker-day"]',
      ) || el;
    const hint = [
      candidate.getAttribute?.("role"),
      candidate.getAttribute?.("aria-label"),
      typeof candidate.className === "string" ? candidate.className : "",
      typeof candidate.parentElement?.className === "string"
        ? candidate.parentElement.className
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return /gridcell|calendar|datepicker|date-picker|dp[-_].*(cell|day)|(cell|day).*dp[-_]/i.test(
      hint,
    );
  };
  const focusedFieldLabel = () => {
    const el = document.activeElement;
    if (!(el instanceof Element) || el === document.body) return "";
    const label =
      el.labels?.[0]?.innerText ||
      el.getAttribute?.("aria-label") ||
      el.getAttribute?.("placeholder") ||
      el.getAttribute?.("name") ||
      "";
    return String(label).replace(/\s+/g, " ").trim().slice(0, 100);
  };
  const eventElement = (event) => {
    const target = event
      ?.composedPath?.()
      ?.find?.((node) => node instanceof Element);
    return target || event?.target;
  };
  const isCookieConsentControl = (el) => {
    if (!(el instanceof Element)) return false;
    const control =
      el.closest?.(
        'button,a,[role="button"],input[type="button"],input[type="submit"]',
      ) || el;
    const controlText = [
      control.innerText,
      control.value,
      control.getAttribute?.("aria-label"),
      control.id,
      control.getAttribute?.("name"),
      typeof control.className === "string" ? control.className : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const container = control.closest?.(
      '[role="dialog"],[aria-modal="true"],[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]',
    );
    const contextText = [
      container?.innerText,
      container?.getAttribute?.("aria-label"),
      container?.id,
      typeof container?.className === "string" ? container.className : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (
      /accept\s*(all|cookies?)|allow\s*(all|cookies?)|agree|consent/.test(
        controlText,
      ) &&
      (/cookie|consent|privacy|tracking/.test(contextText) ||
        /accept\s*(all|cookies?)|allow\s*(all|cookies?)/.test(controlText))
    );
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
    const textFieldFocusTimes = new WeakMap();
    const textFieldFocusRects = new WeakMap();
    let captureSequence = 0;
    let pendingPointerCapture = null;
    let capturePaused = false;
    const emitWindowState = (state) =>
      console.log(
        "AUTOTUTORIAL_WINDOW:" +
          JSON.stringify({ state, ts: Date.now(), url: location.href }),
      );
    window.addEventListener("focus", () => emitWindowState("focus"));
    window.addEventListener("blur", () => emitWindowState("blur"));
    if (document.hasFocus()) emitWindowState("focus");
    const shouldDeferClick = (el) =>
      !isCookieConsentControl(el) &&
      (isCalendarOption(el) ||
        (!isNativePicker(el) &&
          !!el?.closest?.(
            'button,a[href],[role="button"],[role="menuitem"],[role="option"],[role="tab"],input[type="button"],input[type="submit"],input[type="reset"]',
          )));
    const captureTokenFor = (el) => {
      const pending = pendingPointerCapture;
      if (!pending || Date.now() - pending.createdAt > 120000)
        return undefined;
      if (
        pending.target === el ||
        pending.target?.contains?.(el) ||
        el?.contains?.(pending.target)
      )
        return pending.token;
      return undefined;
    };
    const clearPointerCapture = (token) => {
      if (token && pendingPointerCapture?.token === token) {
        pendingPointerCapture = null;
      }
    };
    window.__autotutorialReleaseCapture = (token) => {
      const pending = pendingPointerCapture;
      if (!pending || pending.token !== token) return;
      if (!pending.defer || pending.replaying) return;
      pending.replaying = true;
      const target = pending.target;
      if (!target?.isConnected) {
        pendingPointerCapture = null;
        return;
      }
      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: pending.x,
          clientY: pending.y,
          button: 0,
        }),
      );
      if (pendingPointerCapture?.token === token)
        pendingPointerCapture = null;
    };
    window.__autotutorialSetPaused = (paused) => {
      capturePaused = !!paused;
      const pending = pendingPointerCapture;
      if (capturePaused && pending?.defer && !pending.replaying)
        window.__autotutorialReleaseCapture(pending.token);
      if (capturePaused) pendingPointerCapture = null;
    };
    const completeTextField = (el) => {
      const timer = textFieldTimers.get(el);
      if (timer) clearTimeout(timer);
      textFieldTimers.delete(el);
      if (
        !isTextEntryElement(el) ||
        isDatePickerControl(el) ||
        completedTextFields.has(el) ||
        !String(el.value || "").trim()
      )
        return;
      completedTextFields.add(el);
      const interactionTs = textFieldFocusTimes.get(el) || Date.now();
      const focusRect = textFieldFocusRects.get(el) || focusedFieldRect(el);
      textFieldFocusTimes.delete(el);
      textFieldFocusRects.delete(el);
      emit({
        type: "input",
        selector: cssPath(el),
        fieldLabel: fieldLabel(el),
        fieldKind: fieldKind(el),
        sensitive: isSensitive(el),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        targetRect: focusedFieldRect(el),
        focusRect,
        interactionTs,
      });
    };
    document.addEventListener(
      "focusin",
      (e) => {
        if (capturePaused) return;
        const el = actionableElement(eventElement(e));
        if (isTextEntryElement(el)) {
          completedTextFields.delete(el);
          textFieldFocusTimes.set(el, Date.now());
          textFieldFocusRects.set(el, focusedFieldRect(el));
        }
      },
      true,
    );
    document.addEventListener(
      "input",
      (e) => {
        if (capturePaused) return;
        const el = actionableElement(eventElement(e));
        if (!isTextEntryElement(el)) return;
        if (isDatePickerControl(el)) {
          const timer = textFieldTimers.get(el);
          if (timer) clearTimeout(timer);
          textFieldTimers.delete(el);
          return;
        }
        if (!textFieldFocusTimes.has(el)) {
          textFieldFocusTimes.set(el, Date.now());
          textFieldFocusRects.set(el, focusedFieldRect(el));
        }
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
      (e) => {
        if (!capturePaused) completeTextField(eventElement(e));
      },
      true,
    );
    document.addEventListener(
      "submit",
      (e) => {
        if (capturePaused) return;
        completeTextField(
          e.target?.querySelector?.("input:focus,textarea:focus"),
        );
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (capturePaused) return;
        if (e.button !== 0) return;
        const el = eventElement(e);
        if (!(el instanceof Element)) return;
        const datePickerControl = isDatePickerControl(el);
        if (isTextEntryElement(el) && !datePickerControl) return;
        const tag = el.tagName?.toLowerCase?.() || "";
        const type = (el.type || "").toLowerCase();
        const mayProduceAction =
          isMeaningfulClick(el) ||
          datePickerControl ||
          isCalendarOption(el) ||
          tag === "select" ||
          tag === "option" ||
          [
            "checkbox",
            "radio",
            "range",
            "file",
            "date",
            "time",
            "datetime-local",
            "month",
            "week",
            "color",
          ].includes(type) ||
          (tag === "label" && !!el.control);
        if (!mayProduceAction) return;
        const token = `${Date.now()}-${++captureSequence}`;
        const defer = shouldDeferClick(el);
        pendingPointerCapture = {
          token,
          target: el,
          createdAt: Date.now(),
          defer,
          replaying: false,
          x: e.clientX,
          y: e.clientY,
        };
        if (defer) {
          e.preventDefault();
          e.stopImmediatePropagation();
          emitCapture({ token });
        } else if (isNativePicker(el)) {
          setTimeout(() => {
            if (pendingPointerCapture?.token !== token) return;
            emitCapture({ token });
          }, 70);
        } else {
          emitCapture({ token });
        }
      },
      true,
    );
    for (const eventName of ["mousedown", "pointerup", "mouseup", "click"]) {
      document.addEventListener(
        eventName,
        (e) => {
          if (capturePaused) return;
          const pending = pendingPointerCapture;
          if (!pending?.defer || pending.replaying) return;
          if (
            pending.target === e.target ||
            pending.target?.contains?.(e.target) ||
            e.target?.contains?.(pending.target)
          ) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        },
        true,
      );
    }
    document.addEventListener(
      "click",
      (e) => {
        if (capturePaused) return;
        const el = actionableElement(eventElement(e));
        const datePickerControl = isDatePickerControl(el);
        if (!isMeaningfulClick(el) && !datePickerControl) return;
        const captureToken = captureTokenFor(el);
        const value = safe(
          controlLabel(el),
        );
        const action = {
          type: "click",
          selector: cssPath(el),
          text: datePickerControl ? fieldLabel(el) : value,
          controlLabel: datePickerControl ? fieldLabel(el) : value,
          controlRole: datePickerControl ? "date-picker" : controlRole(el),
          fieldLabel: datePickerControl ? fieldLabel(el) : undefined,
          fieldKind: datePickerControl ? "date-picker" : undefined,
          pickerOpen: datePickerControl || undefined,
          contextLabel: focusedFieldLabel(),
          x: e.clientX,
          y: e.clientY,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          targetRect: rect(el),
          sensitive: isSensitive(el),
          captureToken,
          interactionTs: pendingPointerCapture?.createdAt || Date.now(),
        };
        if (datePickerControl)
          setTimeout(() => {
            emit(action);
            clearPointerCapture(captureToken);
          }, 170);
        else {
          emit(action);
          clearPointerCapture(captureToken);
        }
      },
      true,
    );
    document.addEventListener(
      "change",
      (e) => {
        if (capturePaused) return;
        const el = eventElement(e);
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
            interactionTs: pendingPointerCapture?.createdAt || Date.now(),
          });
        } else if (
          [
            "checkbox",
            "radio",
            "range",
            "file",
            "date",
            "time",
            "datetime-local",
            "month",
            "week",
            "color",
          ].includes(type)
        ) {
          emit({
            type: "change",
            selector: cssPath(el),
            fieldLabel: fieldLabel(el),
            fieldKind: fieldKind(el),
            targetRect: rect(el),
            captureToken,
            interactionTs: pendingPointerCapture?.createdAt || Date.now(),
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
        if (capturePaused) return;
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
        if (capturePaused) return;
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
