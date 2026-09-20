/* --- CANVAS --- */
let canvas, ctx, isDrawing = false, isPanning = false, currentTool = 'draw', camera = { x: 0, y: 0, zoom: 1 }, spaceHeld = false;
let startPan = { x: 0, y: 0 }, startDraw = { x: 0, y: 0 }, currentStroke = null;
let hoverDrawActive = false; // true when hover-draw hotkey is held

/* ── POINTER LOCK (Tablet / Raw Delta Mode) ─────────────────────────
   When active:
   - OS cursor is hidden & frozen via Pointer Lock API
   - movementX/Y deltas move a virtual (mockX, mockY) coordinate
   - A custom crosshair sprite is rendered on top of each canvas frame
   - Drawing, panning, and zooming all use the mock position
──────────────────────────────────────────────────────────────────── */
let pointerLockActive = false;
let mockX = 0, mockY = 0; // virtual cursor position in canvas CSS pixels

function togglePointerLock() {
    if (pointerLockActive || document.pointerLockElement === canvas) {
        document.exitPointerLock();
    } else {
        canvas.requestPointerLock();
    }
}

function onPointerLockChange() {
    if (document.pointerLockElement === canvas) {
        pointerLockActive = true;
        // Seed mock position at canvas centre so the cursor starts somewhere sensible
        mockX = canvas.width / 2;
        mockY = canvas.height / 2;
        canvas.style.cursor = 'none';
        const btn = document.getElementById('pointer-lock-btn');
        if (btn) { btn.style.color = 'rgb(var(--accent))'; btn.title = 'Tablet Mode ON — Press Esc to exit'; }
        redrawCanvas();
    } else {
        pointerLockActive = false;
        // Restore cursor style based on active tool
        canvas.style.cursor = currentTool === 'pan' ? 'grab' : 'crosshair';
        const btn = document.getElementById('pointer-lock-btn');
        if (btn) { btn.style.color = ''; btn.title = 'Tablet Mode — Pointer Lock (raw deltas, virtual cursor). Click to toggle, Esc to exit.'; }
        // End any in-progress stroke cleanly
        if (isDrawing && currentStroke) endAction();
        redrawCanvas();
    }
}

function onPointerLockError() {
    toast('Pointer Lock unavailable in this browser/context.', 'error');
}

// Convert mock canvas-pixel position → world coordinates (same logic as getMousePos)
function mockToWorld() {
    return {
        x: (mockX - camera.x) / camera.zoom,
        y: (mockY - camera.y) / camera.zoom
    };
}

// Draw the virtual crosshair cursor on top of the canvas frame
function drawVirtualCursor() {
    if (!pointerLockActive) return;
    const x = mockX, y = mockY;
    const r = 10, gap = 3, dot = 2;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    // Crosshair lines
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + r);
    ctx.stroke();
    // Centre dot
    ctx.fillStyle = 'rgb(var(--accent))';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function initCanvas() {
    canvas = document.getElementById('whiteboard');
    if (!canvas) return; // element not in DOM yet
    ctx = canvas.getContext('2d');

    // Register Pointer Lock listeners (once only)
    if (!window._canvasListenersAdded) {
        window._canvasListenersAdded = true;
        document.addEventListener('pointerlockchange', onPointerLockChange);
        document.addEventListener('pointerlockerror', onPointerLockError);
    }

    // ── TOUCH SUPPORT (mobile) ────────────────────────────────────────────
    // Rule: 1 finger = draw/erase/tool action  |  2 fingers = pan + pinch-zoom
    let _pinchStartDist = 0;
    let _pinchStartZoom = 1;
    let _pinchMidStart  = { x: 0, y: 0 };
    let _pinchCamStart  = { x: 0, y: 0 };

    function _midpoint(t) {
        return {
            x: (t[0].clientX + t[1].clientX) / 2,
            y: (t[0].clientY + t[1].clientY) / 2
        };
    }
    function _dist(t) {
        const dx = t[0].clientX - t[1].clientX;
        const dy = t[0].clientY - t[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();

        if (e.touches.length === 2) {
            // ── Two fingers: begin pan+pinch, cancel any active stroke ──
            isDrawing = false;
            currentStroke = null;
            isPanning = false; // we handle 2-finger pan ourselves below
            _pinchStartDist = _dist(e.touches);
            _pinchStartZoom = camera.zoom;
            _pinchMidStart  = _midpoint(e.touches);
            _pinchCamStart  = { x: camera.x, y: camera.y };
            return;
        }

        // ── One finger: draw / tool action ──
        if (e.touches.length === 1) {
            const pos = getTouchPos(e);
            if (currentTool === 'pan') {
                isPanning = true;
                startPan = { x: e.touches[0].clientX - camera.x, y: e.touches[0].clientY - camera.y };
                if (toggleOcclusionAt(pos)) isPanning = false;
                return;
            }
            if (currentTool === 'text')   { handleTextTool(pos); return; }
            if (currentTool === 'fill')   { applyFillTool(pos); return; }
            if (currentTool === 'eraser') {
                isDrawing = true;
                currentStroke = { tool: 'eraser', eraserSize, points: [pos], workspaceId: state.activeWorkspace };
                return;
            }
            isDrawing = true;
            currentStroke = { tool: currentTool, color: (canvasCurrentColor || state.settings.accent), points: [pos], workspaceId: state.activeWorkspace };
            if (['rect','circle','line','sticky','occlude'].includes(currentTool)) currentStroke.rectEnd = pos;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();

        if (e.touches.length === 2) {
            // ── Pinch-zoom ──
            const newDist = _dist(e.touches);
            const newMid  = _midpoint(e.touches);
            const rect    = canvas.getBoundingClientRect();

            // Scale zoom around the midpoint
            const scale = newDist / (_pinchStartDist || 1);
            const newZoom = Math.max(0.1, Math.min(_pinchStartZoom * scale, 10));

            // World coordinate that was under the initial midpoint
            const wx = (_pinchMidStart.x - rect.left - _pinchCamStart.x) / _pinchStartZoom;
            const wy = (_pinchMidStart.y - rect.top  - _pinchCamStart.y) / _pinchStartZoom;

            // Pan delta (two fingers moving together)
            const panDx = newMid.x - _pinchMidStart.x;
            const panDy = newMid.y - _pinchMidStart.y;

            camera.zoom = newZoom;
            camera.x = (_pinchMidStart.x - rect.left) - wx * newZoom + panDx;
            camera.y = (_pinchMidStart.y - rect.top)  - wy * newZoom + panDy;
            redrawCanvas();
            return;
        }

        if (e.touches.length === 1) {
            if (isPanning) {
                camera.x = e.touches[0].clientX - startPan.x;
                camera.y = e.touches[0].clientY - startPan.y;
                redrawCanvas();
                return;
            }
            if (!isDrawing || !currentStroke) return;
            const pos = getTouchPos(e);
            if (currentTool === 'eraser') {
                currentStroke.points.push(pos);
                redrawCanvas();
                ctx.save();
                ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
                ctx.lineWidth = eraserSize * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
                for (let i = 1; i < currentStroke.points.length; i++) ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
                ctx.stroke(); ctx.restore();
            } else if (currentTool === 'draw') {
                currentStroke.points.push(pos);
                redrawCanvas(); drawTempStroke(currentStroke);
            } else if (['rect','circle','line','sticky','occlude'].includes(currentTool)) {
                currentStroke.rectEnd = pos;
                redrawCanvas(); drawTempStroke(currentStroke);
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        // Reset pinch state when fingers lift
        if (e.touches.length < 2) {
            _pinchStartDist = 0;
        }
        endAction();
    });

    // Mouse Support
    canvas.addEventListener('mousedown', (e) => {
        if (pointerLockActive) {
            // In pointer-lock mode, left click = draw/action, right click = pan
            if (e.button === 2) {
                isPanning = true;
                startPan = { x: mockX - camera.x, y: mockY - camera.y };
            } else if (e.button === 0) {
                const pos = mockToWorld();
                if (currentTool === 'text') { handleTextTool(pos); return; }
                if (currentTool === 'pan') {
                    isPanning = true;
                    startPan = { x: mockX - camera.x, y: mockY - camera.y };
                    if (toggleOcclusionAt(pos)) { isPanning = false; }
                } else {
                    isDrawing = true;
                    currentStroke = { tool: currentTool, color: (canvasCurrentColor || state.settings.accent), points: [pos], workspaceId: state.activeWorkspace };
                    if (['rect', 'circle', 'line', 'sticky', 'occlude'].includes(currentTool)) currentStroke.rectEnd = pos;
                }
            }
            return;
        }
        if (currentTool === 'pan' || e.button === 1 || spaceHeld) {
            isPanning = true; startPan = { x: e.clientX - camera.x, y: e.clientY - camera.y }; canvas.style.cursor = 'grabbing';
            if(currentTool === 'pan' && e.button === 0){
                const pos = getMousePos(e);
                if(toggleOcclusionAt(pos)) { isPanning = false; canvas.style.cursor = 'grab'; }
            }
        }
        else if (e.button === 0) { 
            const pos = getMousePos(e); 
            if(currentTool === 'text') { handleTextTool(pos); return; }
            if(currentTool === 'fill') { applyFillTool(pos); return; }
            if(currentTool === 'eraser') {
                isDrawing = true;
                currentStroke = { tool: 'eraser', eraserSize: eraserSize, points: [pos], workspaceId: state.activeWorkspace };
                return;
            }
            isDrawing = true; currentStroke = { tool: currentTool, color: (canvasCurrentColor || state.settings.accent), points: [pos], workspaceId: state.activeWorkspace }; 
            if(['rect', 'circle', 'line', 'sticky', 'occlude'].includes(currentTool)) currentStroke.rectEnd = pos; 
        }
    });
    canvas.addEventListener('dblclick', (e) => {
        if (pointerLockActive || currentTool !== 'pan') return;
        const hit = _findStickyAt(getMousePos(e));
        if (hit) { e.preventDefault(); showStickyEditor(hit, { existing: true }); }
    });
    canvas.addEventListener('mousemove', (e) => {
        if (pointerLockActive) {
            // Accumulate raw deltas into mock position, clamped to canvas bounds
            mockX = Math.max(0, Math.min(canvas.width,  mockX + e.movementX));
            mockY = Math.max(0, Math.min(canvas.height, mockY + e.movementY));
            const pos = mockToWorld();

            if (isPanning) {
                camera.x = mockX - startPan.x;
                camera.y = mockY - startPan.y;
                redrawCanvas(); drawVirtualCursor();
            } else if (hoverDrawActive && currentTool === 'draw') {
                if (!currentStroke) {
                    currentStroke = { tool: 'draw', color: (canvasCurrentColor || state.settings.accent), points: [pos], workspaceId: state.activeWorkspace };
                    isDrawing = true;
                } else {
                    currentStroke.points.push(pos);
                    redrawCanvas(); drawTempStroke(currentStroke); drawVirtualCursor();
                }
            } else if (isDrawing && currentStroke) {
                if (currentTool === 'draw') currentStroke.points.push(pos);
                else if (['rect', 'circle', 'line', 'sticky', 'occlude'].includes(currentTool)) currentStroke.rectEnd = pos;
                redrawCanvas(); drawTempStroke(currentStroke); drawVirtualCursor();
            } else {
                // Just moving — redraw to update virtual cursor position
                redrawCanvas(); drawVirtualCursor();
            }
            return;
        }

        if (isPanning) { camera.x = e.clientX - startPan.x; camera.y = e.clientY - startPan.y; redrawCanvas(); } 
        else if (hoverDrawActive && currentTool === 'draw') {
            const pos = getMousePos(e);
            if (!currentStroke) {
                currentStroke = { tool: 'draw', color: (canvasCurrentColor || state.settings.accent), points: [pos], workspaceId: state.activeWorkspace };
                isDrawing = true;
            } else {
                currentStroke.points.push(pos);
                redrawCanvas(); drawTempStroke(currentStroke);
            }
        } else if (isDrawing && currentStroke) { 
            const pos = getMousePos(e);
            if (currentTool === 'eraser') {
                // Add point and do a real-time erase preview
                currentStroke.points.push(pos);
                // Render eraser stroke live without permanently committing
                redrawCanvas();
                ctx.save();
                ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
                ctx.lineWidth = eraserSize * 2;
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
                for (let i = 1; i < currentStroke.points.length; i++) ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
                ctx.stroke();
                ctx.restore();
            } else if(currentTool === 'draw') {
                currentStroke.points.push(pos);
                redrawCanvas(); drawTempStroke(currentStroke);
            } else if(['rect', 'circle', 'line', 'sticky', 'occlude'].includes(currentTool)) {
                currentStroke.rectEnd = pos;
                redrawCanvas(); drawTempStroke(currentStroke);
            }
        }
    });
    canvas.addEventListener('mouseup', (e) => {
        if (pointerLockActive && e.button === 2) { isPanning = false; return; }
        endAction();
    });
    canvas.addEventListener('mouseleave', endAction);
    canvas.addEventListener('contextmenu', (e) => { if (pointerLockActive) e.preventDefault(); });
    canvas.addEventListener('wheel', (e) => { 
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        let mx, my;
        if (pointerLockActive) {
            mx = mockX; my = mockY;
        } else {
            const rect = canvas.getBoundingClientRect();
            mx = e.clientX - rect.left; my = e.clientY - rect.top;
        }
        const wx = (mx - camera.x) / camera.zoom; const wy = (my - camera.y) / camera.zoom;
        camera.zoom = Math.max(0.1, Math.min(camera.zoom * zoomDelta, 10));
        camera.x = mx - wx * camera.zoom; camera.y = my - wy * camera.zoom;
        redrawCanvas();
        if (pointerLockActive) drawVirtualCursor();
    }, {passive: false});
}

function handleTextTool(pos) {
    // Spawn a draggable, resizable text box overlay over the canvas
    const canvasRect = canvas.getBoundingClientRect();
    // Convert world pos back to screen pos
    const screenX = pos.x * camera.zoom + camera.x + canvasRect.left;
    const screenY = pos.y * camera.zoom + camera.y + canvasRect.top;

    const box = document.createElement('div');
    box.id = 'canvas-text-box-' + Date.now();
    box.style.cssText = `
        position: fixed;
        left: ${screenX}px;
        top: ${screenY}px;
        width: 220px;
        min-height: 60px;
        background: rgba(var(--bg-sidebar), 0.96);
        border: 1.5px solid rgb(var(--accent));
        border-radius: 8px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        z-index: 9990;
        display: flex;
        flex-direction: column;
        resize: both;
        overflow: auto;
        font-family: Inter, sans-serif;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        cursor: move;
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 700;
        color: rgb(var(--accent));
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: rgba(var(--accent), 0.12);
        border-bottom: 1px solid rgba(var(--accent), 0.2);
        border-radius: 7px 7px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
    `;
    header.innerHTML = `<span>Text Box</span><div style="display:flex;gap:6px;align-items:center">
        <select id="${box.id}-size" style="font-size:10px;background:transparent;color:rgb(var(--text-muted));border:none;outline:none;cursor:pointer">
          <option value="14">S</option><option value="20" selected>M</option><option value="28">L</option><option value="40">XL</option>
        </select>
        <button onclick="commitTextBox('${box.id}')" style="font-size:10px;padding:1px 7px;background:rgb(var(--accent));color:white;border:none;border-radius:4px;cursor:pointer;font-weight:700">Done</button>
        <button onclick="document.getElementById('${box.id}').remove()" style="font-size:13px;background:none;border:none;color:rgb(var(--text-muted));cursor:pointer;line-height:1">&times;</button>
    </div>`;

    const ta = document.createElement('textarea');
    ta.placeholder = 'Type here...';
    ta.style.cssText = `
        flex: 1;
        min-height: 50px;
        background: transparent;
        border: none;
        outline: none;
        resize: none;
        padding: 8px 10px;
        font-size: 16px;
        color: rgb(var(--text-main));
        font-family: Inter, sans-serif;
        line-height: 1.5;
    `;
    // Update font size from select
    header.querySelector(`#${box.id}-size`).addEventListener('change', function(){ ta.style.fontSize = this.value + 'px'; });

    box.appendChild(header);
    box.appendChild(ta);
    document.body.appendChild(box);
    ta.focus();

    // Dragging — use named handlers so they can be removed when box is gone
    let dragging = false, dragOffX = 0, dragOffY = 0;
    const _onDragMove = (e) => {
        if (!dragging) return;
        box.style.left = (e.clientX - dragOffX) + 'px';
        box.style.top  = (e.clientY - dragOffY) + 'px';
    };
    const _onDragUp = () => { dragging = false; };
    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        dragging = true;
        dragOffX = e.clientX - box.getBoundingClientRect().left;
        dragOffY = e.clientY - box.getBoundingClientRect().top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', _onDragMove);
    window.addEventListener('mouseup', _onDragUp);

    // Store reference for commit
    box._worldPos = pos;
    box._sizeEl = header.querySelector(`#${box.id}-size`);
    box._ta = ta;

    // Commit on Enter+Ctrl shortcut
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitTextBox(box.id); }
        if (e.key === 'Escape') {
            window.removeEventListener('mousemove', _onDragMove);
            window.removeEventListener('mouseup', _onDragUp);
            box.remove();
        }
    });
}

function commitTextBox(boxId) {
    const box = document.getElementById(boxId);
    if (!box) return;
    // Clean up drag listeners
    if (box._onDragMove) window.removeEventListener('mousemove', box._onDragMove);
    if (box._onDragUp)   window.removeEventListener('mouseup',   box._onDragUp);
    const txt = box._ta.value.trim();
    const fontSize = parseInt(box._sizeEl.value) || 20;
    if (txt) {
        const stroke = {
            tool: 'text',
            color: (canvasCurrentColor || state.settings.accent),
            points: [box._worldPos],
            text: txt,
            fontSize: fontSize,
            workspaceId: state.activeWorkspace
        };
        state.canvasStrokes.push(stroke);
        saveDataToDB();
        redrawCanvas();
    }
    box.remove();
}

function showStickyEditor(stroke, options = {}) {
    // Sticky notes are lightweight canvas objects: title + body + color.
    // Existing notes can be opened again with a double-click.
    const existing = !!options.existing;
    const canvasRect = canvas.getBoundingClientRect();
    const p0 = stroke.points?.[0] || { x: 0, y: 0 };
    const p1 = stroke.rectEnd || { x: p0.x + 220, y: p0.y + 140 };
    const x1 = Math.min(p0.x, p1.x), y1 = Math.min(p0.y, p1.y);
    const w = Math.max(220, Math.abs(p1.x - p0.x));
    const h = Math.max(140, Math.abs(p1.y - p0.y));
    stroke.points = [{ x: x1, y: y1 }];
    stroke.rectEnd = { x: x1 + w, y: y1 + h };

    const screenX = x1 * camera.zoom + camera.x + canvasRect.left;
    const screenY = y1 * camera.zoom + camera.y + canvasRect.top;
    const screenW = Math.max(240, w * camera.zoom);
    const screenH = Math.max(170, h * camera.zoom);
    const colors = [
        { name:'Warm', value:'#fde68a' },
        { name:'Blue', value:'#bfdbfe' },
        { name:'Green', value:'#bbf7d0' },
        { name:'Pink', value:'#fbcfe8' },
        { name:'Lavender', value:'#ddd6fe' }
    ];
    const noteColor = stroke.noteColor || '#fde68a';

    const box = document.createElement('div');
    box.id = 'sticky-editor-' + Date.now();
    box.className = 'sticky-editor';
    box.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;width:${screenW}px;min-height:${screenH}px;z-index:9990;`;

    const colorButtons = colors.map(c => `<button type="button" class="sticky-color" data-color="${c.value}" title="${c.name}" aria-label="${c.name}" style="background:${c.value}"></button>`).join('');
    box.innerHTML = `
      <div class="sticky-editor-head">
        <div class="sticky-editor-drag"><span class="sticky-editor-dot"></span><span>${existing ? 'Edit note' : 'New note'}</span></div>
        <div class="sticky-editor-actions">
          ${existing ? `<button type="button" data-action="delete" class="sticky-editor-danger">Delete</button>` : ''}
          <button type="button" data-action="cancel" class="sticky-editor-muted">Cancel</button>
          <button type="button" data-action="save" class="sticky-editor-save">Save</button>
        </div>
      </div>
      <div class="sticky-editor-body">
        <input class="sticky-title" type="text" maxlength="80" placeholder="Title (optional)" value="${String(stroke.title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}">
        <textarea class="sticky-content" maxlength="1200" placeholder="Write a short note…">${String(stroke.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
        <div class="sticky-editor-footer">
          <div class="sticky-palette" aria-label="Note color">${colorButtons}</div>
          <span class="sticky-count">0 / 1200</span>
          <span class="sticky-shortcut">Ctrl/Cmd + Enter to save</span>
        </div>
      </div>`;

    document.body.appendChild(box);
    const titleEl = box.querySelector('.sticky-title');
    const contentEl = box.querySelector('.sticky-content');
    const countEl = box.querySelector('.sticky-count');
    let selectedColor = noteColor;
    const updateCount = () => { countEl.textContent = `${contentEl.value.length} / 1200`; };
    const paintSelection = () => box.querySelectorAll('.sticky-color').forEach(btn => btn.classList.toggle('selected', btn.dataset.color === selectedColor));
    box.querySelectorAll('.sticky-color').forEach(btn => btn.addEventListener('click', () => { selectedColor = btn.dataset.color; paintSelection(); }));
    paintSelection(); updateCount();

    const removeBox = () => {
        if (box._onDragMove) window.removeEventListener('mousemove', box._onDragMove);
        if (box._onDragUp) window.removeEventListener('mouseup', box._onDragUp);
        box.remove();
    };
    const save = () => {
        const title = titleEl.value.trim();
        const text = contentEl.value.trim();
        if (!title && !text) { removeBox(); return; }
        stroke.title = title;
        stroke.text = text;
        stroke.noteColor = selectedColor;
        if (!existing) state.canvasStrokes.push(stroke);
        saveDataToDB(); redrawCanvas(); removeBox();
    };
    const remove = () => {
        if (existing) {
            const idx = state.canvasStrokes.indexOf(stroke);
            if (idx >= 0) state.canvasStrokes.splice(idx, 1);
            saveDataToDB(); redrawCanvas();
        }
        removeBox();
    };
    box.querySelector('[data-action="save"]').addEventListener('click', save);
    box.querySelector('[data-action="cancel"]').addEventListener('click', removeBox);
    box.querySelector('[data-action="delete"]')?.addEventListener('click', remove);
    contentEl.addEventListener('input', updateCount);
    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
    contentEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.preventDefault(); removeBox(); }
    });

    // Drag the editor without stealing focus from its fields.
    const dragHandle = box.querySelector('.sticky-editor-drag');
    let dragging = false, dx = 0, dy = 0;
    dragHandle.addEventListener('mousedown', e => {
        dragging = true;
        const r = box.getBoundingClientRect();
        dx = e.clientX - r.left; dy = e.clientY - r.top;
        e.preventDefault();
    });
    box._onDragMove = e => { if (!dragging) return; box.style.left = `${e.clientX - dx}px`; box.style.top = `${e.clientY - dy}px`; };
    box._onDragUp = () => { dragging = false; };
    window.addEventListener('mousemove', box._onDragMove);
    window.addEventListener('mouseup', box._onDragUp);
    setTimeout(() => titleEl.focus(), 0);
}

function _findStickyAt(worldPos) {
    const strokes = state.canvasStrokes.filter(s => s.workspaceId === state.activeWorkspace && s.tool === 'sticky' && s.points?.[0] && s.rectEnd);
    for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        const x1 = Math.min(s.points[0].x, s.rectEnd.x), x2 = Math.max(s.points[0].x, s.rectEnd.x);
        const y1 = Math.min(s.points[0].y, s.rectEnd.y), y2 = Math.max(s.points[0].y, s.rectEnd.y);
        if (worldPos.x >= x1 && worldPos.x <= x2 && worldPos.y >= y1 && worldPos.y <= y2) return s;
    }
    return null;
}

function endAction() {
    if (isDrawing && currentStroke) {
        if (currentStroke.tool === 'sticky') {
            const stroke = currentStroke;
            isDrawing = false; isPanning = false; currentStroke = null;
            canvas.style.cursor = 'crosshair';
            redrawCanvas();
            showStickyEditor(stroke, { existing: false });
            return;
        } else if (currentStroke.tool === 'occlude') {
            currentStroke.revealed = false;
            const w = Math.abs((currentStroke.rectEnd?.x||0) - currentStroke.points[0].x);
            const h = Math.abs((currentStroke.rectEnd?.y||0) - currentStroke.points[0].y);
            if (w > 4 && h > 4) { state.canvasStrokes.push(currentStroke); saveDataToDB(); }
        } else if (currentStroke.tool === 'eraser') {
            // Eraser strokes are saved so they persist across redraws
            if (currentStroke.points.length > 0) { state.canvasStrokes.push(currentStroke); saveDataToDB(); }
        } else {
            state.canvasStrokes.push(currentStroke); saveDataToDB();
        }
    }
    isDrawing = false; isPanning = false; currentStroke = null;
    if (currentTool !== 'pan' && currentTool !== 'eraser' && currentTool !== 'fill') canvas.style.cursor = 'crosshair';
    redrawCanvas();
}

// ── FILL (BUCKET) TOOL LOGIC ──────────────────────────────────────────

// Sync the bucket icon color in the custom cursor
function _syncFillCursorColor() {
    const el = document.getElementById('fill-cursor-bucket');
    if (el) el.setAttribute('fill', canvasCurrentColor || '#8b5cf6');
}

// Find the topmost stroke at a given world point that can be filled (rect/circle/sticky)
function _findFillableStroke(worldPos) {
    const strokes = state.canvasStrokes.filter(s => s.workspaceId === state.activeWorkspace);
    for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        if (!s.points[0]) continue;

        if ((s.tool === 'rect' || s.tool === 'sticky') && s.rectEnd) {
            const x1 = Math.min(s.points[0].x, s.rectEnd.x), x2 = Math.max(s.points[0].x, s.rectEnd.x);
            const y1 = Math.min(s.points[0].y, s.rectEnd.y), y2 = Math.max(s.points[0].y, s.rectEnd.y);
            if (worldPos.x >= x1 && worldPos.x <= x2 && worldPos.y >= y1 && worldPos.y <= y2) {
                return { stroke: s, shape: s.tool };
            }
        }

        if (s.tool === 'circle' && s.rectEnd) {
            const dx = s.rectEnd.x - s.points[0].x, dy = s.rectEnd.y - s.points[0].y;
            const r = Math.sqrt(dx*dx + dy*dy);
            const pdx = worldPos.x - s.points[0].x, pdy = worldPos.y - s.points[0].y;
            if (Math.sqrt(pdx*pdx + pdy*pdy) <= r) {
                return { stroke: s, shape: 'circle' };
            }
        }
    }
    return null;
}

function applyFillTool(worldPos) {
    const hit = _findFillableStroke(worldPos);
    if (!hit) {
        // No shape hit — flash a brief "miss" indicator on canvas
        const { x, y } = worldPos;
        ctx.save();
        ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
        ctx.strokeStyle = 'rgba(255,100,100,0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
        setTimeout(redrawCanvas, 300);
        toast('Click inside a shape to fill it', 'info');
        return;
    }

    // Check if a fill-shape for this stroke already exists
    const existing = state.canvasStrokes.findIndex(
        s => s.tool === 'fill-shape' && s._fillTargetId === hit.stroke._id
    );
    const fillStroke = {
        tool: 'fill-shape',
        fillShape: hit.shape,
        color: canvasCurrentColor || '#8b5cf6',
        fillAlpha: 0.55,
        points: [{ ...hit.stroke.points[0] }],
        rectEnd: hit.stroke.rectEnd ? { ...hit.stroke.rectEnd } : { ...hit.stroke.points[0] },
        workspaceId: state.activeWorkspace,
        _fillTargetId: hit.stroke._id
    };

    // Assign a stable ID to the target stroke so we can update fills
    if (!hit.stroke._id) hit.stroke._id = 'stroke-' + Date.now();

    if (existing >= 0) {
        // Update existing fill (color change)
        state.canvasStrokes[existing].color = fillStroke.color;
        state.canvasStrokes[existing].points = fillStroke.points;
        state.canvasStrokes[existing].rectEnd = fillStroke.rectEnd;
    } else {
        // Insert fill stroke right after the target stroke so it renders on top of it
        const targetIdx = state.canvasStrokes.indexOf(hit.stroke);
        state.canvasStrokes.splice(targetIdx + 1, 0, fillStroke);
    }
    saveDataToDB(); redrawCanvas();
    toast('Filled with ' + (canvasCurrentColor || 'accent color'));
}

// ── ERASER CURSOR TRACKING ────────────────────────────────────────────
(() => {
    // Deferred setup — canvas is assigned in initCanvas() before this is called
    window._eraserMouseSetup = function() {
        canvas.addEventListener('mousemove', (e) => {
            const ec = eraserCursorEl();
            const fc = fillCursorEl();
            if (currentTool === 'eraser' && ec) {
                ec.style.display = 'block';
                ec.style.left = e.clientX + 'px';
                ec.style.top  = e.clientY + 'px';
                ec.style.width  = eraserSize * 2 + 'px';
                ec.style.height = eraserSize * 2 + 'px';
            } else if (ec) { ec.style.display = 'none'; }

            if (currentTool === 'fill' && fc) {
                fc.style.display = 'block';
                fc.style.left = e.clientX + 'px';
                fc.style.top  = e.clientY + 'px';
            } else if (fc) { fc.style.display = 'none'; }
        });
        canvas.addEventListener('mouseleave', () => {
            const ec = eraserCursorEl(); if (ec) ec.style.display = 'none';
            const fc = fillCursorEl();   if (fc) fc.style.display = 'none';
        });
    };
})();

function toggleOcclusionAt(pos){
    // Iterate top-most first
    const strokes = state.canvasStrokes.filter(s => s.workspaceId === state.activeWorkspace && s.tool === 'occlude');
    for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        if (!s.points[0] || !s.rectEnd) continue;
        const x1 = Math.min(s.points[0].x, s.rectEnd.x), x2 = Math.max(s.points[0].x, s.rectEnd.x);
        const y1 = Math.min(s.points[0].y, s.rectEnd.y), y2 = Math.max(s.points[0].y, s.rectEnd.y);
        if (pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2) {
            s.revealed = !s.revealed;
            saveDataToDB(); redrawCanvas();
            return true;
        }
    }
    return false;
}
function resizeCanvas() { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; }
let _resizeDebounce = null;
window.addEventListener('resize', () => {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(() => {
        if(canvas) { resizeCanvas(); redrawCanvas(); }
    }, 150);
});

// ── CANVAS KEYBOARD SHORTCUTS (1-9 numeric) ──
document.addEventListener('keydown', (e) => {
    if (currentApp !== 'canvas') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The configured hover-draw key is handled by the global hold-to-draw
    // listener below. It must never also select a persistent canvas tool.
    if (e.key.toLowerCase() === (state.settings.hoverDrawKey || 'f').toLowerCase()) return;
    const numMap = {
        '1':'pan','2':'draw','3':'rect','4':'circle','5':'line',
        '6':'text','7':'sticky','8':'eraser','9':'fill'
    };

    const letterMap = {
        'p':'pan','d':'draw','r':'rect','c':'circle','l':'line',
        't':'text','s':'sticky','e':'eraser'
    };
    const tool = numMap[e.key] || letterMap[e.key.toLowerCase()];
    if (tool) {
        const btn = document.querySelector(`.canvas-btn[data-tool="${tool}"]`);
        if (btn) { setTool(tool, btn); e.preventDefault(); }
    }
});
// ── ERASER state ──────────────────────────────────────────────
let eraserSize = 20;
const eraserCursorEl = () => document.getElementById('eraser-cursor');
const fillCursorEl   = () => document.getElementById('fill-cursor');

function updateEraserSize(val) {
    eraserSize = parseInt(val);
    const lbl = document.getElementById('eraser-size-label');
    if (lbl) lbl.textContent = eraserSize;
    const ec = eraserCursorEl();
    if (ec) { ec.style.width = eraserSize * 2 + 'px'; ec.style.height = eraserSize * 2 + 'px'; }
}

function setTool(t, btn) {
    currentTool = t;
    document.querySelectorAll('.canvas-btn').forEach(b => b.classList.remove('tool-active'));
    btn.classList.add('tool-active');

    // Cursor style
    if (t === 'pan') {
        canvas.style.cursor = 'grab';
    } else if (t === 'eraser') {
        canvas.style.cursor = 'none'; // we draw our own circle cursor
    } else if (t === 'fill') {
        canvas.style.cursor = 'none'; // custom bucket cursor
    } else {
        canvas.style.cursor = 'crosshair';
    }

    // Eraser size slider visibility
    const sizeWrap = document.getElementById('eraser-size-wrap');
    if (sizeWrap) {
        if (t === 'eraser') sizeWrap.classList.remove('hidden'), sizeWrap.style.display = 'flex';
        else sizeWrap.classList.add('hidden'), sizeWrap.style.display = '';
    }

    // Hide custom cursors when switching away
    const ec = eraserCursorEl();
    const fc = fillCursorEl();
    if (ec) ec.style.display = (t === 'eraser') ? 'block' : 'none';
    if (fc) fc.style.display = (t === 'fill')   ? 'block' : 'none';

    // Update fill cursor color to match current color
    if (t === 'fill') _syncFillCursorColor();
}

// ── CANVAS COLOR ──────────────────────────────────────────────────────
let canvasCurrentColor = '#8b5cf6'; // default matches picker
function _resolveCanvasColor() {
    // Always read directly from the picker so it stays in sync
    const picker = document.getElementById('canvas-color-picker');
    if (canvasCurrentColor) return canvasCurrentColor;
    if (picker) return picker.value;
    return '#8b5cf6';
}
function setCanvasColor(hex) {
    canvasCurrentColor = hex;
    const picker = document.getElementById('canvas-color-picker');
    if (picker) picker.value = hex;
    // Keep fill cursor icon in sync
    _syncFillCursorColor();
}
function setCanvasColorPreset(hex) {
    setCanvasColor(hex);
}
function useAccentColor() {
    const accentRgb = getComputedStyle(document.body).getPropertyValue('--accent').trim().split(' ').map(Number);
    const hex = '#' + accentRgb.map(n => n.toString(16).padStart(2,'0')).join('');
    setCanvasColor(hex);
}
// Override the stroke color to use canvasCurrentColor
const _origInitCanvas = initCanvas;
// Patch getStrokeColor inline; used below in mousedown overrides via state.settings.accent fallback
// We patch currentStroke creation sites by overriding at draw time via renderStroke wrapper
const _origRenderStroke = renderStroke;
// ── GALLERY PICKER ─────────────────────────────────────────────────────
async function clearCanvas() { if(await showModal({title:'Clear Canvas?', type:'confirm'})){ state.canvasStrokes = state.canvasStrokes.filter(s => s.workspaceId !== state.activeWorkspace); saveDataToDB(); redrawCanvas(); } }
function getMousePos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - camera.x) / camera.zoom, y: (e.clientY - r.top - camera.y) / camera.zoom }; }
function getTouchPos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.touches[0].clientX - r.left - camera.x) / camera.zoom, y: (e.touches[0].clientY - r.top - camera.y) / camera.zoom }; }
function drawTempStroke(s) { ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom); renderStroke(s); ctx.restore(); }

// FEATURE: Multi-Primitive Rendering
function renderStroke(s) {
    // ERASER strokes use destination-out compositing
    if (s.tool === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = (s.eraserSize || 20) * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (s.points.length > 0) {
            ctx.beginPath();
            ctx.moveTo(s.points[0].x, s.points[0].y);
            if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y);
            else for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
            ctx.stroke();
        }
        ctx.restore();
        return;
    }

    ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.fillStyle = s.color;
    if (s.tool === 'draw' && s.points.length > 0) {
        ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
        if (s.points.length === 1) ctx.lineTo(s.points[0].x, s.points[0].y + 0.1); else for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
    } else if (s.tool === 'rect' && s.points[0] && s.rectEnd) {
        ctx.beginPath(); ctx.rect(s.points[0].x, s.points[0].y, s.rectEnd.x - s.points[0].x, s.rectEnd.y - s.points[0].y); ctx.stroke();
    } else if (s.tool === 'circle' && s.points[0] && s.rectEnd) {
        let dx = s.rectEnd.x - s.points[0].x; let dy = s.rectEnd.y - s.points[0].y; let r = Math.sqrt(dx*dx + dy*dy);
        ctx.beginPath(); ctx.arc(s.points[0].x, s.points[0].y, r, 0, 2*Math.PI); ctx.stroke();
    } else if (s.tool === 'line' && s.points[0] && s.rectEnd) {
        ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y); ctx.lineTo(s.rectEnd.x, s.rectEnd.y); ctx.stroke();
    } else if (s.tool === 'text' && s.points[0]) {
        const fs = s.fontSize || 20;
        ctx.font = `${fs}px Inter, sans-serif`; ctx.fillText(s.text, s.points[0].x, s.points[0].y);
    } else if (s.tool === 'sticky' && s.points[0] && s.rectEnd) {
        const x = Math.min(s.points[0].x, s.rectEnd.x);
        const y = Math.min(s.points[0].y, s.rectEnd.y);
        const w = Math.abs(s.rectEnd.x - s.points[0].x);
        const h = Math.abs(s.rectEnd.y - s.points[0].y);
        const palette = { '#fde68a':['#422006','#d97706'], '#bfdbfe':['#172554','#2563eb'], '#bbf7d0':['#052e16','#16a34a'], '#fbcfe8':['#500724','#db2777'], '#ddd6fe':['#2e1065','#7c3aed'] };
        const colors = palette[s.noteColor] || palette['#fde68a'];
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
        ctx.fillStyle = s.noteColor || '#fde68a';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = colors[1]; ctx.lineWidth = 1; ctx.stroke();
        // folded corner
        ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.moveTo(x+w-22,y); ctx.lineTo(x+w,y+22); ctx.lineTo(x+w-22,y+22); ctx.closePath(); ctx.fill(); ctx.restore();
        const pad = 12;
        if (s.title) { ctx.fillStyle = colors[0]; ctx.font = '700 14px Inter, sans-serif'; wrapCanvasText(ctx, s.title, x + pad, y + 22, Math.max(40,w-pad*2), 18); }
        if (s.text) {
            ctx.fillStyle = colors[0];
            ctx.font = '13px Inter, sans-serif';
            const bodyY = s.title ? y + 46 : y + 24;
            wrapCanvasText(ctx, s.text, x + pad, bodyY, Math.max(40,w-pad*2), 18);
        }
    } else if (s.tool === 'fill-shape' && s.points[0] && s.rectEnd) {
        // A filled rect, circle, etc. — drawn solid
        ctx.save();
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.fillAlpha || 0.55;
        if (s.fillShape === 'rect') {
            const x = Math.min(s.points[0].x, s.rectEnd.x);
            const y = Math.min(s.points[0].y, s.rectEnd.y);
            const w = Math.abs(s.rectEnd.x - s.points[0].x);
            const h = Math.abs(s.rectEnd.y - s.points[0].y);
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h);
            ctx.fill();
        } else if (s.fillShape === 'circle') {
            const dx = s.rectEnd.x - s.points[0].x, dy = s.rectEnd.y - s.points[0].y;
            ctx.beginPath();
            ctx.arc(s.points[0].x, s.points[0].y, Math.sqrt(dx*dx+dy*dy), 0, Math.PI*2);
            ctx.fill();
        } else if (s.fillShape === 'sticky') {
            const x = Math.min(s.points[0].x, s.rectEnd.x);
            const y = Math.min(s.points[0].y, s.rectEnd.y);
            const w = Math.abs(s.rectEnd.x - s.points[0].x);
            const h = Math.abs(s.rectEnd.y - s.points[0].y);
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
            ctx.fill();
        }
        ctx.restore();
    } else if (s.tool === 'occlude' && s.points[0] && s.rectEnd) {
        const x = Math.min(s.points[0].x, s.rectEnd.x);
        const y = Math.min(s.points[0].y, s.rectEnd.y);
        const w = Math.abs(s.rectEnd.x - s.points[0].x);
        const h = Math.abs(s.rectEnd.y - s.points[0].y);
        if (s.revealed) {
            ctx.save();
            ctx.strokeStyle = 'rgba(99,102,241,0.6)';
            ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
            ctx.strokeRect(x, y, w, h);
            ctx.restore();
        } else {
            ctx.save();
            ctx.fillStyle = 'rgba(30,41,59,0.92)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(99,102,241,0.8)'; ctx.lineWidth = 1.5;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = '#cbd5e1';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('tap (pan) to reveal', x + w/2, y + h/2);
            ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
            ctx.restore();
        }
    }
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight){
    const words = String(text).split(/\s+/);
    let line = '';
    for (let i = 0; i < words.length; i++) {
        const test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y); line = words[i]; y += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, x, y);
}
function redrawCanvas() { 
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom); 
    state.canvasStrokes.filter(s => s.workspaceId === state.activeWorkspace).forEach(renderStroke); 
    ctx.restore();
    if (pointerLockActive) drawVirtualCursor();
}

