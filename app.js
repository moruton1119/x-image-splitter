/* ═══════════════════════════════════════════════════════════════
 * X 分割くん — 1枚の写真を任意の分割レイアウトに自動トリミング
 * 完全ローカル処理 / サーバー送信ゼロ / 依存ライブラリゼロ
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── State ─────────────────────────────── */
const S = {
  bitmap: null,        // ImageBitmap (EXIF回転済み)
  fileName: 'image',
  rows: 1, cols: 4,
  cellRatio: [1, 1],   // w:h
  offsetX: 0, offsetY: 0, // -50..50 (%)
  gap: 12,             // px (元画像スケール)
  format: 'png',
  quality: 0.92,
  outWidth: 1080,      // 'orig' or number
  results: [],         // [{blob, name, w, h, dataUrl(preview)}]
  previewMode: 'carousel',
};

const $ = (id) => document.getElementById(id);

/* ── Toast ─────────────────────────────── */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── STEP 1: 画像読み込み ──────────────── */
const dz = $('dropzone');
const fi = $('fileInput');

dz.addEventListener('click', () => fi.click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click(); });
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', (e) => {
  e.preventDefault(); dz.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) loadImage(f);
});
fi.addEventListener('change', () => { if (fi.files[0]) loadImage(fi.files[0]); });

async function loadImage(file) {
  if (!file.type.startsWith('image/')) { toast('画像ファイルを選んでね'); return; }
  try {
    const buf = await file.arrayBuffer();
    // imageOrientation: 'from-image' → EXIF回転を自動適用
    S.bitmap = await createImageBitmap(new Blob([buf]), { imageOrientation: 'from-image' });
    S.fileName = file.name.replace(/\.[^.]+$/, '');
    dz.classList.add('loaded');
    dz.innerHTML = `
      <div class="src-preview">
        <img src="${URL.createObjectURL(file)}" alt="元画像">
        <div class="src-info">
          元画像: ${S.bitmap.width} × <span class="dim">${S.bitmap.height}</span> px<br>
          <span style="color:var(--muted);font-size:12px">${file.name}</span><br>
          <button class="link-btn" id="changeImg">別の画像を選ぶ</button>
        </div>
      </div>`;
    $('changeImg').addEventListener('click', (e) => { e.stopPropagation(); fi.click(); });
    autoLayout();
    show('step2'); show('step3');
    toast('画像を読み込みました！');
    render();
  } catch (err) {
    console.error(err);
    toast('読み込みに失敗しました…');
  }
}

/* ── STEP 2: レイアウト ────────────────── */
const PRESETS = [
  { label: '1×2', r: 1, c: 2 }, { label: '1×3', r: 1, c: 3 }, { label: '1×4 縦', r: 1, c: 4 },
  { label: '2×1', r: 2, c: 1 }, { label: '3×1', r: 3, c: 1 }, { label: '4×1 横', r: 4, c: 1 },
  { label: '2×2', r: 2, c: 2 }, { label: '1×1', r: 1, c: 1 },
];
const grid = $('layoutGrid');
PRESETS.forEach(p => {
  const b = document.createElement('button');
  b.className = 'layout-opt';
  b.dataset.r = p.r; b.dataset.c = p.c;
  let cells = '';
  for (let i = 0; i < p.r * p.c; i++) cells += '<span></span>';
  b.innerHTML = `<div class="cells" style="grid-template-columns:repeat(${p.c},1fr);grid-template-rows:repeat(${p.r},1fr)">${cells}</div><div class="label">${p.label}</div>`;
  b.addEventListener('click', () => { setLayout(p.r, p.c); });
  grid.appendChild(b);
});
// 1×4 を初期選択
selectPreset(1, 4);

function selectPreset(r, c) {
  document.querySelectorAll('.layout-opt').forEach(el => {
    el.classList.toggle('selected', +el.dataset.r === r && +el.dataset.c === c);
  });
  $('customRows').value = r; $('customCols').value = c;
}
function setLayout(r, c) {
  r = Math.min(4, Math.max(1, r | 0));
  c = Math.min(4, Math.max(1, c | 0));
  S.rows = r; S.cols = c;
  selectPreset(r, c);
  render();
}
$('customRows').addEventListener('input', () => setLayout(+$('customRows').value, S.cols));
$('customCols').addEventListener('input', () => setLayout(S.rows, +$('customCols').value));

// 画像比率からおすすめレイアウト
function autoLayout() {
  if (!S.bitmap) return;
  const ar = S.bitmap.width / S.bitmap.height;
  let rec;
  if (ar < 0.75) rec = [1, 4];        // 縦長 → 縦4スライス（流行り）
  else if (ar > 2.2) rec = [4, 1];    // 超横長 → 横4
  else if (ar > 1.1) rec = [2, 2];    // 横長 → 2×2
  else rec = [1, 4];                  // 正方形寄り → 縦4
  const note = $('autoNote');
  note.style.display = 'block';
  const [r, c] = rec;
  $('recLayout').textContent = `${r}×${c} ${r === 1 && c > 1 ? '縦' : r > 1 && c === 1 ? '横' : 'グリッド'}`;
  $('recLayout').onclick = () => { setLayout(r, c); toast(`おすすめ ${r}×${c} を適用！`); };
  setLayout(r, c); // 自動適用（変更可能）
}

/* ── STEP 3: 設定 ──────────────────────── */
function bindSeg(id, cb) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    el.querySelectorAll('.seg').forEach(s => s.classList.remove('selected'));
    b.classList.add('selected');
    cb(b.dataset.v);
    render();
  });
}
bindSeg('cellRatio', v => { S.cellRatio = v.split(':').map(Number); });
bindSeg('format', v => {
  S.format = v;
  $('qualityWrap').style.display = (v === 'png') ? 'none' : 'block';
});
bindSeg('cellWidth', v => { S.outWidth = (v === 'orig') ? 'orig' : +v; });

function bindRange(id, valId, cb, fmt) {
  const el = $(id);
  el.addEventListener('input', () => {
    $(valId).textContent = fmt(el.value);
    cb(+el.value);
    render();
  });
}
bindRange('offsetX', 'offsetXVal', v => S.offsetX = v, v => v + '%');
bindRange('offsetY', 'offsetYVal', v => S.offsetY = v, v => v + '%');
bindRange('gap', 'gapVal', v => S.gap = v, v => v + 'px');
bindRange('quality', 'qualityVal', v => S.quality = v / 100, v => v + '%');

/* ── 分割計算（コア） ──────────────────── */
function calcCells() {
  const bmp = S.bitmap;
  const [rw, rh] = S.cellRatio;
  const rows = S.rows, cols = S.cols;

  // 仮想キャンバス比（セル比 × 行列数）
  const canvasAR = (rw * cols) / (rh * rows);
  const imgAR = bmp.width / bmp.height;

  // カバークロップ: ソース矩形
  let srcW, srcH;
  if (imgAR > canvasAR) { srcH = bmp.height; srcW = srcH * canvasAR; }
  else { srcW = bmp.width; srcH = srcW / canvasAR; }

  const maxOffX = bmp.width - srcW;
  const maxOffY = bmp.height - srcH;
  const srcX = maxOffX > 0 ? maxOffX * (0.5 + S.offsetX / 100) : 0;
  const srcY = maxOffY > 0 ? maxOffY * (0.5 + S.offsetY / 100) : 0;

  // 出力セルサイズ
  const cellSrcW = srcW / cols, cellSrcH = srcH / rows;
  let outW = S.outWidth === 'orig' ? Math.round(cellSrcW) : S.outWidth;
  const outH = Math.round(outW * rh / rw);

  const cells = [];
  const g = Math.min(S.gap, (Math.min(cellSrcW, cellSrcH) / 2) - 1); // 安全上限
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cutL = c > 0 ? g / 2 : 0;
      const cutR = c < cols - 1 ? g / 2 : 0;
      const cutT = r > 0 ? g / 2 : 0;
      const cutB = r < rows - 1 ? g / 2 : 0;
      cells.push({
        sx: srcX + c * cellSrcW + cutL,
        sy: srcY + r * cellSrcH + cutT,
        sw: Math.max(1, cellSrcW - cutL - cutR),
        sh: Math.max(1, cellSrcH - cutT - cutB),
        outW, outH, idx: r * cols + c + 1,
      });
    }
  }
  return cells;
}

function drawCell(cell, targetW) {
  const cv = document.createElement('canvas');
  cv.width = targetW || cell.outW;
  cv.height = Math.round(cv.width * cell.outH / cell.outW);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (S.format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.drawImage(S.bitmap, cell.sx, cell.sy, cell.sw, cell.sh, 0, 0, cv.width, cv.height);
  return cv;
}

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

function canvasToBlob(cv) {
  return new Promise(res => cv.toBlob(res, MIME[S.format], S.quality));
}

/* ── レンダリング ──────────────────────── */
let renderTimer = null;
function render() {
  if (!S.bitmap) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, 120); // デバウンス
}

async function renderNow() {
  const cells = calcCells();
  const n = cells.length;
  if (n > 4) {
    toast(`⚠️ ${n}枚生成 — Xへの投稿は1度に4枚までです`);
  }

  // 古いblob URLを解放（メモリリーク防止）
  S.results.forEach(r => URL.revokeObjectURL(r.url));

  // 本番出力を先に生成（プレビューもこのblob URLを使う＝DL内容と完全一致）
  S.results = [];
  for (let i = 0; i < cells.length; i++) {
    const cv = drawCell(cells[i]);
    const blob = await canvasToBlob(cv);
    const name = `${S.fileName}_split_${String(cells[i].idx).padStart(2, '0')}.${EXT[S.format]}`;
    S.results.push({ blob, name, w: cells[i].outW, h: cells[i].outH, url: URL.createObjectURL(blob) });
  }

  // カルーセルプレビュー（blob URLのimg — 複数箇所から参照OK）
  const car = $('previewCarousel');
  car.innerHTML = '';
  const raw = car.parentElement ? car.parentElement.clientWidth - 2 : 0;
  const cw = raw > 0 ? Math.min(360, raw) : 360; // 非表示時のフォールバック
  const cellH = Math.round(cw * cells[0].outH / cells[0].outW);
  S.results.forEach((r, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'cell';
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = `セル${i + 1}`;
    img.style.width = cw + 'px';
    img.style.height = cellH + 'px';
    wrap.appendChild(img);
    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = (i + 1);
    wrap.appendChild(idx);
    car.appendChild(wrap);
  });

  // flatプレビュー（隙間なく並べた見え方 — 独立したimg要素）
  const frame = $('flatFrame');
  frame.innerHTML = '';
  frame.style.gridTemplateColumns = `repeat(${S.cols}, max-content)`;
  const fw = S.cols > 1 ? Math.max(90, Math.floor(560 / S.cols)) : 360;
  S.results.forEach((r, i) => {
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = `元の位置${i + 1}`;
    img.style.width = fw + 'px';
    img.style.display = 'block';
    frame.appendChild(img);
  });

  // 出力グリッド
  const og = $('outGrid');
  og.innerHTML = '';
  S.results.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'out-cell';
    d.innerHTML = `
      <img src="${r.url}" alt="${r.name}">
      <div class="fname">${r.name}</div>
      <div class="fsize">${r.w}×${r.h} / ${(r.blob.size / 1024).toFixed(0)} KB</div>
      <button class="btn-ghost" style="padding:4px 14px;font-size:12px" data-i="${i}">DL</button>`;
    d.querySelector('button').addEventListener('click', () => download(r));
    og.appendChild(d);
  });

  show('step4'); show('step5');
}

function show(id) { $(id).style.display = ''; }

/* ── タブ ──────────────────────────────── */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    S.previewMode = t.dataset.v;
    const carousel = t.dataset.v === 'carousel';
    $('previewCarousel').parentElement.parentElement.style.display = carousel ? '' : 'none';
    document.querySelector('.post-hint').style.display = carousel ? '' : 'none';
    $('flatWrap').style.display = carousel ? 'none' : '';
  });
});

/* ── ダウンロード ──────────────────────── */
function download(r) {
  const a = document.createElement('a');
  a.href = r.url; a.download = r.name;
  document.body.appendChild(a); a.click(); a.remove();
}

$('allBtn').addEventListener('click', async () => {
  const order = $('reverseDl').checked ? [...S.results].reverse() : S.results;
  for (const r of order) { download(r); await sleep(500); }
  toast('ダウンロード開始！');
});

$('postBtn').addEventListener('click', () => {
  window.open('https://x.com/compose/post', '_blank', 'noopener');
});

$('zipBtn').addEventListener('click', async () => {
  if (!S.results.length) return;
  try {
    toast('ZIP生成中…');
    const zip = await buildZip(S.results.map(r => ({ name: r.name, data: r.blob })));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = `${S.fileName}_split.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('ZIPをダウンロードしました！');
  } catch (e) { console.error(e); toast('ZIP生成に失敗…'); }
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════════════════
 * ZIP (STORE / 無圧縮) — 依存ライブラリゼロの自前実装
 * 画像は既に圧縮済みなので再圧縮せずそのまま格納する
 * ═══════════════════════════════════════════════════════════════ */
async function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = new Uint8Array(await f.data.arrayBuffer());
    const nameB = enc.encode(f.name);
    const crc = crc32(data);
    const now = dosTime(new Date());

    // Local File Header
    const lfh = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0, 0x04034b50, true);
    lfh.setUint16(4, 20, true);        // version needed
    lfh.setUint16(6, 0x0800, true);    // UTF-8 filename flag
    lfh.setUint16(8, 0, true);         // method: store
    lfh.setUint16(10, now.time, true);
    lfh.setUint16(12, now.date, true);
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, data.length, true);   // compressed
    lfh.setUint32(22, data.length, true);   // uncompressed
    lfh.setUint16(26, nameB.length, true);
    lfh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lfh.buffer), nameB, data);

    // Central Directory entry
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, now.time, true);
    cd.setUint16(14, now.date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true);
    // 30..41 extra/comment/disk/attrs = 0
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);

    offset += 30 + nameB.length + data.length;
  }

  // End of Central Directory
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
