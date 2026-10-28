// Erstellt aus den fertigen Seitenbildern ein PDF (eine Seite pro Bild).

const PAGE_SHORT_SIDE = 595.28; // Breite von DIN A4 in Punkt

/** pages: [{ blob, width, height }] → PDF als Blob */
export async function buildPdf(pages, title) {
  const { jsPDF } = window.jspdf;
  let doc = null;

  for (const page of pages) {
    const landscape = page.width > page.height;
    const w = landscape ? (PAGE_SHORT_SIDE * page.width) / page.height : PAGE_SHORT_SIDE;
    const h = landscape ? PAGE_SHORT_SIDE : (PAGE_SHORT_SIDE * page.height) / page.width;
    const orientation = landscape ? 'l' : 'p';
    if (!doc) doc = new jsPDF({ orientation, unit: 'pt', format: [w, h], compress: true });
    else doc.addPage([w, h], orientation);
    const bytes = new Uint8Array(await page.blob.arrayBuffer());
    doc.addImage(bytes, 'JPEG', 0, 0, w, h, undefined, 'NONE');
  }

  doc.setProperties({ title, creator: 'DokuScan' });
  return doc.output('blob');
}

export function canShareFile(file) {
  return !!navigator.canShare && navigator.canShare({ files: [file] });
}

/** Öffnet das iOS-Teilen-Menü (Sichern in Dateien, Mail, AirDrop …). Muss direkt aus einem Tipp heraus aufgerufen werden. */
export async function shareFile(file) {
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch (err) {
    if (err.name === 'AbortError') return false;
    throw err;
  }
}
