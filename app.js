/* ═══════════════════════════════════════════════════════════════
 * X写真スタジオ — 分割 & プレビュー
 * 完全ローカル処理 / サーバー送信ゼロ / 依存ライブラリゼロ
 * （twitter-textのみ同梱: vendor/twitter-text.js）
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
 * X表示仕様モジュール（iruagaru実測ベース — 全ツール共通）
 * ═══════════════════════════════════════════════════════════════ */
const XSpec = {
  /* 枚数ごとのタイムライン全表示範囲 (w/h) */
  limits(count) {
    if (count <= 1) return { min: 0, max: Infinity };   // 1枚: 元比率維持
    if (count === 2) return { min: 0.5, max: 1.5 };     // 2枚: 横並び2分割
    return { min: 0.56, max: 1.18 };                     // 3〜4枚: カルーセル
  },
  /* クランプ後の表示比率 */
  displayAR(w, h, count) {
    const ar = w / h;
    const { min, max } = this.limits(count);
    return Math.min(Math.max(ar, min), max);
  },
  /* 見切れ% (sideCrop: 左右%, verticalCrop: 上下%) — 複数枚のみ */
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
 * タブ切替
 * ═══════════════════════════════════════════════════════════════ */
document.querySelectorAll('.main-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.main-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const v = t.dataset.tab;
    $('tabSplit').hidden = (v !== 'split');
    $('tabPreview').hidden = (v !== 'preview');
    window.scrollTo({ top: 0 });
    if (v === 'preview') PV.render();
  });
});

/* ═══════════════════════════════════════════════════════════════
 * 分割ツール
 * ═══════════════════════════════════════════════════════════════ */
const S = {
  bitmap: null,
  fileName: 'image',
  mode: 'carousel',   // 'carousel'=左からN枚 / 'rows'=上からN段
  pieces: 4,          // 2/3/4
  style: 'full',      // 'full'=全部残す / 'ratio'=比率を揃える
  ratio: [3, 4],      // 3:4 or 4:5 (ratioモード)
  focusY: 50,         // 0-100 上下位置 (ratioモード)
  gap: 0,
  format: 'png',
  quality: 0.92,
  outWidth: 'orig',
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
    autoMode();
    show('step2'); show('step3');
    toast('画像を読み込みました！');
    render();
  } catch (err) {
    console.error(err);
    toast('読み込みに失敗しました…');
  }
}

/* ── STEP2: モード・枚数 ───────────────── */
function setStyleUI(v) {
  S.style = v;
  document.querySelectorAll('#styleMode .seg').forEach(s => s.classList.toggle('selected', s.dataset.v === v));
  $('ratioPick').style.display = (v === 'ratio') ? '' : 'none';
  $('focusY').disabled = (v !== 'ratio');
  $('styleNote').textContent = (v === 'ratio')
    ? '各セルの比率を3:4/4:5に揃えて、きれいなカルーセルにします'
    : '元の写真全体を、等しい幅で切り分けます';
}
function syncSplitPick() {
  document.querySelectorAll('#splitPick .pill').forEach(x => {
    x.classList.toggle('selected', x.dataset.mode === S.mode && +x.dataset.v === S.pieces);
  });
}
function autoMode() {
  if (!S.bitmap) return;
  const ar = S.bitmap.width / S.bitmap.height;
  let mode, style, why;
  if (ar < 0.56) {
    mode = 'rows'; style = 'full';
    why = '縦に4（超縦長の写真だから、等分だけでセルが大きくなります）';
  } else if (ar < 1.0) {
    mode = 'rows'; style = 'ratio';
    why = '縦に4 ＋ 比率を揃える（縦長の写真を縦長セルで大きく見せます）';
  } else {
    mode = 'carousel'; style = 'full';
    why = '横に4（正方形〜横長の写真は左から切るとセルが縦長になります）';
  }
  S.mode = mode; S.pieces = 4;
  syncSplitPick();
  setStyleUI(style);
  const note = $('autoNote');
  note.style.display = 'block';
  $('recLayout').textContent = why;
}
document.querySelectorAll('#splitPick .pill').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#splitPick .pill').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    S.mode = b.dataset.mode;
    S.pieces = +b.dataset.v;
    render();
  });
});

/* ── STEP3: スタイル・設定 ─────────────── */
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
bindSeg('styleMode', v => {
  S.style = v;
  const isRatio = (v === 'ratio');
  $('ratioPick').style.display = isRatio ? '' : 'none';
  $('focusY').disabled = !isRatio;
  $('styleNote').textContent = isRatio
    ? '各セルの比率を3:4/4:5に揃えて、きれいなカルーセルにします'
    : '元の写真全体を、等しい幅で切り分けます';
});
bindSeg('cellRatio', v => { S.ratio = v.split(':').map(Number); });
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
bindRange('focusY', 'focusYVal', v => S.focusY = v, v => v + '%');
bindRange('gap', 'gapVal', v => S.gap = v, v => v + 'px');
bindRange('quality', 'qualityVal', v => S.quality = v / 100, v => v + '%');

/* ── 分割計算（コア） ──────────────────── */
function calcCells() {
  const bmp = S.bitmap;
  const n = S.pieces;
  const horizontal = S.mode === 'carousel'; // 左から = 横並び

  let srcX = 0, srcY = 0, srcW = bmp.width, srcH = bmp.height;
  let cols, rows;

  if (S.style === 'ratio') {
    const [rw, rh] = S.ratio;
    if (S.mode === 'rows') {
      // 縦積みn段: 全体カンバス比 rw : rh×n（超縦長）
      const canvasAR = rw / (rh * n);
      const imgAR = bmp.width / bmp.height;
      if (imgAR > canvasAR) {
        // 元写真の方が横長 → 左右をクロップ
        srcH = bmp.height; srcW = srcH * canvasAR;
        srcX = (bmp.width - srcW) * (S.focusY / 100);
      } else {
        // 元写真の方が縦長 → 上下をクロップ
        srcW = bmp.width; srcH = srcW / canvasAR;
        srcY = (bmp.height - srcH) * (S.focusY / 100);
      }
      cols = 1; rows = n;
    } else {
      // 横並びn枚: 全体カンバス比 rw×n : rh
      const canvasAR = (rw * n) / rh;
      const imgAR = bmp.width / bmp.height;
      if (imgAR > canvasAR) {
        srcH = bmp.height; srcW = srcH * canvasAR;
        srcX = (bmp.width - srcW) * 0.5; // 左右は中央
      } else {
        srcW = bmp.width; srcH = srcW / canvasAR;
        srcY = Math.max(0, (bmp.height - srcH)) * (S.focusY / 100); // 上下位置
      }
      cols = n; rows = 1;
    }
  } else {
    // 全部残す: 元画像全体を等分
    cols = horizontal ? n : 1;
    rows = horizontal ? 1 : n;
  }

  const cellSrcW = srcW / cols, cellSrcH = srcH / rows;
  const outW = S.outWidth === 'orig' ? Math.round(cellSrcW) : S.outWidth;
  const outH = Math.round(outW * cellSrcH / cellSrcW);

  const cells = [];
  const g = Math.min(S.gap, (Math.min(cellSrcW, cellSrcH) / 2) - 1);
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
function ratioCropDir() {
  // ratioモードでどっちを切るか ('v'=上下, 'h'=左右)
  if (!S.bitmap || S.style !== 'ratio') return 'v';
  const [rw, rh] = S.ratio;
  const n = S.pieces;
  const canvasAR = S.mode === 'rows' ? rw / (rh * n) : (rw * n) / rh;
  return (S.bitmap.width / S.bitmap.height) > canvasAR ? 'h' : 'v';
}
function updateFocusLabel() {
  const el = $('focusLabel');
  if (!el) return;
  el.textContent = ratioCropDir() === 'h'
    ? '左右位置: 写真のどの幅を見せるか（被写体がある位置へ）'
    : '上下位置: 写真のどの高さを切り出すか（顔などを見せたい位置へ）';
}
function render() {
  if (!S.bitmap) return;
  updateFocusLabel();
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

  // 並列生成（直列だとtoBlobエンコードが直列で遅い）
  S.results = await Promise.all(cells.map(async (cell) => {
    const cv = drawCell(cell);
    const blob = await canvasToBlob(cv);
    const name = `${S.fileName}_${String(cell.idx).padStart(2, '0')}.${EXT[S.format]}`;
    return { blob, name, w: cell.outW, h: cell.outH, url: URL.createObjectURL(blob) };
  }));

  // STEP2 寸法情報
  const c0 = cells[0];
  const count = S.results.length;
  const c0ar = c0.outW / c0.outH;
  const dAr0 = XSpec.displayAR(c0.outW, c0.outH, count);
  const mag = 1 / dAr0; // 1:1投稿に対するタイムライン高さの倍率
  const sizeNote = mag >= 1.45 ? 'タイムラインでかなり大きく表示されます 💪'
    : mag >= 1.15 ? 'タイムラインで大きめに表示されます'
    : mag >= 0.87 ? 'タイムラインで標準的な大きさです'
    : 'タイムラインでは小さめ・横長に表示されます';
  const c0crop = XSpec.cropPct(c0.outW, c0.outH, count);
  $('layoutDim').innerHTML =
    `各セル: <b>${c0.outW}×${c0.outH}（${ratioLabel(c0.outW, c0.outH)}）</b><br>${sizeNote}` +
    (c0crop.vertical > 0 ? `<br>⚠️ <b>上下 約${c0crop.vertical}%ずつ見切れます</b>（タップで全体表示）`
     : c0crop.side > 0 ? `<br>⚠️ <b>左右 約${c0crop.side}%ずつ見切れます</b>（タップで全体表示）` : '');
  $('orderHint').textContent = S.mode === 'carousel'
    ? `Xには 1 → ${'…'} → ${count} の順（左から）で添付してください`
    : `Xには 1 → ${'…'} → ${count} の順（上から）で添付してください`;

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
    // 見切れ帯（どの部分が隠れるか視覚化）
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
$('toPreviewBtn').addEventListener('click', () => {
  // 分割結果をプレビュータブへ（blob URL共有）
  PV.loadFromResults(S.results);
  document.querySelector('.main-tab[data-tab="preview"]').click();
  toast('分割結果をプレビューに渡しました！');
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════════════════
 * ビューア（タップ後の拡大表示 — 両タブ共通）
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
 * プレビューツール
 * ═══════════════════════════════════════════════════════════════ */
const PV = {
  photos: [],   // {id, name, url, w, h, size}
  textExpanded: false,

  async loadFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/')).slice(0, 4);
    if (!files.length) { toast('画像ファイルを選んでね'); return; }
    this.photos.forEach(p => URL.revokeObjectURL(p.url));
    this.photos = await Promise.all(files.map(f => new Promise((res, rej) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => res({ id: crypto.randomUUID(), name: f.name, url, w: img.naturalWidth, h: img.naturalHeight, size: f.size });
      img.onerror = rej;
      img.src = url;
    })));
    this.render();
    if (files.length) toast(`${files.length}枚を読み込みました`);
  },

  loadFromResults(results) {
    // 分割くんの結果をそのまま（url共有・revokeしない）
    this.photos = results.map((r, i) => ({
      id: 'split-' + i, name: r.name, url: r.url, w: r.w, h: r.h, size: r.blob.size,
    }));
    this.render();
  },

  move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.photos.length) return;
    const m = this.photos.splice(i, 1)[0];
    this.photos.splice(j, 0, m);
    this.render();
  },
  removeAt(i) {
    this.photos.splice(i, 1);
    this.render();
  },

  render() {
    const has = this.photos.length > 0;
    $('pvListPanel').style.display = has ? '' : 'none';
    $('pvTextPanel').style.display = has ? '' : 'none';
    $('pvSimPanel').style.display = has ? '' : 'none';
    if (!has) return;

    // 写真リスト
    const list = $('pvList');
    list.innerHTML = '';
    const count = this.photos.length;
    this.photos.forEach((p, i) => {
      const ar = p.w / p.h;
      const { side, vertical } = XSpec.cropPct(p.w, p.h, count);
      const note = side ? `⚠️ 左右 約${side}%ずつ見切れます` : vertical ? `⚠️ 上下 約${vertical}%ずつ見切れます` : '✅ 全体が表示されます';
      const row = document.createElement('div');
      row.className = 'photo-row';
      row.innerHTML = `
        <span class="grip" title="ドラッグで並べ替え">⠿</span>
        <img src="${p.url}" alt="${p.name}">
        <div class="info">
          <strong>${i + 1}枚目${i === 0 ? '（表示サイズを決める）' : ''}</strong>
          <small>${p.w} × ${p.h} · ${(p.size / 1048576).toFixed(1)}MB · ${ratioLabel(p.w, p.h)}</small>
          <em style="color:${side || vertical ? 'var(--warn)' : 'var(--success)'}">${note}</em>
        </div>
        <button class="mv" data-i="${i}" data-d="-1" title="前へ" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="mv" data-i="${i}" data-d="1" title="次へ" ${i === this.photos.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="rm" data-i="${i}" title="削除">✕</button>`;
      row.querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => this.move(i, +b.dataset.d)));
      row.querySelector('.rm').addEventListener('click', () => this.removeAt(i));
      list.appendChild(row);
    });

    // 投稿文（iruagaru互換: 公式twitter-text）
    this.renderText();
    // タイムラインシミュ
    this.renderTimeline();
  },

  renderText() {
    const TT = (window.TwitterText && (window.TwitterText.default || window.TwitterText)) || null;
    const text = $('pvText').value.normalize('NFC');
    const out = $('pvPostText');
    const counter = $('pvCounter');
    if (!TT) {
      out.textContent = text || '（投稿文なし）';
      counter.textContent = `${text.length} / 280（簡易カウント）`;
      return;
    }
    const parsed = TT.parseTweet(text);
    const weight = parsed.weightedLength;
    const isLong = weight > 280;
    if (isLong && !this.textExpanded) {
      const collapsed = text.slice(0, parsed.validRangeEnd + 1).trimEnd();
      out.textContent = collapsed;
      const btn = document.createElement('button');
      btn.className = 'text-toggle';
      btn.textContent = '… さらに表示';
      btn.onclick = () => { this.textExpanded = true; this.renderText(); };
      out.append(' ', btn);
    } else {
      out.textContent = text || '（投稿文なし）';
      if (isLong) {
        const btn = document.createElement('button');
        btn.className = 'text-toggle';
        btn.textContent = '表示を減らす';
        btn.onclick = () => { this.textExpanded = false; this.renderText(); };
        out.append(' ', btn);
      }
    }
    counter.textContent = `${weight.toLocaleString()} / 280（X換算）${isLong ? ' · 長文ポスト' : ''}`;
    counter.classList.toggle('over', isLong);
  },

  renderTimeline() {
    const media = $('pvMedia');
    media.innerHTML = '';
    const count = this.photos.length;
    if (!count) return;

    const W = media.clientWidth - 2 || 340; // 1カード幅

    if (count === 1) {
      // 1枚: 元比率そのまま（高さは素直に、フレーム側で見やすく）
      const p = this.photos[0];
      const d = document.createElement('button');
      d.className = 'cell';
      const h = Math.round(W / (p.w / p.h));
      d.style.cssText = `width:${W}px;height:${h}px;position:relative;overflow:hidden;border-radius:4px;`;
      d.innerHTML = `<img src="${p.url}" style="width:100%;height:100%;object-fit:cover;" alt="${p.name}">`;
      d.onclick = () => Viewer.open(this.photos, 0, 1);
      media.appendChild(d);
      return;
    }

    if (count === 2) {
      // 2枚: 横並び2分割（各0.5〜1.5クランプ、高さは比率合計から）
      const cl = this.photos.map(p => XSpec.displayAR(p.w, p.h, 2));
      const sum = cl[0] + cl[1];
      const h = Math.round((W - 2) / sum);
      const grid = document.createElement('div');
      grid.className = 'two-grid';
      grid.style.gridTemplateColumns = `${cl[0] / sum}fr ${cl[1] / sum}fr`;
      grid.style.height = h + 'px';
      this.photos.forEach((p, i) => {
        const cell = document.createElement('button');
        cell.className = 'cell';
        const raw = p.w / p.h;
        const note = Math.abs(raw - cl[i]) > 0.01 ? '<span class="idx">⚠️クロップ</span>' : '';
        cell.innerHTML = `<img src="${p.url}" style="width:100%;height:100%;object-fit:cover;" alt="${p.name}">${note}`;
        cell.onclick = () => Viewer.open(this.photos, i, 2);
        grid.appendChild(cell);
      });
      media.appendChild(grid);
      return;
    }

    // 3〜4枚: カルーセル（高さは1枚目のクランプ比）
    const first = this.photos[0];
    const firstAr = XSpec.displayAR(first.w, first.h, count);
    const cw = Math.min(W, 340);
    const h = Math.round(cw / firstAr);
    const car = document.createElement('div');
    car.className = 'carousel';
    const dots = document.createElement('div');
    dots.className = 'timeline-dots';
    dots.innerHTML = this.photos.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('');
    this.photos.forEach((p, i) => {
      const raw = p.w / p.h;
      const dAr = XSpec.displayAR(p.w, p.h, count);
      const wrap = document.createElement('button');
      wrap.className = 'cell';
      wrap.style.cssText = `width:${cw}px;height:${h}px;`;
      wrap.innerHTML = `<img src="${p.url}" style="width:100%;height:100%;object-fit:cover;" alt="${p.name}">
        <span class="idx">${i + 1}</span>${Math.abs(raw - dAr) > 0.01 ? '<span class="cropped">一部クロップ</span>' : ''}`;
      wrap.onclick = () => Viewer.open(this.photos, i, count);
      car.appendChild(wrap);
    });
    car.onscroll = () => {
      const i = Math.round(car.scrollLeft / (cw + 2));
      dots.querySelectorAll('span').forEach((s, j) => s.classList.toggle('on', j === i));
    };
    media.appendChild(car);
    media.appendChild(dots);
  },
};

/* ── プレビュー: イベント ──────────────── */
const pvDz = $('pvDropzone');
const pvFiles = $('pvFiles');
pvDz.addEventListener('click', () => pvFiles.click());
pvDz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pvFiles.click(); });
pvDz.addEventListener('dragover', (e) => { e.preventDefault(); pvDz.classList.add('dragover'); });
pvDz.addEventListener('dragleave', () => pvDz.classList.remove('dragover'));
pvDz.addEventListener('drop', (e) => {
  e.preventDefault(); pvDz.classList.remove('dragover');
  if (e.dataTransfer.files.length) PV.loadFiles(e.dataTransfer.files);
});
pvFiles.addEventListener('change', () => { if (pvFiles.files.length) PV.loadFiles(pvFiles.files); pvFiles.value = ''; });
$('pvText').addEventListener('input', () => { PV.textExpanded = false; PV.renderText(); });
window.addEventListener('resize', () => { if (!$('tabPreview').hidden) PV.renderTimeline(); if (S.results.length) render(); });

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
