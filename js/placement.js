// Unterschrift auf einer Seite platzieren: verschieben und in der Größe ändern.
//
// Im Editor gilt die angezeigte (gedrehte) Seite: { u, v, fw } = Mitte und Breite als Anteil der Seite.
// Gespeichert wird bezogen auf die ungedrehte Seite: { cx, cy, w, angle } – so dreht die Unterschrift
// mit, wenn die Seite später gedreht wird.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Angezeigte Lage → Lage auf der ungedrehten Seite (Drehung in 90°-Schritten im Uhrzeigersinn). */
export function toPageFrame({ u, v, fw }, rotation, dispW, dispH) {
  const W = rotation % 180 ? dispH : dispW;
  const [cx, cy] =
    rotation === 90 ? [v, 1 - u] :
    rotation === 180 ? [1 - u, 1 - v] :
    rotation === 270 ? [1 - v, u] : [u, v];
  return { cx, cy, w: (fw * dispW) / W, angle: -rotation };
}

/** Lage auf der ungedrehten Seite → angezeigte Lage. */
export function toViewFrame({ cx, cy, w }, rotation, dispW, dispH) {
  const W = rotation % 180 ? dispH : dispW;
  const [u, v] =
    rotation === 90 ? [1 - cy, cx] :
    rotation === 180 ? [1 - cx, 1 - cy] :
    rotation === 270 ? [cy, 1 - cx] : [cx, cy];
  return { u, v, fw: (w * W) / dispW };
}

/**
 * Öffnet den Editor. `pageUrl` ist das Seitenbild ohne Unterschrift, `signature` ein Canvas.
 * Rückgabe: neue Lage { u, v, fw }, 'remove' zum Entfernen oder null bei Abbruch.
 */
export async function openPlacement({ pageUrl, signature, placement, canRemove }) {
  const root = document.getElementById('sig-place');
  const stage = document.getElementById('sp-stage');
  const pageImg = document.getElementById('sp-page');
  const box = document.getElementById('sp-box');
  const sigImg = document.getElementById('sp-sig');
  const removeBtn = document.getElementById('sp-remove');

  let { u, v, fw } = placement;
  let rect = null;
  let drag = null;
  const aspect = signature.height / signature.width;

  sigImg.src = signature.toDataURL('image/png');
  pageImg.src = pageUrl;
  await pageImg.decode();

  function layout() {
    const r = stage.getBoundingClientRect();
    const iw = pageImg.naturalWidth, ih = pageImg.naturalHeight;
    if (!r.width || !iw) return;
    const pad = 20;
    const s = Math.min((r.width - 2 * pad) / iw, (r.height - 2 * pad) / ih);
    rect = { x: (r.width - iw * s) / 2, y: (r.height - ih * s) / 2, w: iw * s, h: ih * s };
    Object.assign(pageImg.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    place();
  }

  function place() {
    const w = fw * rect.w, h = w * aspect;
    Object.assign(box.style, {
      left: `${rect.x + u * rect.w - w / 2}px`,
      top: `${rect.y + v * rect.h - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
  }

  function onDown(e) {
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, resize: e.target.classList.contains('sig-handle'), x: e.clientX, y: e.clientY, u, v };
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    if (drag.resize) {
      // Größe ändern um die Mitte: Abstand des Fingers zur Mitte = halbe Breite
      const r = stage.getBoundingClientRect();
      const centerX = r.left + rect.x + u * rect.w;
      fw = clamp((2 * Math.abs(e.clientX - centerX)) / rect.w, 0.08, 0.95);
    } else {
      u = clamp(drag.u + (e.clientX - drag.x) / rect.w, 0, 1);
      v = clamp(drag.v + (e.clientY - drag.y) / rect.h, 0, 1);
    }
    place();
  }

  function onUp(e) {
    if (drag && e.pointerId === drag.id) drag = null;
  }

  return new Promise((resolve) => {
    const observer = new ResizeObserver(layout);

    function finish(result) {
      observer.disconnect();
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      box.removeEventListener('pointercancel', onUp);
      root.hidden = true;
      pageImg.removeAttribute('src');
      sigImg.removeAttribute('src');
      resolve(result);
    }

    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);
    removeBtn.hidden = !canRemove;
    removeBtn.onclick = () => finish('remove');
    document.getElementById('sp-cancel').onclick = () => finish(null);
    document.getElementById('sp-done').onclick = () => finish({ u, v, fw });

    root.hidden = false;
    observer.observe(stage);
  });
}
