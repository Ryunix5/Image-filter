import React, { useEffect, useRef, useState, useCallback } from "react";

/**
 * Sparrow • Image Filter Studio
 * --------------------------------
 * Notes for reviewers:
 * - Straightforward React + Tailwind (CDN). Easy to read, easy to tweak.
 * - Full-res processing happens on an offscreen canvas.
 * - Preview is DPR-aware so it stays crisp on retina screens.
 * - Pixelate = nearest-neighbor upscaling first, then filters (prevents color shift).
 */

/* ----------------------------
   UI atoms
   ---------------------------- */

// Button with 3 variants: primary / secondary / ghost.
// Centralizing style here keeps the rest of the code tidy.
const Btn = ({ variant = "secondary", className = "", ...props }) => {
  const base =
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium " +
    "transition active:scale-[.98] focus:outline-none focus:ring-2 focus:ring-sky-500/60 ";
  const variants = {
    primary:
      "text-white bg-gradient-to-tr from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 shadow border border-transparent",
    secondary:
      "text-neutral-100 bg-neutral-800/90 hover:bg-neutral-700/90 shadow-sm border border-neutral-700/60",
    ghost:
      "text-neutral-200 bg-transparent hover:bg-neutral-800/60 border border-neutral-700/50",
  };
  return <button className={base + variants[variant] + " " + className} {...props} />;
};

// Preset "pills" that wrap if space is tight.
// These avoid the overflow issue you saw earlier.
const PresetPills = ({ onSelect }) => {
  const items = ["Original", "Warm", "Cool", "Vintage", "B&W", "Dramatic"];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((name) => (
        <button
          key={name}
          onClick={() => onSelect(name)}
          className="px-3 py-1.5 text-sm rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
          title={name}
        >
          {name}
        </button>
      ))}
    </div>
  );
};

// Custom slider (div-based).
// Avoids <input type="range"> quirks on some Windows setups.
const Slider = ({ label, min, max, step = 1, value, onChange }) => {
  const trackRef = useRef(null);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const snap = (v) => {
    const s = Number(step) || 1;
    return Math.round(v / s) * s;
  };

  const percent = ((value - min) / (max - min)) * 100;

  const setFromX = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    onChange(snap(min + ratio * (max - min)));
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation(); // shields from page-level drag handlers
    setFromX(e.clientX);

    const move = (ev) => setFromX(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, { passive: true });
  };

  const onKeyDown = (e) => {
    const map = { ArrowRight: +step, ArrowUp: +step, ArrowLeft: -step, ArrowDown: -step };
    if (e.key in map) {
      e.preventDefault();
      onChange(clamp(snap(value + map[e.key]), min, max));
    }
    if (e.key === "Home") { e.preventDefault(); onChange(min); }
    if (e.key === "End")  { e.preventDefault(); onChange(max); }
  };

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-neutral-300">{label}</span>
        <span className="text-[10px] text-neutral-500">{String(value)}</span>
      </div>

      <div
        ref={trackRef}
        className="relative h-7 select-none cursor-pointer no-select"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* track */}
        <div className="absolute left-0 right-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[#2a2f38]" />
        {/* fill */}
        <div
          className="absolute left-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-600 to-indigo-600"
          style={{ width: `${percent}%` }}
        />
        {/* thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-white bg-white shadow"
          style={{ left: `${percent}%` }}
        />
      </div>
    </div>
  );
};

/* ----------------------------
   App
   ---------------------------- */

export default function App() {
  // Offscreen full-resolution canvas (actual processing)
  const fullRef = useRef(null);
  // On-screen preview (DPR-aware)
  const previewRef = useRef(null);
  // Temp canvases (small for pixelate, large for filter post-pass)
  const tempSmallRef = useRef(null);
  const tempLargeRef = useRef(null);
  const fileInputRef = useRef(null);

  // Current image
  const [img, setImg] = useState(null);
  const [imgUrl, setImgUrl] = useState("");

  // Filter values (sane defaults)
  const [f, setF] = useState({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
    blur: 0,
    pixelate: 1,
  });

  // Optional effects
  const [edgeDetect, setEdgeDetect] = useState(false);
  const [kernelName, setKernelName] = useState("None");
  const [showOriginal, setShowOriginal] = useState(false);

  // Preview + layout
  const [zoom, setZoom] = useState(1);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  // Intro overlay state
  const [introVisible, setIntroVisible] = useState(true);
  const [introFade, setIntroFade] = useState(false);

  // Undo/Redo history
  const [history, setHistory] = useState([]);
  const [hIndex, setHIndex] = useState(-1);

  /* ---------- Intro timing ---------- */
  useEffect(() => {
    // Show for ~1.2s, then fade out for 0.4s, then remove.
    const showTimer = setTimeout(() => setIntroFade(true), 1200);
    const hideTimer = setTimeout(() => setIntroVisible(false), 1600);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []);

  /* ---------- File I/O ---------- */
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
  };

  /* ---------- Image load ---------- */
  useEffect(() => {
    if (!imgUrl) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      setImg(image);

      // Full-res canvas size = natural size
      const full = fullRef.current || document.createElement("canvas");
      fullRef.current = full;
      full.width = image.naturalWidth;
      full.height = image.naturalHeight;

      drawFull();
      pushHistory();
      syncPreview();
    };
    image.src = imgUrl;
    return () => URL.revokeObjectURL(imgUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgUrl]);

  /* ---------- Redraw on changes ---------- */
  useEffect(() => {
    if (!img) return;
    drawFull();
    syncPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, f, edgeDetect, kernelName, showOriginal]);

  /* ---------- Preview sizing (DPR-aware) ---------- */
  const getDisplaySize = useCallback((full) => {
    const holder = document.getElementById("preview-holder");
    const pad = 16;
    const maxW = (holder?.clientWidth || 1000) - pad * 2;
    const scale = fitToWidth ? Math.min(1, maxW / full.width) : 1;
    return {
      displayW: Math.round(full.width * scale),
      displayH: Math.round(full.height * scale),
    };
  }, [fitToWidth]);

  const syncPreview = useCallback(() => {
    const full = fullRef.current;
    const prev = previewRef.current;
    if (!full || !prev) return;

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const { displayW, displayH } = getDisplaySize(full);

    // Internal pixel size
    prev.width = Math.max(1, Math.floor(displayW * zoom * dpr));
    prev.height = Math.max(1, Math.floor(displayH * zoom * dpr));
    // CSS size
    prev.style.width = `${Math.max(1, Math.floor(displayW * zoom))}px`;
    prev.style.height = `${Math.max(1, Math.floor(displayH * zoom))}px`;

    const pctx = prev.getContext("2d");
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.scale(dpr, dpr);
    pctx.imageSmoothingEnabled = true;
    pctx.clearRect(0, 0, prev.width, prev.height);
    pctx.drawImage(full, 0, 0, displayW * zoom, displayH * zoom);
  }, [zoom, getDisplaySize]);

  /* ---------- History (callbacks so effects can depend on them) ---------- */
  const pushHistory = useCallback(() => {
    const full = fullRef.current;
    if (!full) return;
    const url = full.toDataURL("image/png");
    setHistory((h) => {
      const next = h.slice(0, hIndex + 1).concat(url);
      return next.slice(-20);
    });
    setHIndex((i) => Math.min(i + 1, 19));
  }, [hIndex]);

  const restoreFromDataURL = useCallback((url) => {
    const full = fullRef.current;
    const img2 = new Image();
    img2.onload = () => {
      const ctx = full.getContext("2d");
      ctx.clearRect(0, 0, full.width, full.height);
      ctx.drawImage(img2, 0, 0, full.width, full.height);
      syncPreview();
    };
    img2.src = url;
  }, [syncPreview]);

  const undo = useCallback(() => {
    if (hIndex > 0) {
      restoreFromDataURL(history[hIndex - 1]);
      setHIndex(hIndex - 1);
    }
  }, [hIndex, history, restoreFromDataURL]);

  const redo = useCallback(() => {
    if (hIndex < history.length - 1) {
      restoreFromDataURL(history[hIndex + 1]);
      setHIndex(hIndex + 1);
    }
  }, [hIndex, history, restoreFromDataURL]);

  /* ---------- Draw pipeline (full-res) ---------- */
  const cssFilter = () =>
    `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) hue-rotate(${f.hue}deg) grayscale(${f.grayscale}%) sepia(${f.sepia}%) invert(${f.invert}%) blur(${f.blur}px)`;

  const drawFull = () => {
    const full = fullRef.current;
    if (!img || !full) return;

    const ctx = full.getContext("2d");
    ctx.clearRect(0, 0, full.width, full.height);
    ctx.imageSmoothingEnabled = true;

    if (showOriginal) {
      // Just draw the original at full size.
      ctx.drawImage(img, 0, 0, full.width, full.height);
    } else {
      // Pixelate first (true nearest-neighbor), then filters.
      if (f.pixelate > 1) {
        // 1) Downscale into a tiny canvas (no filter).
        const factor = Math.max(1, Math.floor(f.pixelate));
        const tw = Math.max(1, Math.floor(full.width / factor));
        const th = Math.max(1, Math.floor(full.height / factor));

        const tSmall = tempSmallRef.current || document.createElement("canvas");
        tempSmallRef.current = tSmall;
        tSmall.width = tw; tSmall.height = th;

        const sctx = tSmall.getContext("2d");
        sctx.imageSmoothingEnabled = false;
        sctx.clearRect(0, 0, tw, th);
        sctx.drawImage(img, 0, 0, tw, th);

        // 2) Scale back up with no smoothing (blocky pixels).
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tSmall, 0, 0, tw, th, 0, 0, full.width, full.height);
        ctx.imageSmoothingEnabled = true;

        // 3) Apply CSS filter after pixelation if needed.
        const isNoOp =
          f.brightness === 100 && f.contrast === 100 && f.saturation === 100 &&
          f.hue === 0 && f.grayscale === 0 && f.sepia === 0 && f.invert === 0 && f.blur === 0;

        if (!isNoOp) {
          const tLarge = tempLargeRef.current || document.createElement("canvas");
          tempLargeRef.current = tLarge;
          tLarge.width = full.width; tLarge.height = full.height;

          const lctx = tLarge.getContext("2d");
          lctx.clearRect(0, 0, tLarge.width, tLarge.height);
          lctx.filter = cssFilter();
          lctx.drawImage(full, 0, 0); // apply filters to the pixelated result

          ctx.clearRect(0, 0, full.width, full.height);
          ctx.drawImage(tLarge, 0, 0);
        }
      } else {
        // No pixelation: apply filters during draw.
        ctx.filter = cssFilter();
        ctx.drawImage(img, 0, 0, full.width, full.height);
        ctx.filter = "none";
      }

      // Optional effects run after base filters.
      if (edgeDetect) applySobel(full);
      if (kernelName !== "None") applyKernel(full, kernelFromName(kernelName));
    }
  };

  /* ---------- Effects (kernels + Sobel) ---------- */
  const kernelFromName = (name) => {
    switch (name) {
      case "Sharpen": return [0,-1,0,-1,5,-1,0,-1,0];
      case "Blur":    return [1,1,1,1,1,1,1,1,1];
      case "Emboss":  return [-2,-1,0,-1,1,1,0,1,2];
      default:        return [0,0,0,0,1,0,0,0,0];
    }
  };

  const applyKernel = (canvas, kernel) => {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const src = ctx.getImageData(0,0,width,height);
    const dst = ctx.createImageData(width,height);
    const sum = kernel.reduce((a,b)=>a+b,0)||1;
    const k = kernel.map(v=>v/sum);
    const idx = (x,y)=>(y*width+x)*4;

    for (let y=1;y<height-1;y++){
      for (let x=1;x<width-1;x++){
        let r=0,g=0,b=0,p=0;
        for(let ky=-1;ky<=1;ky++){
          for(let kx=-1;kx<=1;kx++){
            const w=k[p++]; const o=idx(x+kx,y+ky);
            r+=w*src.data[o+0]; g+=w*src.data[o+1]; b+=w*src.data[o+2];
          }
        }
        const o=idx(x,y);
        dst.data[o+0]=Math.max(0,Math.min(255,r));
        dst.data[o+1]=Math.max(0,Math.min(255,g));
        dst.data[o+2]=Math.max(0,Math.min(255,b));
        dst.data[o+3]=255;
      }
    }
    ctx.putImageData(dst,0,0);
  };

  const applySobel = (canvas) => {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const src = ctx.getImageData(0,0,width,height);
    const gray = new Uint8ClampedArray(width*height);

    // Luma conversion (simple NTSC weights)
    for(let i=0,p=0;i<src.data.length;i+=4,p++){
      const r=src.data[i],g=src.data[i+1],b=src.data[i+2];
      gray[p]=0.299*r+0.587*g+0.114*b;
    }

    const Gx=[-1,0,1,-2,0,2,-1,0,1];
    const Gy=[-1,-2,-1,0,0,0,1,2,1];
    const out = ctx.createImageData(width,height);
    const idx=(x,y)=>y*width+x;

    for(let y=1;y<height-1;y++){
      for(let x=1;x<width-1;x++){
        let sx=0,sy=0,p=0;
        for(let ky=-1;ky<=1;ky++){
          for(let kx=-1;kx<=1;kx++){
            const g=gray[idx(x+kx,y+ky)];
            sx+=Gx[p]*g; sy+=Gy[p]*g; p++;
          }
        }
        const mag=Math.min(255,Math.hypot(sx,sy));
        const o=(y*width+x)*4;
        out.data[o+0]=mag; out.data[o+1]=mag; out.data[o+2]=mag; out.data[o+3]=255;
      }
    }
    ctx.putImageData(out,0,0);
  };

  /* ---------- Small helpers ---------- */
  const setNum = (key) => (val) => setF((prev) => ({ ...prev, [key]: Number(val) }));
  const resetFilters = () => setF({ brightness:100, contrast:100, saturation:100, hue:0, grayscale:0, sepia:0, invert:0, blur:0, pixelate:1 });

  const applyPreset = (name) => {
    const map = {
      Original: resetFilters,
      Warm: () => setF((p)=>({ ...p, brightness:102, contrast:105, saturation:120, hue:-10, sepia:10, grayscale:0, invert:0, blur:0 })),
      Cool: () => setF((p)=>({ ...p, brightness:100, contrast:105, saturation:105, hue:12, sepia:0, grayscale:0, invert:0, blur:0 })),
      Vintage: () => setF((p)=>({ ...p, brightness:102, contrast:95, saturation:85, hue:-5, sepia:25, grayscale:0, invert:0, blur:0.5 })),
      "B&W": () => setF((p)=>({ ...p, contrast:110, saturation:0, grayscale:100, sepia:0, invert:0, blur:0 })),
      Dramatic: () => setF((p)=>({ ...p, contrast:130, saturation:90, grayscale:20, blur:0 })),
    };
    map[name]?.();
  };

  const download = () => {
    // Export the full-res canvas as a PNG.
    const full = fullRef.current;
    const a = document.createElement("a");
    a.href = full.toDataURL("image/png");
    a.download = "edited-image.png";
    a.click();
  };

  /* ---------- Keyboard shortcuts ---------- */
  useEffect(() => {
    const down = (e) => {
      if (e.code === "Space") { e.preventDefault(); setShowOriginal(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    const up = (e) => { if (e.code === "Space") setShowOriginal(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [undo, redo]);

  /* ---------- Render ---------- */
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 via-neutral-900 to-black">
      {/* Intro overlay (logo in /public/Sparrow.png) */}
      {introVisible && (
        <div className={`fixed inset-0 z-50 grid place-items-center bg-black ${introFade ? "fade-out" : ""}`}>
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full border-4 border-neutral-700 border-t-sky-500 spin" />
            <img
              src="Sparrow.png"
              alt="Sparrow logo"
              className="h-12 opacity-90"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <div className="text-lg font-semibold tracking-wide text-neutral-200">sparrow</div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl p-6">
        {/* Header */}
        <header className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-sm px-5 py-4 shadow-lg">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              {/* Your logo instead of the blue gradient block */}
              <img
                src="Sparrow.png"
                alt="Sparrow logo"
                className="h-10 w-10 object-contain rounded-md shadow"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <h1 className="text-xl font-semibold">Sparrow's Image Filter Studio</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* File input is hidden; this button triggers it */}
              {/* Hidden file input */}
              <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              className="hidden"
              />

            {/* Button that opens the file dialog */}
              <Btn
             variant="ghost"
            onClick={() => fileInputRef.current?.click()}
              >
              Upload Image
              </Btn>

              <Btn onClick={resetFilters}>Reset</Btn>
              <Btn onClick={() => { pushHistory(); }}>Snapshot</Btn>
              <Btn onClick={() => undo()}>Undo ⌘/Ctrl+Z</Btn>
              <Btn onClick={() => redo()}>Redo ⌘/Ctrl+Y</Btn>
              <Btn variant="primary" onClick={download}>Download PNG</Btn>
            </div>
          </div>
        </header>

        {/* Main */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Controls */}
          <section className="space-y-5 lg:col-span-1">
            {/* Presets */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-sm p-4 shadow">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-300">Presets</h2>
              <PresetPills onSelect={applyPreset} />
            </div>

            {/* Basic Filters */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-sm p-4 shadow">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-300">Basic Filters</h2>
              <div className="space-y-4">
                <Slider label="Brightness" min={0} max={200} step={1} value={f.brightness} onChange={setNum("brightness")} />
                <Slider label="Contrast"   min={0} max={200} step={1} value={f.contrast}   onChange={setNum("contrast")} />
                <Slider label="Saturation" min={0} max={300} step={1} value={f.saturation} onChange={setNum("saturation")} />
                <Slider label="Hue (°)"    min={-180} max={180} step={1} value={f.hue}      onChange={setNum("hue")} />
                <Slider label="Grayscale"  min={0} max={100} step={1} value={f.grayscale}  onChange={setNum("grayscale")} />
                <Slider label="Sepia"      min={0} max={100} step={1} value={f.sepia}      onChange={setNum("sepia")} />
                <Slider label="Invert"     min={0} max={100} step={1} value={f.invert}     onChange={setNum("invert")} />
                <Slider label="Blur (px)"  min={0} max={10}  step={0.1} value={f.blur}     onChange={setNum("blur")} />
                <Slider label="Pixelate"   min={1} max={40}  step={1}   value={f.pixelate} onChange={setNum("pixelate")} />
                <div className="text-[11px] text-neutral-500">Pixelate = 1 turns it off.</div>
              </div>
            </div>

            {/* Effects */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-sm p-4 shadow">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-300">Effects</h2>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm">
                  <span>Sobel Edge Detect</span>
                  <input type="checkbox" checked={edgeDetect} onChange={(e)=>setEdgeDetect(e.target.checked)} />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm">
                  <span>Post Kernel</span>
                  <select
                    className="rounded-md bg-neutral-700 px-2 py-1 text-sm outline-none"
                    value={kernelName}
                    onChange={(e)=>setKernelName(e.target.value)}
                  >
                    <option>None</option>
                    <option>Sharpen</option>
                    <option>Blur</option>
                    <option>Emboss</option>
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm">
                  <span>Show Original (hold Space)</span>
                  <input type="checkbox" checked={showOriginal} onChange={(e)=>setShowOriginal(e.target.checked)} />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-neutral-300">Zoom (preview)</span>
                    <span className="text-[10px] text-neutral-500">{zoom.toFixed(2)}×</span>
                  </div>
                  <Slider label="" min={0.25} max={2} step={0.01} value={zoom} onChange={(v)=>{ setZoom(v); syncPreview(); }} />
                  <label className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={fitToWidth}
                      onChange={(e)=>{ setFitToWidth(e.target.checked); syncPreview(); }}
                    />
                    Fit to width
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Preview */}
          <section className="lg:col-span-2">
            <div
              id="preview-holder"
              className={
                "relative overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 checker transition ring-offset-2 " +
                (dragOver ? "ring-2 ring-sky-500" : "ring-0")
              }
              onDragOver={(e)=>{ e.preventDefault(); setDragOver(true); }}
              onDragLeave={()=>setDragOver(false)}
              onDrop={onDrop}
            >
              {!img ? (
                <div className="flex h-[60vh] items-center justify-center text-neutral-500">
                  <p>Upload or drag & drop an image to begin.</p>
                </div>
              ) : (
                <div className="w-full p-4">
                  {/* Offscreen fullRef is not shown; previewRef is DPR-aware */}
                  <canvas ref={previewRef} className="block rounded-xl shadow-2xl" />
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="mt-6 text-xs text-neutral-400">
          Tips: Drag sliders (mouse or touch). Press <kbd>Space</kbd> to compare. Undo/Redo while experimenting.
        </div>
      </div>
    </div>
  );
}
