/* ============================================================
   Visual Diff — 视觉对比工具
   ============================================================ */

(() => {
  'use strict';

  const state = {
    baseImg: null,
    compareImg: null,
    baseVisible: true,
    compareVisible: true,
    mode: 'overlay',
    tool: null,           // null|colorpicker|measure|mask|draw|text
    zoom: 1,
    panX: 0,
    panY: 0,
    opacity: 50,
    blendMode: 'normal',
    diffThreshold: 20,
    diffColor: '#ff0000',
    diffOnly: false,
    sliderPos: 0.5,
    masks: [],
    measurePoints: [],
    isPanning: false,
    spaceDown: false,
    dragStart: null,
    // image offset
    offsetX: 0,
    offsetY: 0,
    // drawing
    drawShape: 'rect',
    drawColor: '#ff4d4f',
    drawStroke: 2,
    drawings: [],         // [{type,x1,y1,x2,y2,color,stroke}]
    _drawDragging: false,
    // text annotations
    textContent: '标注',
    textSize: 16,
    textColor: '#ff4d4f',
    texts: [],            // [{text,x,y,size,color}]
    // cached image data for color picker
    _baseCanvasCache: null,
    _compCanvasCache: null,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const dom = {
    uploadOverlay: $('#uploadOverlay'),
    dropBase: $('#dropBase'),
    dropCompare: $('#dropCompare'),
    inputBase: $('#inputBase'),
    inputCompare: $('#inputCompare'),
    canvasContainer: $('#canvasContainer'),
    canvas: $('#mainCanvas'),
    canvasArea: $('#canvasArea'),
    sliderHandle: $('#sliderHandle'),
    measureOverlay: $('#measureOverlay'),
    maskOverlay: $('#maskOverlay'),
    drawOverlay: $('#drawOverlay'),
    textOverlay: $('#textOverlay'),
    pickerCrosshair: $('#pickerCrosshair'),
    opacitySlider: $('#opacitySlider'),
    opacityVal: $('#opacityVal'),
    blendMode: $('#blendMode'),
    diffThreshold: $('#diffThreshold'),
    thresholdVal: $('#thresholdVal'),
    diffColor: $('#diffColor'),
    diffOnly: $('#diffOnly'),
    zoomLabel: $('#zoomLabel'),
    infoCoords: $('#infoCoords'),
    infoBaseSize: $('#infoBaseSize'),
    infoCompSize: $('#infoCompSize'),
    diffPixelCount: $('#diffPixelCount'),
    diffPercent: $('#diffPercent'),
    toast: $('#toast'),
    overlayControls: $('#overlayControls'),
    offsetControls: $('#offsetControls'),
    diffControls: $('#diffControls'),
    maskControls: $('#maskControls'),
    drawControls: $('#drawControls'),
    textControls: $('#textControls'),
    colorPickerPanel: $('#colorPickerPanel'),
    measurePanel: $('#measurePanel'),
    swatchBase: $('#swatchBase'),
    swatchCompare: $('#swatchCompare'),
    hexBase: $('#hexBase'),
    hexCompare: $('#hexCompare'),
    colorDiffRow: $('#colorDiffRow'),
    colorDeltaE: $('#colorDeltaE'),
    measureX: $('#measureX'),
    measureY: $('#measureY'),
    measureDist: $('#measureDist'),
    layerBase: $('#layerBase'),
    layerCompare: $('#layerCompare'),
    layerBaseName: $('#layerBaseName'),
    layerCompareName: $('#layerCompareName'),
  };

  const ctx = dom.canvas.getContext('2d', { willReadFrequently: true });

  // ─── Utilities ──────────────────────────────────────────
  function showToast(msg, ms = 2000) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => dom.toast.classList.remove('show'), ms);
  }

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function colorDeltaE(r1, g1, b1, r2, g2, b2) {
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ─── Image Cache for Color Picker ─────────────────────
  function cacheImageData(img) {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, img.width, img.height);
  }

  function rebuildImageCaches() {
    state._baseCanvasCache = cacheImageData(state.baseImg);
    state._compCanvasCache = cacheImageData(state.compareImg);
  }

  function getPixelFromCache(imgData, px, py) {
    if (!imgData || px < 0 || py < 0 || px >= imgData.width || py >= imgData.height) return null;
    const i = (py * imgData.width + px) * 4;
    return { r: imgData.data[i], g: imgData.data[i + 1], b: imgData.data[i + 2], a: imgData.data[i + 3] };
  }

  // ─── Image Loading ─────────────────────────────────────
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setupDropZone(zone, input, isBase) {
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
      if (e.target.files[0]) {
        const img = await loadImage(e.target.files[0]);
        setImage(img, isBase, e.target.files[0].name);
      }
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        const img = await loadImage(file);
        setImage(img, isBase, file.name);
      }
    });
  }

  function setImage(img, isBase, name = '') {
    if (isBase) {
      state.baseImg = img;
      dom.dropBase.classList.add('loaded');
      dom.dropBase.querySelector('h3').textContent = '✓ 底图已加载';
      dom.dropBase.querySelector('p').textContent = `${img.width}×${img.height}`;
      dom.infoBaseSize.textContent = `${img.width}×${img.height}`;
      if (name) dom.layerBaseName.textContent = name;
    } else {
      state.compareImg = img;
      dom.dropCompare.classList.add('loaded');
      dom.dropCompare.querySelector('h3').textContent = '✓ 顶图已加载';
      dom.dropCompare.querySelector('p').textContent = `${img.width}×${img.height}`;
      dom.infoCompSize.textContent = `${img.width}×${img.height}`;
      if (name) dom.layerCompareName.textContent = name;
    }
    rebuildImageCaches();
    if (state.baseImg && state.compareImg) {
      startComparison();
    } else if (state.baseImg || state.compareImg) {
      dom.canvasContainer.style.display = 'block';
      fitView();
      render();
    }
  }

  function startComparison() {
    dom.uploadOverlay.style.display = 'none';
    dom.canvasContainer.style.display = 'block';
    fitView();
    render();
    showToast('图片已加载，可以开始对比');
  }

  // ─── Clipboard Paste ───────────────────────────────────
  document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const img = await loadImage(file);
        if (!state.baseImg) {
          setImage(img, true, '粘贴的图片');
        } else {
          setImage(img, false, '粘贴的图片');
          if (state.compareImg) showToast('已替换顶图');
        }
        return;
      }
    }
  });

  // ─── Canvas Size & View ─────────────────────────────────
  function getCanvasSize() {
    const bw = state.baseImg?.width || 0;
    const bh = state.baseImg?.height || 0;
    const cw = state.compareImg?.width || 0;
    const ch = state.compareImg?.height || 0;
    const ox = Math.abs(state.offsetX);
    const oy = Math.abs(state.offsetY);
    return {
      w: Math.max(bw, cw + ox),
      h: Math.max(bh, ch + oy)
    };
  }

  function fitView() {
    const { w, h } = getCanvasSize();
    if (!w || !h) return;
    const areaW = dom.canvasArea.clientWidth;
    const areaH = dom.canvasArea.clientHeight;
    const scaleW = state.mode === 'sidebyside' ? (areaW - 24) / (w * 2 + 20) : (areaW - 48) / w;
    const scaleH = (areaH - 48) / h;
    state.zoom = Math.min(scaleW, scaleH, 1);
    state.panX = (areaW - w * state.zoom * (state.mode === 'sidebyside' ? 2.05 : 1)) / 2;
    state.panY = (areaH - h * state.zoom) / 2;
    updateZoomLabel();
    applyTransform();
    render();
  }

  function applyTransform() {
    dom.canvasContainer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }

  function updateZoomLabel() {
    dom.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
  }

  // ─── Render ─────────────────────────────────────────────
  function render() {
    const { w, h } = getCanvasSize();
    if (!w || !h) return;

    switch (state.mode) {
      case 'overlay': renderOverlay(w, h); break;
      case 'slider': renderSlider(w, h); break;
      case 'diff': renderDiff(w, h); break;
      case 'sidebyside': renderSideBySide(w, h); break;
    }

    renderMasks();
    renderMeasurements();
    renderDrawings();
    renderTexts();
  }

  function compareDrawPos() {
    return { x: Math.max(0, state.offsetX), y: Math.max(0, state.offsetY) };
  }

  function renderOverlay(w, h) {
    dom.canvas.width = w;
    dom.canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    if (state.baseImg && state.baseVisible) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(state.baseImg, 0, 0);
    }

    if (state.compareImg && state.compareVisible) {
      const { x, y } = compareDrawPos();
      ctx.globalAlpha = state.opacity / 100;
      ctx.globalCompositeOperation = state.blendMode;
      ctx.drawImage(state.compareImg, x, y);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function renderSlider(w, h) {
    dom.canvas.width = w;
    dom.canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    const splitX = Math.round(w * state.sliderPos);

    if (state.baseImg && state.baseVisible) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, h);
      ctx.clip();
      ctx.drawImage(state.baseImg, 0, 0);
      ctx.restore();
    }

    if (state.compareImg && state.compareVisible) {
      const { x, y } = compareDrawPos();
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, w - splitX, h);
      ctx.clip();
      ctx.drawImage(state.compareImg, x, y);
      ctx.restore();
    }

    dom.sliderHandle.style.left = splitX + 'px';
  }

  function renderDiff(w, h) {
    dom.canvas.width = w;
    dom.canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    if (!state.baseImg || !state.compareImg) {
      if (state.baseImg) ctx.drawImage(state.baseImg, 0, 0);
      if (state.compareImg) ctx.drawImage(state.compareImg, 0, 0);
      return;
    }

    const tc1 = document.createElement('canvas');
    tc1.width = w; tc1.height = h;
    const tx1 = tc1.getContext('2d', { willReadFrequently: true });
    tx1.drawImage(state.baseImg, 0, 0);
    const d1 = tx1.getImageData(0, 0, w, h);

    const tc2 = document.createElement('canvas');
    tc2.width = w; tc2.height = h;
    const tx2 = tc2.getContext('2d', { willReadFrequently: true });
    const { x: ox, y: oy } = compareDrawPos();
    tx2.drawImage(state.compareImg, ox, oy);
    const d2 = tx2.getImageData(0, 0, w, h);

    const output = ctx.createImageData(w, h);
    const [hr, hg, hb] = hexToRgb(state.diffColor);
    const threshold = state.diffThreshold;
    let diffCount = 0;
    const totalPixels = w * h;
    const hasMasks = state.masks.length > 0;

    for (let i = 0; i < d1.data.length; i += 4) {
      if (hasMasks) {
        const pidx = i / 4;
        if (isPointMasked(pidx % w, Math.floor(pidx / w))) {
          output.data[i] = d1.data[i];
          output.data[i + 1] = d1.data[i + 1];
          output.data[i + 2] = d1.data[i + 2];
          output.data[i + 3] = 80;
          continue;
        }
      }

      const r1 = d1.data[i], g1 = d1.data[i + 1], b1 = d1.data[i + 2];
      const r2 = d2.data[i], g2 = d2.data[i + 1], b2 = d2.data[i + 2];
      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

      if (diff > threshold) {
        diffCount++;
        output.data[i] = hr; output.data[i + 1] = hg; output.data[i + 2] = hb; output.data[i + 3] = 200;
      } else if (!state.diffOnly) {
        output.data[i] = r1; output.data[i + 1] = g1; output.data[i + 2] = b1; output.data[i + 3] = 255;
      } else {
        output.data[i + 3] = 0;
      }
    }

    ctx.putImageData(output, 0, 0);
    dom.diffPixelCount.textContent = diffCount.toLocaleString();
    dom.diffPercent.textContent = (diffCount / totalPixels * 100).toFixed(2) + '%';
  }

  function renderSideBySide(w, h) {
    const gap = 20;
    dom.canvas.width = w * 2 + gap;
    dom.canvas.height = h;
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    if (state.baseImg && state.baseVisible) ctx.drawImage(state.baseImg, 0, 0);
    ctx.fillStyle = '#1677ff';
    ctx.fillRect(w + (gap - 2) / 2, 0, 2, h);
    if (state.compareImg && state.compareVisible) ctx.drawImage(state.compareImg, w + gap, 0);
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('设计稿 (A)', 8, 22);
    ctx.fillText('实现 (B)', w + gap + 8, 22);
  }

  // ─── Mask ───────────────────────────────────────────────
  function isPointMasked(px, py) {
    return state.masks.some(m => px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h);
  }

  function renderMasks() {
    dom.maskOverlay.innerHTML = '';
    if (state.masks.length === 0) return;
    setSvgViewBox(dom.maskOverlay);
    dom.maskOverlay.style.display = 'block';
    state.masks.forEach(m => {
      const rect = svgEl('rect', { x: m.x, y: m.y, width: m.w, height: m.h, fill: 'rgba(0,0,0,0.7)', stroke: '#ff4d4f', 'stroke-width': 1, 'stroke-dasharray': '4 2' });
      dom.maskOverlay.appendChild(rect);
    });
  }

  // ─── Drawings ───────────────────────────────────────────
  function renderDrawings() {
    dom.drawOverlay.innerHTML = '';
    if (state.drawings.length === 0 && !state._drawDragging) {
      dom.drawOverlay.style.display = 'none';
      return;
    }
    setSvgViewBox(dom.drawOverlay);
    dom.drawOverlay.style.display = 'block';
    state.drawings.forEach(d => dom.drawOverlay.appendChild(createShapeEl(d)));
  }

  function createShapeEl(d) {
    const s = d.stroke;
    const c = d.color;
    switch (d.type) {
      case 'rect': {
        const x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2);
        const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
        return svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: c, 'stroke-width': s, rx: 2 });
      }
      case 'circle': {
        const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
        const rx = Math.abs(d.x2 - d.x1) / 2, ry = Math.abs(d.y2 - d.y1) / 2;
        return svgEl('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: c, 'stroke-width': s });
      }
      case 'line':
        return svgEl('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, stroke: c, 'stroke-width': s, 'stroke-linecap': 'round' });
      case 'arrow': {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.appendChild(svgEl('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, stroke: c, 'stroke-width': s, 'stroke-linecap': 'round' }));
        const angle = Math.atan2(d.y2 - d.y1, d.x2 - d.x1);
        const headLen = 12;
        const a1x = d.x2 - headLen * Math.cos(angle - Math.PI / 6);
        const a1y = d.y2 - headLen * Math.sin(angle - Math.PI / 6);
        const a2x = d.x2 - headLen * Math.cos(angle + Math.PI / 6);
        const a2y = d.y2 - headLen * Math.sin(angle + Math.PI / 6);
        g.appendChild(svgEl('polygon', { points: `${d.x2},${d.y2} ${a1x},${a1y} ${a2x},${a2y}`, fill: c }));
        return g;
      }
    }
    return svgEl('g', {});
  }

  // ─── Text Annotations ──────────────────────────────────
  function renderTexts() {
    dom.textOverlay.innerHTML = '';
    if (state.texts.length === 0) {
      dom.textOverlay.style.display = 'none';
      return;
    }
    setSvgViewBox(dom.textOverlay);
    dom.textOverlay.style.display = 'block';
    state.texts.forEach(t => {
      const bg = svgEl('rect', {
        x: t.x - 4, y: t.y - t.size, width: t.text.length * t.size * 0.7 + 8, height: t.size + 8,
        rx: 3, fill: 'rgba(0,0,0,0.6)'
      });
      dom.textOverlay.appendChild(bg);
      const el = svgEl('text', {
        x: t.x, y: t.y, fill: t.color, 'font-size': t.size,
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-weight': '600'
      });
      el.textContent = t.text;
      dom.textOverlay.appendChild(el);
    });
  }

  // ─── SVG Helpers ────────────────────────────────────────
  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function setSvgViewBox(svgEl) {
    svgEl.setAttribute('viewBox', `0 0 ${dom.canvas.width} ${dom.canvas.height}`);
    svgEl.style.width = dom.canvas.width + 'px';
    svgEl.style.height = dom.canvas.height + 'px';
  }

  // ─── Measurement Rendering ──────────────────────────────
  function renderMeasurements() {
    dom.measureOverlay.innerHTML = '';
    if (state.measurePoints.length === 0) return;
    setSvgViewBox(dom.measureOverlay);
    dom.measureOverlay.style.display = 'block';

    state.measurePoints.forEach(p => {
      dom.measureOverlay.appendChild(svgEl('circle', {
        cx: p.x, cy: p.y, r: 4 / state.zoom,
        fill: '#1677ff', stroke: '#fff', 'stroke-width': 1 / state.zoom
      }));
    });

    if (state.measurePoints.length === 2) {
      const [p1, p2] = state.measurePoints;
      dom.measureOverlay.appendChild(svgEl('line', {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p1.y,
        stroke: '#52c41a', 'stroke-width': 1 / state.zoom, 'stroke-dasharray': `${3 / state.zoom} ${2 / state.zoom}`
      }));
      dom.measureOverlay.appendChild(svgEl('line', {
        x1: p2.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: '#fa8c16', 'stroke-width': 1 / state.zoom, 'stroke-dasharray': `${3 / state.zoom} ${2 / state.zoom}`
      }));
      dom.measureOverlay.appendChild(svgEl('line', {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: '#1677ff', 'stroke-width': 1.5 / state.zoom
      }));

      const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const fs = 12 / state.zoom;

      function addLabel(x, y, text, color) {
        dom.measureOverlay.appendChild(svgEl('rect', {
          x: x - 2 / state.zoom, y: y - fs, width: text.length * fs * 0.65, height: fs + 4 / state.zoom,
          rx: 2 / state.zoom, fill: 'rgba(0,0,0,0.7)'
        }));
        const label = svgEl('text', { x, y, fill: color, 'font-size': fs, 'font-family': 'SF Mono, Menlo, monospace' });
        label.textContent = text;
        dom.measureOverlay.appendChild(label);
      }

      addLabel((p1.x + p2.x) / 2, p1.y - 6 / state.zoom, `${Math.round(dx)}px`, '#52c41a');
      addLabel(p2.x + 6 / state.zoom, (p1.y + p2.y) / 2, `${Math.round(dy)}px`, '#fa8c16');
      addLabel((p1.x + p2.x) / 2, (p1.y + p2.y) / 2 + fs + 6 / state.zoom, `${Math.round(dist)}px`, '#1677ff');

      dom.measureX.textContent = Math.round(dx) + 'px';
      dom.measureY.textContent = Math.round(dy) + 'px';
      dom.measureDist.textContent = Math.round(dist) + 'px';
    }
  }

  // ─── Coordinate Helpers ────────────────────────────────
  function screenToCanvas(clientX, clientY) {
    const rect = dom.canvasArea.getBoundingClientRect();
    const x = (clientX - rect.left - state.panX) / state.zoom;
    const y = (clientY - rect.top - state.panY) / state.zoom;
    return { x: Math.round(x), y: Math.round(y) };
  }

  // ─── Mode Switching ────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    $$('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    dom.overlayControls.style.display = (mode === 'overlay') ? '' : 'none';
    dom.diffControls.style.display = (mode === 'diff') ? '' : 'none';
    dom.sliderHandle.style.display = (mode === 'slider') ? '' : 'none';
    if (state.baseImg || state.compareImg) fitView();
  }

  function setTool(tool) {
    state.tool = (state.tool === tool) ? null : tool;

    $('#btnColorPicker').classList.toggle('active', state.tool === 'colorpicker');
    $('#btnMeasure').classList.toggle('active', state.tool === 'measure');
    $('#btnMask').classList.toggle('active', state.tool === 'mask');
    $('#btnDraw').classList.toggle('active', state.tool === 'draw');
    $('#btnText').classList.toggle('active', state.tool === 'text');

    dom.colorPickerPanel.style.display = state.tool === 'colorpicker' ? '' : 'none';
    dom.measurePanel.style.display = state.tool === 'measure' ? '' : 'none';
    dom.maskControls.style.display = state.tool === 'mask' ? '' : 'none';
    dom.drawControls.style.display = state.tool === 'draw' ? '' : 'none';
    dom.textControls.style.display = state.tool === 'text' ? '' : 'none';

    dom.pickerCrosshair.style.display = 'none';
    dom.maskOverlay.style.display = state.masks.length ? 'block' : 'none';
    dom.measureOverlay.style.display = state.measurePoints.length ? 'block' : 'none';

    const cursorTools = ['colorpicker', 'measure', 'mask', 'draw', 'text'];
    dom.canvasArea.style.cursor = cursorTools.includes(state.tool) ? 'crosshair' : (state.spaceDown ? 'grab' : 'default');

    if (state.tool === 'measure') {
      state.measurePoints = [];
      renderMeasurements();
    }
  }

  // ─── Pan & Zoom ────────────────────────────────────────
  dom.canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = dom.canvasArea.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = clamp(state.zoom * factor, 0.05, 20);
    const ratio = newZoom / state.zoom;
    state.panX = mx - (mx - state.panX) * ratio;
    state.panY = my - (my - state.panY) * ratio;
    state.zoom = newZoom;
    updateZoomLabel();
    applyTransform();
  }, { passive: false });

  // ─── Mouse Interactions ─────────────────────────────────
  dom.canvasArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    if (state.spaceDown) {
      state.isPanning = true;
      state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      dom.canvasArea.style.cursor = 'grabbing';
      return;
    }

    const pos = screenToCanvas(e.clientX, e.clientY);

    // Color picker
    if (state.tool === 'colorpicker') {
      handleColorPick(pos, e.clientX, e.clientY);
      return;
    }

    // Measure
    if (state.tool === 'measure') {
      if (state.measurePoints.length >= 2) state.measurePoints = [];
      state.measurePoints.push(pos);
      renderMeasurements();
      if (state.measurePoints.length === 1) showToast('已设置起点，点击第二个点完成测量');
      return;
    }

    // Mask
    if (state.tool === 'mask') {
      state.dragStart = { x: pos.x, y: pos.y };
      state._maskDragging = true;
      return;
    }

    // Draw
    if (state.tool === 'draw') {
      state.dragStart = { x: pos.x, y: pos.y };
      state._drawDragging = true;
      return;
    }

    // Text
    if (state.tool === 'text') {
      const text = $('#textContent').value || '标注';
      const size = parseInt($('#textSize').value) || 16;
      const color = $('#textColor').value;
      state.texts.push({ text, x: pos.x, y: pos.y, size, color });
      renderTexts();
      showToast(`已添加文字「${text}」`);
      return;
    }

    // Slider
    if (state.mode === 'slider') {
      state._sliderDragging = true;
      updateSliderPos(e.clientX);
      return;
    }

    // Default pan
    state.isPanning = true;
    state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
    dom.canvasArea.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (state.baseImg || state.compareImg) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      dom.infoCoords.textContent = `${pos.x}, ${pos.y}`;

      // Live color picker crosshair
      if (state.tool === 'colorpicker' && dom.canvasContainer.style.display !== 'none') {
        const rect = dom.canvasArea.getBoundingClientRect();
        const lx = e.clientX - rect.left;
        const ly = e.clientY - rect.top;
        dom.pickerCrosshair.style.display = 'block';
        dom.pickerCrosshair.style.left = (state.panX + pos.x * state.zoom) + 'px';
        dom.pickerCrosshair.style.top = (state.panY + pos.y * state.zoom) + 'px';

        // Live color preview on crosshair
        const c = getPixelFromCache(state._baseCanvasCache, pos.x, pos.y)
               || getPixelFromCache(state._compCanvasCache, pos.x, pos.y);
        if (c) {
          const hex = rgbToHex(c.r, c.g, c.b);
          dom.pickerCrosshair.style.borderColor = hex;
          let swatch = dom.pickerCrosshair.querySelector('.picker-swatch');
          if (!swatch) {
            swatch = document.createElement('div');
            swatch.className = 'picker-swatch';
            dom.pickerCrosshair.appendChild(swatch);
          }
          swatch.style.background = hex;
        }
      }
    }

    if (state.isPanning && state.dragStart) {
      state.panX = e.clientX - state.dragStart.x;
      state.panY = e.clientY - state.dragStart.y;
      applyTransform();
      return;
    }

    if (state._sliderDragging) {
      updateSliderPos(e.clientX);
      return;
    }

    if (state._maskDragging && state.dragStart) {
      handleMaskDrag(e);
      return;
    }

    if (state._drawDragging && state.dragStart) {
      handleDrawDrag(e);
      return;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (state.isPanning) {
      state.isPanning = false;
      const cursorTools = ['colorpicker', 'measure', 'mask', 'draw', 'text'];
      dom.canvasArea.style.cursor = cursorTools.includes(state.tool) ? 'crosshair' : 'default';
    }

    if (state._sliderDragging) state._sliderDragging = false;

    if (state._maskDragging && state.dragStart) {
      state._maskDragging = false;
      const pos = screenToCanvas(e.clientX, e.clientY);
      const x = Math.min(state.dragStart.x, pos.x), y = Math.min(state.dragStart.y, pos.y);
      const w = Math.abs(pos.x - state.dragStart.x), h = Math.abs(pos.y - state.dragStart.y);
      if (w > 3 && h > 3) {
        state.masks.push({ x, y, w, h });
        showToast(`已添加遮盖区域 (${w}×${h})`);
      }
      state.dragStart = null;
      renderMasks();
    }

    if (state._drawDragging && state.dragStart) {
      state._drawDragging = false;
      const pos = screenToCanvas(e.clientX, e.clientY);
      const dx = Math.abs(pos.x - state.dragStart.x), dy = Math.abs(pos.y - state.dragStart.y);
      if (dx > 3 || dy > 3) {
        state.drawings.push({
          type: state.drawShape,
          x1: state.dragStart.x, y1: state.dragStart.y,
          x2: pos.x, y2: pos.y,
          color: state.drawColor, stroke: state.drawStroke
        });
        showToast(`已添加${shapeLabel(state.drawShape)}`);
      }
      state.dragStart = null;
      renderDrawings();
    }
  });

  function shapeLabel(type) {
    return { rect: '矩形', circle: '椭圆', line: '直线', arrow: '箭头' }[type] || '图形';
  }

  // ─── Color Picker Handler ──────────────────────────────
  function handleColorPick(pos, clientX, clientY) {
    const cBase = getPixelFromCache(state._baseCanvasCache, pos.x, pos.y);
    const cComp = getPixelFromCache(state._compCanvasCache, pos.x, pos.y);

    let picked = false;
    if (cBase) {
      const hex = rgbToHex(cBase.r, cBase.g, cBase.b);
      dom.swatchBase.style.background = hex;
      dom.hexBase.textContent = hex;
      picked = true;
    }
    if (cComp) {
      const hex = rgbToHex(cComp.r, cComp.g, cComp.b);
      dom.swatchCompare.style.background = hex;
      dom.hexCompare.textContent = hex;
      picked = true;
    }
    if (cBase && cComp) {
      const de = colorDeltaE(cBase.r, cBase.g, cBase.b, cComp.r, cComp.g, cComp.b);
      dom.colorDiffRow.style.display = '';
      dom.colorDeltaE.textContent = de.toFixed(1);
      dom.colorDeltaE.style.color = de < 10 ? '#52c41a' : de < 30 ? '#fa8c16' : '#ff4d4f';
    }

    if (picked) {
      const hex = cBase ? rgbToHex(cBase.r, cBase.g, cBase.b) : rgbToHex(cComp.r, cComp.g, cComp.b);
      showToast(`取色: ${hex}  @ (${pos.x}, ${pos.y})`);
    }
  }

  // ─── Mask Drag Handler ─────────────────────────────────
  function handleMaskDrag(e) {
    const pos = screenToCanvas(e.clientX, e.clientY);
    const x = Math.min(state.dragStart.x, pos.x), y = Math.min(state.dragStart.y, pos.y);
    const w = Math.abs(pos.x - state.dragStart.x), h = Math.abs(pos.y - state.dragStart.y);
    renderMasks();
    setSvgViewBox(dom.maskOverlay);
    dom.maskOverlay.style.display = 'block';
    dom.maskOverlay.appendChild(svgEl('rect', {
      x, y, width: w, height: h,
      fill: 'rgba(0,0,0,0.5)', stroke: '#1677ff', 'stroke-width': 2
    }));
  }

  // ─── Draw Drag Handler ─────────────────────────────────
  function handleDrawDrag(e) {
    const pos = screenToCanvas(e.clientX, e.clientY);
    renderDrawings();
    setSvgViewBox(dom.drawOverlay);
    dom.drawOverlay.style.display = 'block';
    const tempShape = {
      type: state.drawShape,
      x1: state.dragStart.x, y1: state.dragStart.y,
      x2: pos.x, y2: pos.y,
      color: state.drawColor, stroke: state.drawStroke
    };
    dom.drawOverlay.appendChild(createShapeEl(tempShape));
  }

  function updateSliderPos(clientX) {
    const rect = dom.canvasArea.getBoundingClientRect();
    const { w } = getCanvasSize();
    const canvasX = (clientX - rect.left - state.panX) / state.zoom;
    state.sliderPos = clamp(canvasX / w, 0, 1);
    render();
  }

  dom.sliderHandle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    state._sliderDragging = true;
  });

  // ─── Keyboard Shortcuts ────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      state.spaceDown = true;
      dom.canvasArea.style.cursor = 'grab';
      return;
    }

    // Ctrl+Z / Cmd+Z = undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undoLast();
      return;
    }

    switch (e.key) {
      case '1': setMode('overlay'); break;
      case '2': setMode('slider'); break;
      case '3': setMode('diff'); break;
      case '4': setMode('sidebyside'); break;
      case 'c': case 'C': setTool('colorpicker'); break;
      case 'm': case 'M': setTool('measure'); break;
      case 'k': case 'K': setTool('mask'); break;
      case 'd': case 'D': setTool('draw'); break;
      case 't': case 'T': setTool('text'); break;
      case '0': fitView(); break;
      case '=': case '+': zoomIn(); break;
      case '-': zoomOut(); break;
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.spaceDown = false;
      const cursorTools = ['colorpicker', 'measure', 'mask', 'draw', 'text'];
      dom.canvasArea.style.cursor = cursorTools.includes(state.tool) ? 'crosshair' : 'default';
    }
  });

  function undoLast() {
    if (state.tool === 'draw' && state.drawings.length) {
      state.drawings.pop();
      renderDrawings();
      showToast('已撤销图形');
    } else if (state.tool === 'text' && state.texts.length) {
      state.texts.pop();
      renderTexts();
      showToast('已撤销文字');
    } else if (state.tool === 'mask' && state.masks.length) {
      state.masks.pop();
      renderMasks();
      showToast('已撤销遮盖');
    } else if (state.drawings.length) {
      state.drawings.pop();
      renderDrawings();
      showToast('已撤销图形');
    } else if (state.texts.length) {
      state.texts.pop();
      renderTexts();
      showToast('已撤销文字');
    }
  }

  function zoomIn() {
    const areaRect = dom.canvasArea.getBoundingClientRect();
    const mx = areaRect.width / 2, my = areaRect.height / 2;
    const newZoom = clamp(state.zoom * 1.25, 0.05, 20);
    const ratio = newZoom / state.zoom;
    state.panX = mx - (mx - state.panX) * ratio;
    state.panY = my - (my - state.panY) * ratio;
    state.zoom = newZoom;
    updateZoomLabel();
    applyTransform();
  }

  function zoomOut() {
    const areaRect = dom.canvasArea.getBoundingClientRect();
    const mx = areaRect.width / 2, my = areaRect.height / 2;
    const newZoom = clamp(state.zoom * 0.8, 0.05, 20);
    const ratio = newZoom / state.zoom;
    state.panX = mx - (mx - state.panX) * ratio;
    state.panY = my - (my - state.panY) * ratio;
    state.zoom = newZoom;
    updateZoomLabel();
    applyTransform();
  }

  // ─── Event Bindings ────────────────────────────────────
  $$('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  $('#btnColorPicker').addEventListener('click', () => setTool('colorpicker'));
  $('#btnMeasure').addEventListener('click', () => setTool('measure'));
  $('#btnMask').addEventListener('click', () => setTool('mask'));
  $('#btnDraw').addEventListener('click', () => setTool('draw'));
  $('#btnText').addEventListener('click', () => setTool('text'));
  $('#btnZoomIn').addEventListener('click', zoomIn);
  $('#btnZoomOut').addEventListener('click', zoomOut);
  $('#btnFitView').addEventListener('click', fitView);

  // Opacity
  dom.opacitySlider.addEventListener('input', (e) => {
    state.opacity = parseInt(e.target.value);
    dom.opacityVal.textContent = state.opacity + '%';
    render();
  });

  dom.blendMode.addEventListener('change', (e) => { state.blendMode = e.target.value; render(); });

  // Diff controls
  dom.diffThreshold.addEventListener('input', (e) => {
    state.diffThreshold = parseInt(e.target.value);
    dom.thresholdVal.textContent = state.diffThreshold;
    render();
  });
  dom.diffColor.addEventListener('input', (e) => { state.diffColor = e.target.value; render(); });
  dom.diffOnly.addEventListener('change', (e) => { state.diffOnly = e.target.checked; render(); });

  // Offset controls
  $('#offsetXSlider').addEventListener('input', (e) => {
    state.offsetX = parseInt(e.target.value);
    $('#offsetXVal').textContent = state.offsetX + 'px';
    render();
  });
  $('#offsetYSlider').addEventListener('input', (e) => {
    state.offsetY = parseInt(e.target.value);
    $('#offsetYVal').textContent = state.offsetY + 'px';
    render();
  });
  $('#resetOffset').addEventListener('click', () => {
    state.offsetX = 0; state.offsetY = 0;
    $('#offsetXSlider').value = 0; $('#offsetYSlider').value = 0;
    $('#offsetXVal').textContent = '0px'; $('#offsetYVal').textContent = '0px';
    render();
    showToast('已重置偏移');
  });

  // Layer toggles
  $('#toggleBase').addEventListener('click', (e) => {
    e.stopPropagation();
    state.baseVisible = !state.baseVisible;
    dom.layerBase.classList.toggle('hidden', !state.baseVisible);
    render();
  });
  $('#toggleCompare').addEventListener('click', (e) => {
    e.stopPropagation();
    state.compareVisible = !state.compareVisible;
    dom.layerCompare.classList.toggle('hidden', !state.compareVisible);
    render();
  });

  // Mask controls
  $('#clearMasks').addEventListener('click', () => { state.masks = []; renderMasks(); showToast('遮盖已清除'); });

  // Draw controls
  $$('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.drawShape = btn.dataset.shape;
    });
  });
  $('#drawColor').addEventListener('input', (e) => state.drawColor = e.target.value);
  $('#drawStroke').addEventListener('input', (e) => {
    state.drawStroke = parseInt(e.target.value);
    $('#drawStrokeVal').textContent = e.target.value + 'px';
  });
  $('#undoDraw').addEventListener('click', () => { if (state.drawings.length) { state.drawings.pop(); renderDrawings(); showToast('已撤销'); } });
  $('#clearDrawings').addEventListener('click', () => { state.drawings = []; renderDrawings(); showToast('图形已清除'); });

  // Text controls
  $('#textContent').addEventListener('input', (e) => state.textContent = e.target.value);
  $('#textSize').addEventListener('input', (e) => {
    state.textSize = parseInt(e.target.value);
    $('#textSizeVal').textContent = e.target.value + 'px';
  });
  $('#textColor').addEventListener('input', (e) => state.textColor = e.target.value);
  $('#undoText').addEventListener('click', () => { if (state.texts.length) { state.texts.pop(); renderTexts(); showToast('已撤销'); } });
  $('#clearTexts').addEventListener('click', () => { state.texts = []; renderTexts(); showToast('文字已清除'); });

  // Color hex copy
  dom.hexBase.addEventListener('click', () => {
    if (dom.hexBase.textContent !== '-') {
      navigator.clipboard.writeText(dom.hexBase.textContent);
      showToast('已复制: ' + dom.hexBase.textContent);
    }
  });
  dom.hexCompare.addEventListener('click', () => {
    if (dom.hexCompare.textContent !== '-') {
      navigator.clipboard.writeText(dom.hexCompare.textContent);
      showToast('已复制: ' + dom.hexCompare.textContent);
    }
  });

  // Swap images
  $('#swapImages').addEventListener('click', () => {
    [state.baseImg, state.compareImg] = [state.compareImg, state.baseImg];
    const bn = dom.layerBaseName.textContent, cn = dom.layerCompareName.textContent;
    dom.layerBaseName.textContent = cn;
    dom.layerCompareName.textContent = bn;
    if (state.baseImg) dom.infoBaseSize.textContent = `${state.baseImg.width}×${state.baseImg.height}`;
    if (state.compareImg) dom.infoCompSize.textContent = `${state.compareImg.width}×${state.compareImg.height}`;
    rebuildImageCaches();
    render();
    showToast('已交换底图和顶图');
  });

  // Export
  $('#exportDiff').addEventListener('click', () => {
    if (!dom.canvas.width) return showToast('暂无可导出内容');
    const link = document.createElement('a');
    link.download = `visual-diff-${Date.now()}.png`;
    link.href = dom.canvas.toDataURL('image/png');
    link.click();
    showToast('已导出对比结果');
  });

  // Reset
  $('#resetAll').addEventListener('click', () => {
    state.baseImg = null; state.compareImg = null;
    state.masks = []; state.measurePoints = []; state.drawings = []; state.texts = [];
    state.offsetX = 0; state.offsetY = 0;
    state._baseCanvasCache = null; state._compCanvasCache = null;
    dom.uploadOverlay.style.display = '';
    dom.canvasContainer.style.display = 'none';
    dom.dropBase.classList.remove('loaded');
    dom.dropCompare.classList.remove('loaded');
    dom.dropBase.querySelector('h3').textContent = '底图（设计稿）';
    dom.dropBase.querySelector('p').textContent = '拖拽图片到此处或点击上传';
    dom.dropCompare.querySelector('h3').textContent = '顶图（实现截图）';
    dom.dropCompare.querySelector('p').textContent = '拖拽图片到此处或点击上传';
    dom.infoBaseSize.textContent = '-'; dom.infoCompSize.textContent = '-';
    dom.layerBaseName.textContent = '底图（设计稿）';
    dom.layerCompareName.textContent = '顶图（实现截图）';
    $('#offsetXSlider').value = 0; $('#offsetYSlider').value = 0;
    $('#offsetXVal').textContent = '0px'; $('#offsetYVal').textContent = '0px';
    showToast('已重置');
  });

  // Drop zones
  setupDropZone(dom.dropBase, dom.inputBase, true);
  setupDropZone(dom.dropCompare, dom.inputCompare, false);

  dom.canvasArea.addEventListener('dragover', (e) => e.preventDefault());
  dom.canvasArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const img = await loadImage(file);
      setImage(img, false, file.name);
      showToast('已替换顶图');
    }
  });

  window.addEventListener('resize', () => { if (state.baseImg || state.compareImg) fitView(); });

  // Init
  setMode('overlay');
})();
