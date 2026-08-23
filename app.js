/* ═══════════════════════════════════════════════════════════════
 * X写真スタジオ — 横分割だけのシンプル版
 * 完全ローカル処理 / サーバー送信ゼロ / 依存ライブラリゼロ
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

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

/* ═══════════════════════════════════════════════════════════════
 * X表示仕様モジュール（iruagaru実測ベース）
 * ═══════════════════════════════════════════════════════════════ */
const XSpec = {
  /* 枚数ごとのタイムライン全表示範囲 (w/h) */
  limits(count) {
    if (count <= 1) return { min: 0, max: Infinity };
    if (count === 2) return { min: 0.5, max: 1.5 };
    return { min: 0.56, max: 1.18 };
  },
  displayAR(w, h, count) {
    const ar = w / h;
    const { min, max } = this.limits(count);
    return Math.min(Math.max(ar, min), max);
  },
  cropPct(w, h, count) {
    if (count <= 1) return { side: 0, vertical: 0 };
    const { min, max } = this.limits(count);
    const ar = w / h;
    return {
      side: ar > max ? Math.round((1 - max / ar) * 50) : 0,
      vertical: ar < min ? Math.round((1 - ar / min) * 50) : 0,
    };
  },
};

/* ═══════════════════════════════════════════════════════════════
 * 分割ツール本体
 * ═══════════════════════════════════════════════════════════════ */
const S = {
  bitmap: null,
  fileName: 'image',
  pieces: 4,          // 2/3/4（横分割のみ）
  results: [],
};

/* ── STEP1: 画像読み込み ───────────────── */
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
    show('step2'); show('step4'); show('step5');
    toast('画像を読み込みました！');
    render();
  } catch (err) {
    console.error(err);
    toast('読み込みに失敗しました…');
  }
}

/* ── STEP2: 枚数（横分割のみ） ─────────────── */
function syncSplitPick() {
  document.querySelectorAll('#splitPick .pill').forEach(x => {
    x.classList.toggle('selected', +x.dataset.v === S.pieces);
  });
}
document.querySelectorAll('#splitPick .pill').forEach(b => {
  b.addEventListener('click', () => {
    S.pieces = +b.dataset.v;
    syncSplitPick();
    render();
  });
});

/* ── 分割計算（横分割・写真全部残す固定） ─────── */
function calcCells() {
  const bmp = S.bitmap;
  const n = S.pieces;
  const cellSrcW = bmp.width / n;
  const outW = Math.round(cellSrcW);
  const outH = bmp.height;

  const cells = [];
  for (let c = 0; c < n; c++) {
    cells.push({
      sx: c * cellSrcW, sy: 0,
      sw: cellSrcW, sh: bmp.height,
      outW, outH, idx: c + 1,
    });
  }
  return cells;
}

function drawCell(cell) {
  const cv = document.createElement('canvas');
  cv.width = cell.outW;
  cv.height = cell.outH;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(S.bitmap, cell.sx, cell.sy, cell.sw, cell.sh, 0, 0, cv.width, cv.height);
  return cv;
}

function canvasToBlob(cv) {
  return new Promise(res => cv.toBlob(res, 'image/png'));
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

/* ── レンダリング ──────────────────────── */
let renderTimer = null;
let rendering = false;
function render() {
  if (!S.bitmap) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    if (rendering) { render(); return; } // 実行中なら再スケジュール（並走防止）
    rendering = true;
    try { await renderNow(); } finally { rendering = false; }
  }, 120);
}

async function renderNow() {
  const cells = calcCells();

  // 古いblob URL解放
  S.results.forEach(r => URL.revokeObjectURL(r.url));

  // 並列生成
  S.results = await Promise.all(cells.map(async (cell) => {
    const cv = drawCell(cell);
    const blob = await canvasToBlob(cv);
    const name = `${S.fileName}_${String(cell.idx).padStart(2, '0')}.png`;
    return { blob, name, w: cell.outW, h: cell.outH, url: URL.createObjectURL(blob) };
  }));

  // 寸法情報
  const c0 = cells[0];
  const count = S.results.length;
  const dAr0 = XSpec.displayAR(c0.outW, c0.outH, count);
  const mag = 1 / dAr0;
  const sizeNote = mag >= 1.45 ? 'タイムラインでかなり大きく表示されます 💪'
    : mag >= 1.15 ? 'タイムラインで大きめに表示されます'
    : mag >= 0.87 ? 'タイムラインで標準的な大きさです'
    : 'タイムラインでは小さめ・横長に表示されます';
  const c0crop = XSpec.cropPct(c0.outW, c0.outH, count);
  $('layoutDim').innerHTML =
    `各セル: <b>${c0.outW}×${c0.outH}（${ratioLabel(c0.outW, c0.outH)}）</b><br>${sizeNote}` +
    (c0crop.vertical > 0 ? `<br>⚠️ <b>上下 約${c0crop.vertical}%ずつ見切れます</b>（タップで全体表示）`
     : c0crop.side > 0 ? `<br>⚠️ <b>左右 約${c0crop.side}%ずつ見切れます</b>（タップで全体表示）` : '');
  $('orderHint').textContent = `Xには ${Array.from({ length: count }, (_, i) => i + 1).join(' → ')} の順（左から）で添付してください`;

  // タイムラインプレビュー（実測仕様・見切れ視覚化つき）
  const car = $('previewCarousel');
  car.innerHTML = '';
  const media = car.closest('.post-media');
  const raw = media ? media.clientWidth - 2 : 0;
  const cw = raw > 0 ? raw : 340;
  const dispH = Math.round(cw / dAr0);
  S.results.forEach((r, i) => {
    const { side, vertical } = XSpec.cropPct(r.w, r.h, count);
    const wrap = document.createElement('button');
    wrap.className = 'cell';
    wrap.style.width = cw + 'px';
    wrap.style.height = dispH + 'px';
    const img = document.createElement('img');
    img.src = r.url; img.alt = `セル${i + 1}`;
    wrap.appendChild(img);
    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = (i + 1);
    wrap.appendChild(idx);
    if (vertical > 0) {
      wrap.insertAdjacentHTML('beforeend',
        `<div class="crop-band cb-top"><span>▲ 上 約${vertical}% 見切れ</span></div>` +
        `<div class="crop-band cb-bottom"><span>▼ 下 約${vertical}% 見切れ</span></div>`);
    } else if (side > 0) {
      wrap.insertAdjacentHTML('beforeend',
        `<div class="crop-band cb-left"><span>◀ 約${side}%</span></div>` +
        `<div class="crop-band cb-right"><span>約${side}% ▶</span></div>`);
    }
    wrap.addEventListener('click', () => Viewer.open(S.results, i, count));
    car.appendChild(wrap);
  });

  // ページング（ドット + カウンター + 矢印ナビ）
  let dots = media.querySelector('.timeline-dots');
  if (!dots) { dots = document.createElement('div'); dots.className = 'timeline-dots'; media.appendChild(dots); }
  dots.innerHTML = S.results.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('');
  const counter = media.querySelector('.page-counter') || (() => {
    const c = document.createElement('div'); c.className = 'page-counter'; media.appendChild(c); return c;
  })();
  const mkArrow = (dir) => {
    let a = media.querySelector('.nav-arrow.' + dir);
    if (!a) {
      a = document.createElement('button'); a.className = 'nav-arrow ' + dir;
      a.textContent = dir === 'prev' ? '‹' : '›';
      a.setAttribute('aria-label', dir === 'prev' ? '前へ' : '次へ');
      media.appendChild(a);
    }
    a.onclick = () => {
      const i = Math.round(car.scrollLeft / (cw + 2));
      const t = Math.max(0, Math.min(count - 1, i + (dir === 'prev' ? -1 : 1)));
      car.scrollTo({ left: t * (cw + 2), behavior: 'smooth' });
    };
    return a;
  };
  const prevB = mkArrow('prev'), nextB = mkArrow('next');
  const updateNav = () => {
    const i = Math.max(0, Math.min(count - 1, Math.round(car.scrollLeft / (cw + 2))));
    dots.querySelectorAll('span').forEach((s, j) => s.classList.toggle('on', j === i));
    counter.textContent = `${i + 1} / ${count}`;
    counter.style.display = count > 1 ? '' : 'none';
    prevB.style.display = i > 0 ? '' : 'none';
    nextB.style.display = i < count - 1 ? '' : 'none';
  };
  car.onscroll = updateNav;
  updateNav();

  // resize用: 画像を再生成せずレイアウトだけ更新（白フラッシュ防止）
  window.__updateTimelineLayout = () => {
    const m2 = car.closest('.post-media');
    const cw2 = m2 ? m2.clientWidth - 2 : 340;
    const dAr2 = XSpec.displayAR(S.results[0].w, S.results[0].h, count);
    const dispH2 = Math.round(cw2 / dAr2);
    car.querySelectorAll('.cell').forEach(c => {
      c.style.width = cw2 + 'px';
      c.style.height = dispH2 + 'px';
    });
  };

  // 表示サイズ比較（1:1投稿を基準にした高さゲージ）
  const sc = $('sizeCompare');
  if (sc) {
    const maxMag = Math.max(2, mag * 1.08);
    const pct = (m) => Math.max(2, Math.round(m / maxMag * 100));
    sc.querySelector('.sc-base').style.width = pct(1) + '%';
    sc.querySelector('.sc-now').style.width = pct(mag) + '%';
    sc.querySelector('.sc-now-val').textContent = mag.toFixed(1) + '×';
    sc.querySelector('.sc-note').innerHTML =
      `1枚目の比率で全体の高さが決まります · スワイプ／矢印で切替 · 画像タップで拡大`;
  }

  // DLグリッド
  const grid = $('outGrid');
  grid.innerHTML = '';
  S.results.forEach((r, i) => {
    const cell = document.createElement('div');
    cell.className = 'out-cell';
    cell.innerHTML = `
      <img src="${r.url}" alt="${r.name}">
      <div class="meta">
        <div class="fname">${r.name}</div>
        <div class="fsize">${r.w}×${r.h}（${ratioLabel(r.w, r.h)}）· ${(r.blob.size / 1024).toFixed(0)} KB</div>
        <div class="dl-links">
          <button class="link-btn dl">ダウンロード</button>
        </div>
      </div>`;
    cell.querySelector('.dl').addEventListener('click', () => download(r));
    grid.appendChild(cell);
  });
}

function show(id) { const el = $(id); if (el) el.style.display = ''; }

/* ── ダウンロード ──────────────────────── */
$('allBtn').addEventListener('click', () => {
  if (!S.results.length) return;
  S.results.forEach((r, i) => setTimeout(() => download(r), i * 350));
  toast('順番にダウンロードします…');
});
$('postBtn').addEventListener('click', () => {
  window.open('https://x.com/intent/post', '_blank', 'noopener');
});
function download(r) {
  const a = document.createElement('a');
  a.href = r.url;
  a.download = r.name;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ═══════════════════════════════════════════════════════════════
 * ビューア（タップ後の拡大表示）
 * ═══════════════════════════════════════════════════════════════ */
const Viewer = {
  items: [], active: 0,
  open(items, i, count) {
    this.items = items;
    this.active = i;
    this.count = count || items.length;
    $('viewer').hidden = false;
    this.show();
  },
  show() {
    const it = this.items[this.active];
    $('viewerImage').src = it.url;
    $('viewerCount').textContent = `${this.active + 1} / ${this.items.length}`;
    const img = $('viewerImage');
    img.onload = () => {
      $('viewerMeta').textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${(img.naturalWidth / img.naturalHeight).toFixed(2)}:1`;
    };
    $('viewerPrev').disabled = this.active === 0;
    $('viewerNext').disabled = this.active === this.items.length - 1;
  },
};
$('viewerClose').onclick = () => { $('viewer').hidden = true; };
$('viewerPrev').onclick = () => { if (Viewer.active > 0) { Viewer.active--; Viewer.show(); } };
$('viewerNext').onclick = () => { if (Viewer.active < Viewer.items.length - 1) { Viewer.active++; Viewer.show(); } };
document.addEventListener('keydown', (e) => {
  if ($('viewer').hidden) return;
  if (e.key === 'Escape') $('viewer').hidden = true;
  if (e.key === 'ArrowLeft' && Viewer.active > 0) { Viewer.active--; Viewer.show(); }
  if (e.key === 'ArrowRight' && Viewer.active < Viewer.items.length - 1) { Viewer.active++; Viewer.show(); }
});

/* ═══════════════════════════════════════════════════════════════
 * ZIP (STORE / 無圧縮) — 依存ライブラリゼロの自前実装
 * ═══════════════════════════════════════════════════════════════ */
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
    const lfh = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0, 0x04034b50, true);
    lfh.setUint16(4, 20, true);
    lfh.setUint16(6, 0x0800, true);
    lfh.setUint16(8, 0, true);
    lfh.setUint16(10, now.time, true);
    lfh.setUint16(12, now.date, true);
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, data.length, true);
    lfh.setUint32(22, data.length, true);
    lfh.setUint16(26, nameB.length, true);
    lfh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lfh.buffer), nameB, data);
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
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, offset, true);
  chunks.push(...central, new Uint8Array(eocd.buffer));
  return new Blob(chunks, { type: 'application/zip' });
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

let lastVW = window.innerWidth;
let resizeTimer = null;
window.addEventListener('resize', () => {
  // 高さだけの変化（モバイルのアドレスバー出し入れ）は無視
  if (Math.abs(window.innerWidth - lastVW) < 1) return;
  lastVW = window.innerWidth;
  if (!S.results.length) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // 画像は再生成せず、プレビューの幅・高さだけ更新（白フラッシュ防止）
    if (window.__updateTimelineLayout) window.__updateTimelineLayout();
  }, 200);
});
syncSplitPick();
