/* --- KNOWLEDGE GRAPH & BRIDGE --- */
let graphSimulation = null;
function renderKnowledgeGraph() {
    setTimeout(() => {
        const container = document.getElementById('d3-graph-container'); container.innerHTML = '';
        if (graphSimulation) graphSimulation.stop();
        const width = container.clientWidth || 800; const height = container.clientHeight || 600;

        // Fetch Force Slider Params
        const fDist = parseInt(document.getElementById('graph-dist').value);
        const fCharge = parseInt(document.getElementById('graph-charge').value);
        const fCollide = parseInt(document.getElementById('graph-collide').value);

        const nodesMap = {}; const nodes = []; const links = [];
        const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);

        // FEATURE: tag filter + orphan toggle
        const tagFilterRaw = (document.getElementById('graph-tag-filter')?.value || '').toLowerCase().trim();
        const tagFilters = tagFilterRaw ? tagFilterRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
        const includeOrphans = document.getElementById('graph-include-orphans')?.checked ?? true;
        const colorMode = document.getElementById('graph-color-mode')?.value || 'tag';

        const matchesTagFilter = (note) => {
            if (!tagFilters.length) return true;
            const noteTags = (note.tags || '').toLowerCase();
            const bodyHashTags = (note.body || '').toLowerCase();
            return tagFilters.some(t => noteTags.includes(t) || bodyHashTags.includes('#' + t));
        };

        const filteredNotes = wsNotes.filter(matchesTagFilter);
        filteredNotes.forEach(note => {
            const node = { id: note.id, title: note.title || 'Untitled', tags: note.tags, workspaceId: note.workspaceId, degree: 0 };
            nodesMap[(note.title || 'Untitled').toLowerCase()] = node; nodes.push(node);
        });
        filteredNotes.forEach(note => {
            const regex = /\[\[(.*?)\]\]/g; let match;
            while ((match = regex.exec(note.body)) !== null) {
                const target = nodesMap[match[1].toLowerCase()];
                if (target) {
                    links.push({ source: note.id, target: target.id });
                    target.degree++;
                    const src = nodes.find(n => n.id === note.id); if (src) src.degree++;
                }
            }
        });

        // Filter orphans if disabled
        let activeNodes = nodes;
        if (!includeOrphans) activeNodes = nodes.filter(n => n.degree > 0);
        const nodeIds = new Set(activeNodes.map(n => n.id));
        const activeLinks = links.filter(l => nodeIds.has(typeof l.source === 'object' ? l.source.id : l.source) && nodeIds.has(typeof l.target === 'object' ? l.target.id : l.target));

        if(activeNodes.length === 0) { container.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-textMuted drop-shadow-md">you ahh does not have any notes idiot</div>'; document.getElementById('graph-legend').innerHTML = ''; return; }

        const svg = d3.select("#d3-graph-container").append("svg")
            .attr("width", width).attr("height", height)
            .style("touch-action", "none"); // let D3 handle all touch gestures

        // ── PAN + ZOOM (desktop scroll-wheel & trackpad, mobile pinch) ──────
        const zoomLayer = svg.append("g").attr("id", "graph-zoom-layer");

        const zoomBehaviour = d3.zoom()
            .scaleExtent([0.1, 8])
            .on("zoom", (event) => {
                zoomLayer.attr("transform", event.transform);
            });

        svg.call(zoomBehaviour)
           // Prevent the zoom from eating right-click context menu
           .on("dblclick.zoom", null);

        // Mobile hint + reset-view button (only shown on touch devices)
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            const resetBtn = document.createElement('button');
            resetBtn.textContent = '⌖ Reset View';
            resetBtn.style.cssText = `
                position:absolute; bottom:16px; right:16px; z-index:50;
                padding:8px 14px; font-size:12px; font-weight:600;
                border-radius:10px; border:1px solid rgb(var(--border-color));
                background:rgb(var(--bg-sidebar)); color:rgb(var(--text-muted));
                cursor:pointer; backdrop-filter:blur(8px);
            `;
            resetBtn.onclick = () => {
                svg.transition().duration(400)
                   .call(zoomBehaviour.transform, d3.zoomIdentity);
            };
            container.appendChild(resetBtn);
        }

        // FEATURE: color-by mode (tag / workspace / connectivity / accent)
        const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
        const maxDegree = Math.max(1, ...activeNodes.map(n => n.degree));
        const degreeColor = d3.scaleSequential(d3.interpolateViridis).domain([0, maxDegree]);
        const colorFor = (d) => {
            if (colorMode === 'workspace') {
                const ws = state.workspaces.find(w => w.id === d.workspaceId);
                return ws?.color || 'rgb(var(--accent))';
            }
            if (colorMode === 'degree') return degreeColor(d.degree);
            if (colorMode === 'none') return 'rgb(var(--accent))';
            return d.tags ? colorScale(d.tags.split(',')[0].trim().toLowerCase()) : 'rgb(var(--accent))';
        };

        // Build legend
        const legendEl = document.getElementById('graph-legend');
        if (legendEl) {
            if (colorMode === 'tag') {
                const tagSet = new Set();
                activeNodes.forEach(n => { if (n.tags) tagSet.add(n.tags.split(',')[0].trim().toLowerCase()); });
                legendEl.innerHTML = '<div class="text-textMuted font-semibold mb-1">Tags</div>' +
                    Array.from(tagSet).slice(0, 12).map(t => `<div class="flex items-center gap-2 py-0.5"><span class="inline-block w-3 h-3 rounded-full" style="background:${colorScale(t)}"></span><span class="text-textMain">${t || '—'}</span></div>`).join('') ||
                    '<div class="text-textMuted italic">No tags yet</div>';
            } else if (colorMode === 'workspace') {
                legendEl.innerHTML = '<div class="text-textMuted font-semibold mb-1">Workspaces</div>' +
                    state.workspaces.map(w => `<div class="flex items-center gap-2 py-0.5"><span class="inline-block w-3 h-3 rounded-full" style="background:${w.color}"></span><span class="text-textMain">${w.name}</span></div>`).join('');
            } else if (colorMode === 'degree') {
                legendEl.innerHTML = `<div class="text-textMuted font-semibold mb-1">Connectivity</div><div class="h-2 rounded" style="background:linear-gradient(90deg, ${degreeColor(0)}, ${degreeColor(maxDegree)})"></div><div class="flex justify-between text-[10px] text-textMuted mt-1"><span>0</span><span>${maxDegree}</span></div>`;
            } else {
                legendEl.innerHTML = '';
            }
        }

        graphSimulation = d3.forceSimulation(activeNodes)
            .force("link", d3.forceLink(activeLinks).id(d => d.id).distance(fDist))
            .force("charge", d3.forceManyBody().strength(fCharge))
            .force("collide", d3.forceCollide().radius(fCollide))
            .force("center", d3.forceCenter(width / 2, height / 2))
            // Stop simulation after it settles — prevents continuous rAF/CPU drain
            .alphaDecay(0.04)
            .on("end", () => { graphSimulation.stop(); });

        // All graph content goes inside zoomLayer so transforms apply correctly
        const link = zoomLayer.append("g").selectAll("line").data(activeLinks).enter().append("line").attr("class", "link");
        const node = zoomLayer.append("g").selectAll("circle").data(activeNodes).enter().append("circle")
            .attr("class", "node")
            .attr("r", d => (window.innerWidth < 768 ? 10 : 6) + Math.min(8, d.degree))
            .attr("fill", colorFor)
            .call(d3.drag()
                // Filter drag so it only fires on single-touch (not pinch)
                .filter(event => !event.ctrlKey && (event.type !== 'touchstart' || event.touches.length === 1))
                .on("start", (e,d)=>{ if(!e.active) graphSimulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
                .on("drag",  (e,d)=>{ d.fx=e.x; d.fy=e.y; })
                .on("end",   (e,d)=>{ if(!e.active) graphSimulation.alphaTarget(0); d.fx=null; d.fy=null; })
            );

        // FEATURE: Graph Node Click Popover
        const popover = document.getElementById('graph-popover');
        node.on("click", (event, d) => {
            const note = state.notes.find(n => n.id === d.id);
            if(note) {
                popover.innerHTML = renderMarkdownWithMath(note.body || '_Empty Note_');
                renderMathInElement(popover, {throwOnError: false});
                popover.style.left = (event.clientX + 15) + 'px';
                popover.style.top = (event.clientY + 15) + 'px';
                popover.classList.remove('hidden');
            }
        });

        const ctxMenu = document.getElementById('graph-context-menu');
        node.on("contextmenu", (event, d) => {
            event.preventDefault(); 
            let posX = event.pageX; let posY = event.pageY;
            ctxMenu.style.left = `${posX}px`; ctxMenu.style.top = `${posY}px`; ctxMenu.classList.remove('hidden');

            document.getElementById('ctx-jump').onclick = () => { switchApp('notes'); loadNoteIntoEditor(d.id); ctxMenu.classList.add('hidden'); };
            document.getElementById('ctx-move').onclick = async () => { 
                ctxMenu.classList.add('hidden');
                const data = await showModal({ title: 'Bridge to Workspace', type: 'form', fields: [{id: 'ws', label: 'Destination', type: 'select', options: state.workspaces.map(w=>w.name)}]});
                if(data && data.ws) {
                    const targetWs = state.workspaces.find(w => w.name === data.ws);
                    if(targetWs) { const note = state.notes.find(n => n.id === d.id); if(note) { note.workspaceId = targetWs.id; saveDataToDB(); renderKnowledgeGraph(); toast(`Bridged to ${targetWs.name}`); } }
                }
            };
            document.getElementById('ctx-delete').onclick = async () => { if(await showModal({title:'Delete Note?', type:'confirm'})){ state.notes = state.notes.filter(n=>n.id!==d.id); saveDataToDB(); renderKnowledgeGraph(); } ctxMenu.classList.add('hidden'); };
        });
        document.addEventListener('click', (e) => {
            if(!e.target.closest('.node')) {
                ctxMenu.classList.add('hidden');
                if(!e.target.closest('#graph-popover')) popover.classList.add('hidden');
            }
        });

        const labels = zoomLayer.append("g").selectAll("text").data(activeNodes).enter().append("text").attr("class", "node-label drop-shadow-md").attr("dy", -16).text(d => d.title);
        graphSimulation.on("tick", () => { link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y); node.attr("cx", d => d.x).attr("cy", d => d.y); labels.attr("x", d => d.x).attr("y", d => d.y); });
    }, 10);
}

