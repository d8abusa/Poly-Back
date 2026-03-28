const FONT = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&display=swap');`;

export const globalCss = `
  ${FONT}
  * { margin:0; padding:0; box-sizing:border-box; }
  :root {
    --bg:#0a0c0f; --surface:#111318; --surface2:#181c23;
    --border:#1e2330; --border2:#252d3d;
    --accent:#00d4a8; --accent2:#ff6b35; --accent3:#7b61ff;
    --yes:#22c55e; --no:#ef4444;
    --text:#e8eaf0; --muted:#606880; --muted2:#8891aa;
  }
  body { margin:0; display:block; background:var(--bg); color:var(--text); font-family:'IBM Plex Mono',monospace; font-size:13px; }
  .root { display:flex; flex-direction:column; width:100%; height:100vh; background:var(--bg); overflow:hidden; position:relative; }
  .root::before { content:''; position:fixed; inset:0; background-image:linear-gradient(rgba(0,212,168,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,168,0.025) 1px,transparent 1px); background-size:40px 40px; pointer-events:none; z-index:0; }

  /* HEADER */
  .header { height:52px; background:rgba(10,12,15,0.95); border-bottom:1px solid var(--border); display:flex; align-items:center; padding:0 20px; gap:16px; flex-shrink:0; position:relative; z-index:10; backdrop-filter:blur(12px); }
  .logo { display:flex; align-items:center; gap:8px; font-family:'Syne',sans-serif; font-weight:800; font-size:16px; color:var(--text); }
  .logo-mark { width:26px; height:26px; background:linear-gradient(135deg,var(--accent),var(--accent3)); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#000; font-weight:700; }
  .logo span { color:var(--accent); }
  .header-sub { font-size:11px; color:var(--muted2); margin-left:4px; border-left:1px solid var(--border2); padding-left:12px; }
  .header-right { margin-left:auto; display:flex; align-items:center; gap:10px; font-size:11px; color:var(--muted2); }
  .sel-count { background:rgba(0,212,168,0.1); color:var(--accent); border:1px solid rgba(0,212,168,0.25); padding:3px 10px; border-radius:4px; font-size:10px; font-weight:600; }

  /* LAYOUT */
  .layout { display:grid; grid-template-columns:340px 1fr; flex:1; overflow:hidden; position:relative; z-index:1; }

  /* LEFT — SEARCH PANEL */
  .search-panel { border-right:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
  .search-box { padding:12px 14px; border-bottom:1px solid var(--border); background:var(--surface); flex-shrink:0; }
  .search-wrap { position:relative; }
  .search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none; }
  .search-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--muted); cursor:pointer; font-size:14px; line-height:1; transition:color 0.12s; }
  .search-clear:hover { color:var(--text); }
  .search-input { width:100%; background:var(--surface2); border:1px solid var(--border2); border-radius:7px; padding:8px 32px; color:var(--text); font-family:'IBM Plex Mono',monospace; font-size:12px; outline:none; transition:border-color 0.15s; }
  .search-input:focus { border-color:var(--accent); box-shadow:0 0 0 2px rgba(0,212,168,0.08); }
  .search-input::placeholder { color:var(--muted); }
  .cat-bar { display:flex; gap:5px; padding:8px 14px; border-bottom:1px solid var(--border); overflow-x:auto; flex-shrink:0; }
  .cat-bar::-webkit-scrollbar { display:none; }
  .cat-btn { padding:3px 10px; border-radius:4px; font-size:10px; cursor:pointer; background:var(--surface2); color:var(--muted2); border:1px solid var(--border2); white-space:nowrap; transition:all 0.12s; font-family:'IBM Plex Mono',monospace; }
  .cat-btn:hover { color:var(--text); }
  .cat-btn.active { background:rgba(123,97,255,0.1); color:var(--accent3); border-color:rgba(123,97,255,0.3); }
  .sort-bar { display:flex; align-items:center; gap:8px; padding:7px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
  .sort-label { font-size:10px; color:var(--muted); }
  .sort-btn { padding:2px 8px; border-radius:3px; font-size:10px; cursor:pointer; background:transparent; color:var(--muted2); border:1px solid transparent; transition:all 0.12s; font-family:'IBM Plex Mono',monospace; }
  .sort-btn:hover { color:var(--text); }
  .sort-btn.active { color:var(--accent); background:rgba(0,212,168,0.07); border-color:rgba(0,212,168,0.2); }
  .result-count { margin-left:auto; font-size:10px; color:var(--muted); }
  .market-list { flex:1; overflow-y:auto; }
  .market-list::-webkit-scrollbar { width:3px; }
  .market-list::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }

  /* MARKET CARD */
  .market-item { padding:10px 14px; border-bottom:1px solid var(--border); cursor:pointer; transition:all 0.12s; display:flex; align-items:flex-start; gap:10px; }
  .market-item:hover { background:var(--surface2); }
  .market-item.selected { background:rgba(0,212,168,0.05); border-left:2px solid var(--accent); }
  .market-item.queued { background:rgba(123,97,255,0.04); }
  .m-check { width:15px; height:15px; border:1px solid var(--border2); border-radius:3px; flex-shrink:0; margin-top:1px; display:flex; align-items:center; justify-content:center; transition:all 0.12s; background:var(--surface2); }
  .m-check.on { background:var(--accent3); border-color:var(--accent3); }
  .m-check.on::after { content:'✓'; font-size:9px; color:#fff; font-weight:700; }
  .m-body { flex:1; min-width:0; }
  .m-title { font-size:11px; color:var(--text); line-height:1.35; margin-bottom:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .m-meta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .m-tag { font-size:9px; padding:1px 5px; border-radius:3px; background:var(--surface2); color:var(--muted2); border:1px solid var(--border2); }
  .m-cat { font-size:9px; padding:1px 5px; border-radius:3px; }
  .m-vol { font-size:9px; color:var(--muted2); }
  .m-right { display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0; }
  .m-prob { font-family:'Syne',sans-serif; font-size:15px; font-weight:700; }
  .m-prob.hi { color:var(--yes); }
  .m-prob.mid { color:var(--accent); }
  .m-prob.lo { color:var(--no); }
  .m-outcome { font-size:9px; padding:1px 6px; border-radius:3px; font-weight:600; }
  .m-outcome.yes { background:rgba(34,197,94,0.12); color:var(--yes); border:1px solid rgba(34,197,94,0.2); }
  .m-outcome.no { background:rgba(239,68,68,0.1); color:var(--no); border:1px solid rgba(239,68,68,0.2); }
  .no-results { padding:40px 20px; text-align:center; color:var(--muted); }
  .no-results-icon { font-size:28px; margin-bottom:8px; opacity:0.4; }
  .no-results-title { font-family:'Syne',sans-serif; font-size:13px; color:var(--muted2); margin-bottom:4px; }
  .no-results-sub { font-size:10px; }

  /* RIGHT — DETAIL PANEL */
  .detail-panel { display:flex; flex-direction:column; overflow-y:auto; }
  .detail-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--muted); }
  .detail-empty-icon { font-size:36px; opacity:0.25; }
  .detail-empty-title { font-family:'Syne',sans-serif; font-size:15px; color:var(--muted2); }
  .detail-empty-sub { font-size:11px; text-align:center; max-width:260px; line-height:1.5; }
  .detail-empty-hint { font-size:10px; color:var(--accent); background:rgba(0,212,168,0.07); border:1px solid rgba(0,212,168,0.18); padding:5px 12px; border-radius:5px; margin-top:4px; }
  .detail-header { padding:16px 20px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
  .detail-title { font-family:'Instrument Serif',serif; font-size:19px; font-style:italic; color:var(--text); line-height:1.25; margin-bottom:8px; }
  .detail-meta { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .dmeta { font-size:10px; color:var(--muted2); display:flex; align-items:center; gap:4px; }
  .dmeta .dot { width:6px; height:6px; border-radius:50%; background:var(--yes); }
  .dmeta .dot.no { background:var(--no); }
  .anomaly { display:inline-flex; align-items:center; gap:4px; font-size:10px; padding:2px 7px; border-radius:4px; background:rgba(255,107,53,0.1); color:var(--accent2); border:1px solid rgba(255,107,53,0.2); }

  /* PROB CHART */
  .prob-chart-wrap { flex:0 0 160px; min-height:0; padding:16px 20px 8px; display:flex; flex-direction:column; }
  .prob-chart-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; }
  .prob-chart-label span { color:var(--muted2); font-size:11px; text-transform:none; letter-spacing:0; }
  .prob-chart { flex:1; min-height:120px; position:relative; }
  svg.prob-svg { width:100%; height:100%; display:block; }

  /* STATS ROW */
  .detail-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border); border-top:1px solid var(--border); flex-shrink:0; }
  .dstat { background:var(--surface); padding:10px 14px; }
  .dstat-label { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:0.7px; margin-bottom:3px; }
  .dstat-val { font-family:'Syne',sans-serif; font-size:16px; font-weight:700; }
  .dstat-val.g { color:var(--yes); }
  .dstat-val.r { color:var(--no); }
  .dstat-val.t { color:var(--accent); }
  .dstat-val.b { color:var(--accent3); }
  .dstat-sub { font-size:9px; color:var(--muted2); margin-top:1px; }

  /* STRUCTURAL EDGE STRIP */
  .edge-strip { padding:9px 20px; border-top:1px solid rgba(255,107,53,0.2); background:rgba(255,107,53,0.04); display:flex; align-items:center; gap:14px; flex-shrink:0; flex-wrap:wrap; }
  .edge-badge { font-size:9px; padding:2px 7px; border-radius:3px; background:rgba(255,107,53,0.12); color:var(--accent2); border:1px solid rgba(255,107,53,0.2); font-weight:600; letter-spacing:0.4px; }
  .edge-item { display:flex; flex-direction:column; gap:1px; }
  .edge-label { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; }
  .edge-val { font-size:12px; font-family:'Syne',sans-serif; font-weight:700; }
  .edge-val.warn { color:var(--accent2); }
  .edge-val.good { color:var(--yes); }
  .edge-val.bad { color:var(--no); }
  .edge-val.neutral { color:var(--accent3); }
  .edge-div { width:1px; height:22px; background:rgba(255,107,53,0.18); }
  .bias-row { display:flex; align-items:center; gap:8px; margin-left:auto; }
  .bias-label { font-size:9px; color:var(--muted); }
  .bias-track { width:80px; height:5px; background:var(--border2); border-radius:3px; overflow:hidden; }
  .bias-fill { height:100%; border-radius:3px; background:linear-gradient(90deg,var(--accent2),#ff2255); transition:width 0.4s ease; }

  /* QUEUE BAR */
  .queue-bar { padding:10px 14px; border-top:1px solid var(--border); background:var(--surface); display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .queue-label { font-size:10px; color:var(--muted2); white-space:nowrap; }
  .queue-chips { flex:1; display:flex; gap:5px; flex-wrap:wrap; min-height:22px; }
  .q-chip { display:flex; align-items:center; gap:5px; padding:3px 8px; border-radius:4px; background:rgba(123,97,255,0.1); color:var(--accent3); border:1px solid rgba(123,97,255,0.2); font-size:10px; }
  .q-remove { cursor:pointer; opacity:0.5; font-size:13px; line-height:1; transition:opacity 0.12s; }
  .q-remove:hover { opacity:1; }
  .queue-run { padding:6px 16px; border-radius:6px; background:var(--accent); color:#000; font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:600; border:none; cursor:pointer; transition:all 0.15s; white-space:nowrap; flex-shrink:0; }
  .queue-run:hover { background:#00efc0; transform:translateY(-1px); }
  .queue-run:disabled { background:var(--border2); color:var(--muted); cursor:not-allowed; transform:none; }

  /* TOOLTIP */
  .svg-tooltip { position:absolute; background:var(--surface2); border:1px solid var(--border2); border-radius:7px; padding:8px 11px; font-size:11px; pointer-events:none; box-shadow:0 8px 24px rgba(0,0,0,0.4); z-index:20; min-width:130px; }
  .stt-date { font-size:9px; color:var(--muted2); margin-bottom:5px; }
  .stt-row { display:flex; justify-content:space-between; gap:12px; margin-bottom:2px; }
  .stt-key { color:var(--muted2); }
  .stt-val { color:var(--text); font-weight:600; }

  .strategy-carousel::-webkit-scrollbar { display:none; }
  .strategy-carousel { scrollbar-width:none; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
  .fade-in { animation:fadeIn 0.2s ease; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
