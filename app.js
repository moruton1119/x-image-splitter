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
  cropMode: 'none',    // 'none'=元画像比率維持 / 'w:h'=そのセル比へカバークロップ
  offsetX: 0, offsetY: 0, // -50..50 (%)
  gap: 0,              // px (元画像スケール)
  format: 'png',
  quality: 0.92,
  outWidth: 'orig',    // 'orig' or number
  results: [],         // [{blob, name, w, h, url}]
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
  { label: '1×2', r: 1, c: 2 }, { label: '1×3', r: 1, c: 3 }, { label: '1×4 左→右4枚', r: 1, c: 4 },
  { label: '2×1', r: 2, c: 1 }, { label: '3×1', r: 3, c: 1 }, { label: '4×1 縦4段', r: 4, c: 1 },
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

// 画像比率からおすすめレイアウト（流行りの分割方式）
function autoLayout() {
  if (!S.bitmap) return;
  const ar = S.bitmap.width / S.bitmap.height;
  let rec, label;
  if (ar < 0.8) {
    // 縦長画像 → 縦4段（各セルが正方形〜縦長になり、4ページに分けて読める）
    rec = [4, 1]; label = '4×1 縦4段（縦長画像を4ページに）';
  } else {
    // 正方形〜横長画像 → 左から右へ4枚（各セルが縦長になり、タイムラインで大きく表示）
    rec = [1, 4]; label = '1×4 左→右4枚（タイムラインで大きく）';
  }
  const note = $('autoNote');
  note.style.display = 'block';
  const [r, c] = rec;
  $('recLayout').textContent = label;
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
bindSeg('cropMode', v => {
  S.cropMode = v;
  // クロップモード時のみ位置調整が有効
  const off = $('offsetBlock');
  off.style.opacity = (v === 'none') ? '0.4' : '1';
  off.querySelectorAll('input').forEach(i => i.disabled = (v === 'none'));
});
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

/* ── 分割計算（コア） ────────────────────
 * デフォルト: 元画像のアスペクト比を維持したまま行列で等分（COLLAGE方式）
 * cropMode指定時のみ、全体を指定セル比×行列のキャンバス比へカバークロップ
 */
function calcCells() {
  const bmp = S.bitmap;
  const rows = S.rows, cols = S.cols;

  let srcX = 0, srcY = 0, srcW = bmp.width, srcH = bmp.height;

  if (S.cropMode !== 'none') {
    const [rw, rh] = S.cropMode.split(':').map(Number);
    const canvasAR = (rw * cols) / (rh * rows);
    const imgAR = bmp.width / bmp.height;
    if (imgAR > canvasAR) { srcH = bmp.height; srcW = srcH * canvasAR; }
    else { srcW = bmp.width; srcH = srcW / canvasAR; }
    const maxOffX = bmp.width - srcW;
    const maxOffY = bmp.height - srcH;
    srcX = maxOffX > 0 ? maxOffX * (0.5 + S.offsetX / 100) : 0;
    srcY = maxOffY > 0 ? maxOffY * (0.5 + S.offsetY / 100) : 0;
  }

  const cellSrcW = srcW / cols, cellSrcH = srcH / rows;
  const outW = S.outWidth === 'orig' ? Math.round(cellSrcW) : S.outWidth;
  const outH = Math.round(outW * cellSrcH / cellSrcW);

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

/* Xタイムラインの表示クロップ仕様シミュレーション
 * 横長は16:9上限、縦長は4:5下限。範囲外はタイムラインで一部クロップ（タップで全体） */
function xDisplayAR(w, h) {
  const ar = w / h;
  const WIDE = 16 / 9, TALL = 4 / 5;
  if (ar > WIDE) return WIDE;
  if (ar < TALL) return TALL;
  return ar;
}
function ratioLabel(w, h) {
  const ar = w / h;
  const presets = [[16,9],[4,5],[3,4],[2,3],[1,1],[1,2],[1,3],[1,4],[3,2],[4,3],[9,16],[2,1],[3,1],[4,1]];
  let best = null, bestDiff = Infinity;
  for (const [a, b] of presets) {
    const d = Math.abs(ar - a / b);
    if (d < bestDiff) { bestDiff = d; best = a + ':' + b; }
  }
  return bestDiff < 0.02 ? best : ar.toFixed(2) + ':1';
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

  // 本番出力を先に生成
  S.results = [];
  for (let i = 0; i < cells.length; i++) {
    const cv = drawCell(cells[i]);
    const blob = await canvasToBlob(cv);
    const name = `${S.fileName}_split_${String(cells[i].idx).padStart(2, '0')}.${EXT[S.format]}`;
    S.results.push({ blob, name, w: cells[i].outW, h: cells[i].outH, url: URL.createObjectURL(blob) });
  }

  // ── セル情報表示（STEP2/3） ──
  const c0 = cells[0];
  const cellAr = c0.outW / c0.outH;
  const dispAr = xDisplayAR(c0.outW, c0.outH);
  const sizeNote = cellAr < 0.8 ? '縦長 — タイムラインで大きく表示されます'
    : cellAr > 1.2 ? '横長 — タイムラインでは小さめに表示されます'
    : 'タイムラインで中くらいの大きさで表示されます';
  const dim = $('cellDim');
  if (dim) dim.innerHTML = `<b style="color:var(--x-blue)">${c0.outW}×${c0.outH}（${ratioLabel(c0.outW, c0.outH)}）</b><br>${sizeNote}`;
  const dim2 = $('layoutDim');
  if (dim2) dim2.innerHTML = `各セル: <b style="color:var(--x-blue)">${c0.outW}×${c0.outH}</b>（${ratioLabel(c0.outW, c0.outH)}）— ${sizeNote}`;

  // ── タイムラインプレビュー（Xクロップ仕様再現） ──
  const car = $('previewCarousel');
  car.innerHTML = '';
  const raw = car.parentElement ? car.parentElement.clientWidth - 2 : 0;
  const cw = raw > 0 ? raw : 340; // 非表示時のフォールバック
  S.results.forEach((r, i) => {
    const disp = xDisplayAR(r.w, r.h);
    const cropped = Math.abs(disp - r.w / r.h) > 0.01;
    const wrap = document.createElement('div');
    wrap.className = 'cell';
    wrap.style.width = cw + 'px';
    wrap.style.height = Math.round(cw / disp) + 'px';
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = `セル${i + 1}`;
    wrap.appendChild(img);
    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = (i + 1);
    wrap.appendChild(idx);
    if (cropped) {
      const tag = document.createElement('span');
      tag.className = 'cropped'; tag.textContent = '一部クロップ';
      wrap.appendChild(tag);
    }
    car.appendChild(wrap);
  });

  // ページングドット
  const media = car.closest('.post-media');
  let dots = media.querySelector('.timeline-dots');
  if (!dots) {
    dots = document.createElement('div');
    dots.className = 'timeline-dots';
    media.appendChild(dots);
  }
  dots.innerHTML = S.results.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('');
  car.onscroll = () => {
    const i = Math.round(car.scrollLeft / (cw + 2));
    dots.querySelectorAll('span').forEach((s, j) => s.classList.toggle('on', j === i));
  };

  // ── 拡大（タップ後）プレビュー: 縦に繋がる見え方 ──
  const stack = $('expandedStack');
  stack.innerHTML = '';
  S.results.forEach((r, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'exp';
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = `拡大${i + 1}`;
    wrap.appendChild(img);
    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = (i + 1);
    wrap.appendChild(idx);
    stack.appendChild(wrap);
  });

  // ── 元の並びプレビュー ──
  const frame = $('flatFrame');
  frame.innerHTML = '';
  frame.style.gridTemplateColumns = `repeat(${S.cols}, max-content)`;
  const fw = S.cols > 1 ? Math.max(80, Math.floor(520 / S.cols)) : 360;
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
      <div class="fsize">${r.w}×${r.h}（${ratioLabel(r.w, r.h)}）/ ${(r.blob.size / 1024).toFixed(0)} KB</div>
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
    const v = t.dataset.v;
    $('timelineWrap').style.display = (v === 'timeline') ? '' : 'none';
    $('expandedWrap').style.display = (v === 'expanded') ? '' : 'none';
    $('flatWrap').style.display = (v === 'flat') ? '' : 'none';
    if (v === 'timeline') render(); // 幅再計算のため再描画
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

// 初期状態: cropMode=none → 位置調整無効
$('offsetBlock').style.opacity = '0.4';
$('offsetBlock').querySelectorAll('input').forEach(i => i.disabled = true);

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
