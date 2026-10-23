// File -> text lines. PDFs use the embedded text layer; scans/images fall back to offline OCR.
import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

let ocrWorker = null;
async function getOcr() {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng+deu', 1, {
      workerPath: new URL('./vendor/worker.min.js', location.href).href,
      corePath: new URL('./vendor/core/', location.href).href,
      langPath: new URL('./vendor/lang/', location.href).href,
      gzip: false,
    });
  }
  return ocrWorker;
}

async function ocrCanvas(canvas) {
  const w = await getOcr();
  const { data } = await w.recognize(canvas);
  return data.text.split('\n');
}

// Group text items into visual rows, keeping column gaps as spaces.
function pageLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    let row = rows.find(r => Math.abs(r.y - y) < 3);
    if (!row) rows.push(row = { y, parts: [] });
    row.parts.push({ x: it.transform[4], w: it.width, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const p of r.parts) {
      if (end !== null && p.x - end > 1 && !out.endsWith(' ')) out += ' ';
      out += p.s;
      end = p.x + p.w;
    }
    return out;
  });
}

export async function extractFile(file, onProgress) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return { kind: 'csv', text: await file.text() };
  }
  if (name.endsWith('.pdf')) {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    let ocrPages = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`Page ${i}/${pdf.numPages}`, (i - 1) / pdf.numPages);
      const page = await pdf.getPage(i);
      const pl = pageLines((await page.getTextContent()).items);
      if (pl.join('').length > 80) { lines.push(...pl); continue; }
      // no text layer -> render and OCR
      ocrPages++;
      onProgress?.(`OCR page ${i}/${pdf.numPages}`, (i - 1) / pdf.numPages);
      const vp = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      lines.push(...await ocrCanvas(canvas));
    }
    return { kind: 'pdf', lines, ocrPages };
  }
  onProgress?.('OCR image', 0.1);
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1800 ? 1800 / bmp.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width * scale; canvas.height = bmp.height * scale;
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { kind: 'image', lines: await ocrCanvas(canvas), ocrPages: 1 };
}
