
    
    
    // ---------- tiny helpers ----------
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    // ---------- audio ----------
    const Sound = (() => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = Ctx ? new Ctx() : null;
      let muted = false;
      function beep(freq = 800, time = 0.07, type = "sine") {
        if (!ctx || muted) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time);
        o.start(); o.stop(ctx.currentTime + time);
      }
      function success(){ beep(600,.08,"triangle"); setTimeout(()=>beep(900,.09,"triangle"),60); }
      return { toggle(){ muted=!muted; return !muted; }, isMuted(){ return muted; }, beep, success };
    })();

    // ---------- level data ----------
    const levelsEl = document.getElementById("levels");
    let levelData = { tolerance: 18, scenes: [] };
    try { levelData = JSON.parse(levelsEl.textContent || "{}"); }
    catch(e){ console.error("Invalid #levels JSON.", e); }

    // ---------- meters ----------
    const HERITAGE_KEYS = ["hungarian","russian","sekler","germanHungarian","italian"];
    const Meter = {
      key: "fernwehMetersV1",
      data: HERITAGE_KEYS.reduce((o,k)=>(o[k]=0,o),{}),
      load(){ try{ const s = JSON.parse(localStorage.getItem(this.key)||"null"); if(s) this.data={...this.data,...s}; }catch(e){} },
      save(){ localStorage.setItem(this.key, JSON.stringify(this.data)); },
      add(key, amt=12){ if(!(key in this.data)) return; this.data[key]=Math.max(0,Math.min(100,this.data[key]+amt)); this.save(); renderMeters(); },
      reset(){ HERITAGE_KEYS.forEach(k=>this.data[k]=0); this.save(); renderMeters(); }
    };
    Meter.load();
    function renderMeters(){
      $$(".meter").forEach(m=>{
        const key = m.dataset.key;
        const v = Meter.data[key] ?? 0;
        const fill = m.querySelector(".fill");
        const val  = m.querySelector(".value");
        if (fill) fill.style.width = v + "%";
        if (val)  val.textContent  = v + "%";
      });
    }

    // ---------- game state ----------
    const stage = document.getElementById("stage");
    const hint = document.getElementById("hint");
    const targets = document.getElementById("targets");
    const items = document.getElementById("items");

    const btnNext = document.getElementById("btnNext");
    const btnReset = document.getElementById("btnReset");
    const btnMute = document.getElementById("btnMute");
    const progress = document.getElementById("progress");
    const sceneTitle = document.getElementById("sceneTitle");
    const sceneMeta = document.getElementById("sceneMeta");
    const sceneNotes = document.getElementById("sceneNotes");

    const Game = {
      i: 0,
      tolerance: levelData.tolerance || 18,
      progressKey: "fernwehProgressV1",
      get scene(){ return levelData.scenes[this.i]; }
    };
    (function restore(){
      try {
        const s = JSON.parse(localStorage.getItem(Game.progressKey)||"null");
        if (s && Number.isFinite(s.i)) Game.i = Math.min(s.i, Math.max(0,(levelData.scenes.length-1)));
      } catch(e){}
    })();

    function setProgressText(){
      progress.textContent = `Scene ${Game.i+1} / ${levelData.scenes.length}`;
    }
    function saveProgress(){ localStorage.setItem(Game.progressKey, JSON.stringify({ i: Game.i })); }
    function clearEl(el){ while (el.firstChild) el.removeChild(el.firstChild); }

    // ---------- geometry ----------
    function distance(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
    function centerOf(el){
      const r = el.getBoundingClientRect();
      const pr = stage.getBoundingClientRect();
      return { x: r.left - pr.left + r.width/2, y: r.top - pr.top + r.height/2 };
    }
    function clampToStage(el){
      const sr = stage.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const left = parseFloat(el.style.left||"0");
      const top  = parseFloat(el.style.top ||"0");
      const dx = Math.min(Math.max(0,left), sr.width  - r.width);
      const dy = Math.min(Math.max(0,top ), sr.height - r.height);
      el.style.left = dx + "px";
      el.style.top  = dy + "px";
    }

    // ---------- factories ----------
    function createSpot(t){
      const d = document.createElement("div");
      d.className = "spot";
      d.style.left = (t.x-48) + "px";
      d.style.top  = (t.y-48) + "px";
      d.dataset.accepts = t.accepts;
      d.setAttribute("aria-label", `Target for ${t.accepts}`);
      d.textContent = t.emoji;
      return d;
    }
    function enableDrag(el){
      let dragging=false, startX=0, startY=0, origLeft=0, origTop=0;
      el.addEventListener("pointerdown", e=>{
        dragging = true; el.setPointerCapture(e.pointerId); el.setAttribute("aria-grabbed","true");
        const rect = el.getBoundingClientRect(); const pr = stage.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY; origLeft = rect.left - pr.left; origTop = rect.top - pr.top;
        Sound.beep(300,.04,"square");
      });
      el.addEventListener("pointermove", e=>{
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        el.style.left = (origLeft + dx) + "px";
        el.style.top  = (origTop + dy) + "px";
      });
      const endDrag = e=>{
        if (!dragging) return; dragging=false; el.releasePointerCapture?.(e.pointerId); el.setAttribute("aria-grabbed","false");
        clampToStage(el); snapToSpot(el); checkAllPlaced();
      };
      el.addEventListener("pointerup", endDrag);
      el.addEventListener("pointercancel", endDrag);
    }
    function enableKeyboardMove(el){
      let grabbed=false;
      el.addEventListener("keydown", e=>{
        if (e.code==="Space"){ grabbed=!grabbed; el.setAttribute("aria-grabbed", grabbed?"true":"false"); Sound.beep(grabbed?350:250,.04,"sine"); e.preventDefault(); return; }
        if (!grabbed) return;
        const step = e.shiftKey ? 16 : 8;
        const left = parseFloat(el.style.left||"0"), top = parseFloat(el.style.top||"0");
        if (e.code==="ArrowLeft"){ el.style.left = (left-step)+"px"; e.preventDefault(); }
        if (e.code==="ArrowRight"){ el.style.left = (left+step)+"px"; e.preventDefault(); }
        if (e.code==="ArrowUp"){ el.style.top = (top-step)+"px"; e.preventDefault(); }
        if (e.code==="ArrowDown"){ el.style.top = (top+step)+"px"; e.preventDefault(); }
        clampToStage(el); checkAllPlaced();
      });
    }
    function createPiece(p){
      const d = document.createElement("button");
      d.className = "piece";
      d.style.left = (p.x-48) + "px";
      d.style.top  = (p.y-48) + "px";
      d.dataset.type = p.type;
      d.dataset.heritage = p.heritage || "";
      d.setAttribute("aria-label", p.label || p.type);
      d.setAttribute("aria-grabbed","false");
      d.textContent = p.emoji;
      d.tabIndex = 0;
      enableDrag(d); enableKeyboardMove(d);
      return d;
    }

    // ---------- core logic ----------
    function snapToSpot(piece){
      const spot = $$(".spot").find(s => s.dataset.accepts === piece.dataset.type);
      if (!spot) return false;
      const ok = distance(centerOf(piece), centerOf(spot)) <= Game.tolerance;
      if (ok){
        const c = centerOf(spot);
        piece.style.left = (c.x-48) + "px";
        piece.style.top  = (c.y-48) + "px";
        piece.classList.add("correct");
        if (!piece.dataset.scored){
          const h = piece.dataset.heritage; if (h) Meter.add(h, 12);
          piece.dataset.scored = "1";
        }
        Sound.beep(520,.05,"square");
        return true;
      }
      return false;
    }
    function checkAllPlaced(){
      const pieces = $$(".piece");
      const spots  = $$(".spot");
      let all = true;
      spots.forEach(s => s.classList.remove("filled"));
      for (const p of pieces){
        const s = spots.find(z => z.dataset.accepts === p.dataset.type);
        if (!s) continue;
        const ok = distance(centerOf(p), centerOf(s)) <= Game.tolerance;
        if (ok){ p.classList.add("correct"); s.classList.add("filled"); }
        else { p.classList.remove("correct"); all = false; }
      }
      btnNext.disabled = !all;
      if (all) Sound.success();
    }

    function loadScene(i){
      Game.i = i;
      const scene = Game.scene; if (!scene) return;
      clearEl(targets); clearEl(items);
      hint.textContent = scene.hint || "";
      sceneTitle.textContent = scene.title || "Scene";
      sceneNotes.textContent = scene.notes || "";
      if (!sceneMeta.textContent) sceneMeta.textContent = "Arrange the items to the matching spots.";
      setProgressText(); saveProgress();
      for (const t of scene.targets) targets.appendChild(createSpot(t));
      for (const p of scene.pieces) items.appendChild(createPiece(p));
      btnNext.disabled = true;
      requestAnimationFrame(()=>{ renderMeters(); checkAllPlaced(); });
    }
    function nextScene(){ if (Game.i < levelData.scenes.length-1) loadScene(Game.i+1); else celebrate(); }
    function resetScene(){ loadScene(Game.i); }
    function celebrate(){
      sceneTitle.textContent = "All scenes complete!";
      sceneNotes.textContent = "Press Reset to replay. Add more scenes in the #levels JSON.";
      hint.textContent = "✨";
      Sound.success();
    }

    // ---------- controls ----------
    btnNext.addEventListener("click", nextScene);
    btnReset.addEventListener("click", resetScene);
    btnMute.addEventListener("click", ()=>{
      const on = Sound.toggle();
      btnMute.textContent = on ? "🔊 Sound" : "🔈 Muted";
      btnMute.setAttribute("aria-pressed", on ? "false":"true");
    });
    window.addEventListener("keydown", (e)=>{
      const k = e.key.toLowerCase();
      if (k==="n") nextScene();
      if (k==="r") resetScene();
      if (k==="m") btnMute.click();
    });

    // ---------- init ----------
    loadScene(Game.i);
    renderMeters();