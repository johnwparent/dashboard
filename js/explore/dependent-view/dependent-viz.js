(function() {
    let cy = null;
    let rawGraphData = null;
    let loadedZip = null; 
    let rawZipBlob = null; 
    
    let currentFilteredNodes = [];
    let currentFilteredEdges = [];
    let explicitlyExpandedNodes = new Set();
    
    let currentDisplayMode = 'list'; 
    let currentGraphLayout = 'detailed'; 
    let listLimit = 10;
    const LIST_INCREMENT = 10;
    
    let currentSelectedNodeId = null;
    let currentSnippet = null;
    let currentLabel = "";

    const els = {
        get canvas() { return document.getElementById('cy'); },
        get fileUpload() { return document.getElementById('dv-file-upload'); },
        
        get phTitle() { return document.getElementById('ph-title'); },
        get phDesc() { return document.getElementById('ph-desc'); },
        get phDeps() { return document.getElementById('ph-stat-deps'); },
        get phOrgs() { return document.getElementById('ph-stat-orgs'); },
        
        get listSort() { return document.getElementById('list-sort-select'); },
        get listDepth() { return document.getElementById('list-depth-select'); },
        get toggleGroupOrg() { return document.getElementById('toggle-group-org'); },
        get toggleLeafNodes() { return document.getElementById('toggle-leaf-nodes'); },
        get tableBody() { return document.getElementById('dv-table-body'); },
        get listLoadMore() { return document.getElementById('list-load-more'); },
        get listShowing() { return document.getElementById('list-showing-count'); },
        get listTotal() { return document.getElementById('list-total-count'); },
        
        get graphLimit() { return document.getElementById('graph-limit'); },
        get graphLimitVal() { return document.getElementById('graph-limit-val'); },
        get zoomSlider() { return document.getElementById('zoom-slider'); },
        get searchInput() { return document.getElementById('node-search'); },
        get datalist() { return document.getElementById('node-list'); },
        
        get btnDetailed() { return document.getElementById('btn-view-detailed'); },
        get btnRadial() { return document.getElementById('btn-view-radial'); },
        
        get citationsContainer() { return document.getElementById('citations-container'); },
        
        get inspEmpty() { return document.getElementById('inspector-empty'); },
        get inspContent() { return document.getElementById('inspector-content'); },
        get inspTitle() { return document.getElementById('insp-title'); },
        get inspOwner() { return document.getElementById('insp-owner'); },
        get inspStars() { return document.getElementById('insp-stars'); },
        get inspContribs() { return document.getElementById('insp-contribs'); },
        get inspLicense() { return document.getElementById('insp-license'); },
        get inspDepth() { return document.getElementById('insp-depth'); },
        get inspPaper() { return document.getElementById('insp-paper'); },
        get inspSpdx() { return document.getElementById('insp-spdx'); }
    };

    window.switchTab = function(tabId) {
        document.querySelectorAll('.dv-tab-btn').forEach(b => b.classList.remove('active'));
        event.target.classList.add('active');
        
        document.querySelectorAll('.dv-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-' + tabId).classList.add('active');
        
        currentDisplayMode = tabId;
        
        if(tabId === 'graph') {
            if(!cy && rawGraphData) updateGraphState();
            if(cy) setTimeout(() => cy.resize(), 50);
        } else if (tabId === 'list') {
            renderMainView();
        }
    };

    function initTerminalLoader() {
        if(els.phTitle) els.phTitle.textContent = "Processing...";
        if(els.phDesc) els.phDesc.textContent = "Initializing audit engine...";
        if(els.tableBody) {
            els.tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="padding: 20px; background: #121212; border: none;">
                        <div id="dv-term" class="dv-terminal-loader">
                            <div class="dv-log-line"><span class="dv-log-time">[SYSTEM]</span> Ready for input.</div>
                        </div>
                    </td>
                </tr>`;
        }
    }

    function logProgress(msg, level="INFO") {
        const term = document.getElementById('dv-term');
        if (term) {
            const time = new Date().toISOString().split('T')[1].substring(0, 12);
            let tag = `<span class="dv-log-info">INFO</span>`;
            if (level === "WARN") tag = `<span class="dv-log-warn">WARN</span>`;
            if (level === "ERR")  tag = `<span class="dv-log-err">ERR!</span>`;
            
            term.innerHTML += `<div class="dv-log-line"><span class="dv-log-time">[${time}]</span> ${tag} ${msg}</div>`;
            term.scrollTop = term.scrollHeight;
        }
        if(els.phDesc) els.phDesc.textContent = msg;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    els.fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        initTerminalLoader();
        await sleep(200);
        logProgress(`Target acquired: ${file.name}`);

        if (file.name.endsWith('.zip')) {
            rawZipBlob = file; 
            try {
                logProgress("Mounting ZIP archive into memory...", "INFO");
                const jszip = new JSZip();
                await sleep(300);
                
                logProgress("Extracting manifest files...", "INFO");
                loadedZip = await jszip.loadAsync(file);
                
                const fileCount = Object.keys(loadedZip.files).length;
                logProgress(`Discovered ${fileCount} files in archive. Scanning for graph data...`);
                await sleep(300);

                let jsonFile = null;
                for (let filename in loadedZip.files) {
                    if (filename.endsWith('dependency_graph.json')) { jsonFile = loadedZip.files[filename]; break; }
                }
                if (!jsonFile) {
                    for (let filename in loadedZip.files) {
                        if (filename.endsWith('.json') && !filename.includes('spdx_snippets/')) { jsonFile = loadedZip.files[filename]; break; }
                    }
                }
                
                if (jsonFile) {
                    logProgress(`Graph target located: ${jsonFile.name}`, "INFO");
                    await sleep(300);
                    logProgress("Parsing Universal Dependency Graph...", "INFO");
                    const text = await jsonFile.async("string");
                    rawGraphData = JSON.parse(text);
                    
                    logProgress("Parse complete. Booting dashboard elements...", "INFO");
                    await sleep(400);
                    initializeDashboard();
                } else {
                    logProgress("No valid JSON graph found in the ZIP.", "ERR");
                    if(els.phTitle) els.phTitle.textContent = "Error: No JSON found";
                }
            } catch (err) {
                logProgress("Failed to read ZIP file.", "ERR");
                if(els.phTitle) els.phTitle.textContent = "Error reading ZIP";
            }
        } else if (file.name.endsWith('.json')) {
            loadedZip = null;
            rawZipBlob = null;
            const r = new FileReader();
            r.onload = async (ev) => {
                try {
                    logProgress("Parsing raw JSON graph...", "INFO");
                    rawGraphData = JSON.parse(ev.target.result);
                    logProgress("Parse complete. Booting dashboard elements...", "INFO");
                    await sleep(400);
                    initializeDashboard();
                } catch(x) { 
                    logProgress("Invalid JSON file.", "ERR");
                    if(els.phTitle) els.phTitle.textContent = "Error: Invalid JSON";
                }
            };
            r.readAsText(file);
        }
    });

    window.addEventListener('load', async () => {
        const params = new URLSearchParams(window.location.search);
        const remoteUrl = params.get('url');
        
        if (remoteUrl) {
            initTerminalLoader();
            await sleep(200);
            logProgress(`Initiating network request to remote host...`);
            logProgress(`GET ${remoteUrl}`);
            
            try {
                const response = await fetch(remoteUrl);
                if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
                
                logProgress(`Response 200 OK. Transferring payload...`);
                await sleep(300);

                if (remoteUrl.toLowerCase().split('?')[0].endsWith('.zip') || response.headers.get('content-type')?.includes('zip')) {
                    const blob = await response.blob();
                    rawZipBlob = blob;
                    logProgress(`Payload size: ${(blob.size / 1024).toFixed(2)} KB. Mounting ZIP...`);
                    
                    const jszip = new JSZip();
                    loadedZip = await jszip.loadAsync(blob);

                    const fileCount = Object.keys(loadedZip.files).length;
                    logProgress(`Discovered ${fileCount} files in archive. Scanning...`);
                    await sleep(300);

                    let jsonFile = null;
                    for (let filename in loadedZip.files) {
                        if (filename.endsWith('dependency_graph.json')) { jsonFile = loadedZip.files[filename]; break; }
                    }
                    if (!jsonFile) {
                        for (let filename in loadedZip.files) {
                            if (filename.endsWith('.json') && !filename.includes('spdx_snippets/')) { jsonFile = loadedZip.files[filename]; break; }
                        }
                    }
                    if (jsonFile) {
                        logProgress(`Graph target located: ${jsonFile.name}`, "INFO");
                        await sleep(200);
                        logProgress("Parsing Universal Dependency Graph...", "INFO");
                        const text = await jsonFile.async("string");
                        rawGraphData = JSON.parse(text);
                        
                        logProgress("Parse complete. Booting dashboard...", "INFO");
                        await sleep(400);
                        requestAnimationFrame(() => initializeDashboard());
                    } else { throw new Error("No JSON graph found in remote ZIP."); }
                } else {
                    logProgress("Parsing raw JSON payload...");
                    rawGraphData = await response.json();
                    window.remoteBaseUrl = remoteUrl.substring(0, remoteUrl.lastIndexOf('/'));
                    
                    logProgress("Parse complete. Booting dashboard...", "INFO");
                    await sleep(400);
                    requestAnimationFrame(() => initializeDashboard());
                }
            } catch (err) {
                logProgress(err.message, "ERR");
                if(els.phTitle) els.phTitle.textContent = "Data Fetch Failed";
            }
        }
    });

    function initializeDashboard() {
        if (!rawGraphData || !rawGraphData.nodes.length) return;
        
        const root = rawGraphData.nodes.find(n => n.type === 'library' && n.data.depth === 0) || rawGraphData.nodes[0];
        
        if(els.phTitle) els.phTitle.textContent = root.label;
        if(els.phDesc) els.phDesc.textContent = root.data.description || root.data.originUrl;
        
        const consumers = rawGraphData.nodes.filter(n => n.type === 'consumer');
        if(els.phDeps) els.phDeps.textContent = consumers.length;
        if(els.phOrgs) els.phOrgs.textContent = new Set(consumers.map(n => n.data.packageOwner).filter(Boolean)).size;

        listLimit = 10;
        explicitlyExpandedNodes.clear();
        if(els.graphLimit) els.graphLimit.value = 50;
        if(els.listDepth) els.listDepth.value = "10";
        
        renderCitations();
        
        currentFilteredNodes = rawGraphData.nodes;
        currentFilteredEdges = rawGraphData.edges;
        
        renderMainView();
        
        if(els.inspEmpty) els.inspEmpty.style.display = 'block';
        if(els.inspContent) els.inspContent.style.display = 'none';
        currentSelectedNodeId = null;
    }

    window.setGraphLayout = function(layout) {
        currentGraphLayout = layout;
        if (layout === 'detailed') {
            if(els.btnDetailed) els.btnDetailed.classList.add('dv-btn-active');
            if(els.btnRadial) els.btnRadial.classList.remove('dv-btn-active');
        } else {
            if(els.btnRadial) els.btnRadial.classList.add('dv-btn-active');
            if(els.btnDetailed) els.btnDetailed.classList.remove('dv-btn-active');
        }
        if (currentDisplayMode === 'graph') renderMainView();
    };

    window.renderMainView = function() {
        if (!rawGraphData) return;
        if (currentDisplayMode === 'list') {
            renderListView();
        } else if (currentDisplayMode === 'graph') {
            updateGraphState(); 
        }
    };

    function renderListView() {
        if (!els.tableBody) return;
        
        if (!rawGraphData.nodes.length) {
            els.tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No matching dependencies found.</td></tr>`;
            return;
        }

        const sortBy = els.listSort ? els.listSort.value : 'stars';
        const maxDepth = els.listDepth ? parseInt(els.listDepth.value) : 10;
        
        let nodes = rawGraphData.nodes.filter(n => n.type === 'consumer' && n.data.depth <= maxDepth);
        
        if (els.toggleLeafNodes && els.toggleLeafNodes.checked) {
            nodes = nodes.filter(n => {
                return !rawGraphData.edges.some(e => e.target === n.id);
            });
        }
        
        nodes.sort((a, b) => {
            try {
                if (sortBy === 'name') return (a.label || "").localeCompare(b.label || "");
                if (sortBy === 'stars') return (b.data.stars || 0) - (a.data.stars || 0);
                if (sortBy === 'contributors') return (b.data.contributors || 0) - (a.data.contributors || 0);
                if (sortBy === 'commits') return (b.data.commits || 0) - (a.data.commits || 0);
                if (sortBy === 'lastUpdate' || sortBy === 'latestRelease') {
                    const dateA = new Date(a.data[sortBy] || 0);
                    const dateB = new Date(b.data[sortBy] || 0);
                    const valA = isNaN(dateA) ? 0 : dateA.getTime();
                    const valB = isNaN(dateB) ? 0 : dateB.getTime();
                    return valB - valA;
                }
                return 0;
            } catch (e) { return 0; }
        });

        if(els.listTotal) els.listTotal.textContent = nodes.length;
        
        let html = '';
        const visibleNodes = nodes.slice(0, listLimit);
        if(els.listShowing) els.listShowing.textContent = visibleNodes.length;

        if (els.toggleGroupOrg && els.toggleGroupOrg.checked) {
            const grouped = {};
            visibleNodes.forEach(n => {
                const org = n.data.packageOwner || 'Unknown';
                if(!grouped[org]) grouped[org] = [];
                grouped[org].push(n);
            });
            
            for (const org in grouped) {
                html += `<tr class="dv-org-header"><td colspan="5">${org} (${grouped[org].length} packages)</td></tr>`;
                grouped[org].forEach(n => html += buildTableRow(n));
            }
        } else {
            visibleNodes.forEach(n => html += buildTableRow(n));
        }

        els.tableBody.innerHTML = html;
        if(els.listLoadMore) els.listLoadMore.style.display = listLimit < nodes.length ? 'block' : 'none';
    }

    function buildTableRow(n) {
        const d = n.data;
        const isFork = d.isFork ? `<span class="dv-badge">Fork</span>` : '';
        const isLeaf = !rawGraphData.edges.some(e => e.target === n.id) ? `<span class="dv-badge leaf">Leaf</span>` : '';
        
        let lastUp = '-';
        if (d.lastUpdate) {
            const parsedDate = new Date(d.lastUpdate);
            if (!isNaN(parsedDate)) {
                lastUp = parsedDate.toISOString().split('T')[0];
            }
        }
        
        window[`_node_data_${n.id}`] = n; 
        
        return `
            <tr onclick="inspectNode('${n.id}')" style="${currentSelectedNodeId === n.id ? 'background: #1a1a1a;' : ''}">
                <td style="font-weight: bold; color: #007bff;">${n.label} ${isFork} ${isLeaf}</td>
                <td>${d.packageOwner}</td>
                <td>L${d.depth}</td>
                <td>${d.stars || 0}</td>
                <td>${lastUp}</td>
            </tr>`;
    }

    window.loadMorePackages = function() {
        listLimit += LIST_INCREMENT;
        renderList();
    };
    window.renderList = renderListView;

    window.updateGraphState = function() {
        if (!rawGraphData) return;
        const maxNodes = parseInt(els.graphLimit ? els.graphLimit.value : 50);
        if(els.graphLimitVal) els.graphLimitVal.textContent = maxNodes;
        
        const root = rawGraphData.nodes.find(n => n.type === 'library' && n.data.depth === 0) || rawGraphData.nodes[0];
        const visible = new Set([root.id]);
        
        explicitlyExpandedNodes.forEach(nodeId => {
            visible.add(nodeId);
            rawGraphData.edges.filter(e => e.target === nodeId).forEach(e => visible.add(e.source));
        });

        const queue = [root.id];
        let count = visible.size;
        const adj = {};
        rawGraphData.edges.forEach(e => {
            if(!adj[e.target]) adj[e.target] = [];
            adj[e.target].push(e.source);
        });

        while(queue.length && count < maxNodes) {
            const curr = queue.shift();
            const neighbors = adj[curr] || [];
            for (const nId of neighbors) {
                if (count >= maxNodes) break;
                if (!visible.has(nId)) {
                    visible.add(nId);
                    queue.push(nId);
                    count++;
                }
            }
        }
        
        currentFilteredNodes = rawGraphData.nodes.filter(n => visible.has(n.id));
        currentFilteredEdges = rawGraphData.edges.filter(e => visible.has(e.source) && visible.has(e.target));
        
        currentFilteredNodes.forEach(n => n.data.degree = 0);
        currentFilteredEdges.forEach(e => {
            const tNode = currentFilteredNodes.find(n => n.id === e.target);
            if (tNode) tNode.data.degree += 1;
        });

        renderGraphView();
    };

    function renderGraphView() {
        if (!els.canvas) return;
        if (cy) { cy.destroy(); cy = null; }

        if (els.datalist) els.datalist.innerHTML = '';
        currentFilteredNodes.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n.label;
            if (els.datalist) els.datalist.appendChild(opt);
        });

        const maxDeg = Math.max(...currentFilteredNodes.map(n => n.data.degree), 1);

        const elements = [
            ...currentFilteredNodes.map(n => ({ group: 'nodes', data: { ...n.data, id: n.id, label: n.label, type: n.type } })),
            ...currentFilteredEdges.map(e => ({ group: 'edges', data: { source: e.source, target: e.target } }))
        ];
        
        let style, layout;

        if (currentGraphLayout === 'detailed') {
            style = [
                { selector: 'node', style: { 'label': 'data(label)', 'color': '#fff', 'background-color': '#444', 'width': 'label', 'height': 24, 'padding': 8, 'shape': 'round-rectangle', 'font-size': '12px', 'text-valign': 'center', 'border-width': 1, 'border-color': '#222' } },
                { selector: 'node[type="library"]', style: { 'background-color': '#d32f2f', 'color': '#fff', 'font-size': '14px', 'padding': 10 } },
                { selector: 'edge', style: { 'width': 2.5, 'line-color': '#999', 'line-opacity': 0.7, 'target-arrow-color': '#999', 'target-arrow-shape': 'triangle', 'curve-style': 'taxi', 'taxi-direction': 'downward', 'taxi-turn': 15 } },
                { selector: '.selected', style: { 'border-width': 2, 'border-color': '#007bff', 'background-color': '#0056b3' } }
            ];
            layout = { name: 'dagre', rankDir: 'TB', ranker: 'tight-tree', nodeSep: 30, edgeSep: 20, rankSep: 70, padding: 30 };
        } else {
            style = [
                { selector: 'node', style: { 'label': '', 'background-color': '#555', 'shape': 'ellipse', 'width': `mapData(degree, 0, ${maxDeg}, 15, 70)`, 'height': `mapData(degree, 0, ${maxDeg}, 15, 70)`, 'transition-property': 'border-width, border-color', 'transition-duration': '0.2s' } },
                { selector: 'node[type="library"]', style: { 'background-color': '#d32f2f', 'border-width': 3, 'border-color': '#fff', 'z-index': 10 } },
                { selector: 'node[type="consumer"]', style: { 'background-color': '#0277bd', 'z-index': 5 } },
                { selector: 'edge', style: { 'width': 2.5, 'line-color': '#fff', 'line-opacity': 0.5, 'curve-style': 'haystack', 'haystack-radius': 0.5 } },
                { selector: '.selected', style: { 'border-width': 4, 'border-color': '#007bff' } }
            ];
            layout = { 
                name: 'concentric', 
                concentric: function(node) { return 100 - node.data('depth'); },
                levelWidth: function() { return 1; },
                spacingFactor: 1.5,
                padding: 50
            };
        }

        cy = cytoscape({
            container: els.canvas,
            elements: elements,
            zoomingEnabled: true, userZoomingEnabled: true, panningEnabled: true, wheelSensitivity: 0.25, 
            style: style,
            layout: layout
        });

        cy.ready(() => {
            cy.fit(50);
            if(els.zoomSlider) els.zoomSlider.value = cy.zoom();
            if (currentSelectedNodeId) {
                cy.getElementById(currentSelectedNodeId).addClass('selected');
            }
        });

        cy.on('zoom', () => { if(els.zoomSlider) els.zoomSlider.value = cy.zoom(); });

        cy.on('tap', 'node', (evt) => {
            inspectNode(evt.target.id());
            cy.nodes().removeClass('selected');
            evt.target.addClass('selected');
        });
    }

    window.setZoom = function(val) {
        if(!cy || currentDisplayMode !== 'graph') return;
        cy.zoom({ level: parseFloat(val), renderedPosition: { x: els.canvas.clientWidth / 2, y: els.canvas.clientHeight / 2 } });
    };

    window.zoomBy = function(factor) {
        if(!cy || currentDisplayMode !== 'graph' || !els.zoomSlider) return;
        let current = parseFloat(els.zoomSlider.value);
        let next = current * factor;
        if (next > els.zoomSlider.max) next = els.zoomSlider.max;
        if (next < els.zoomSlider.min) next = els.zoomSlider.min;
        els.zoomSlider.value = next;
        setZoom(next);
    };

    window.searchNode = function() {
        if(!els.searchInput) return;
        const val = els.searchInput.value.toLowerCase();
        if(!cy || currentDisplayMode !== 'graph' || !val) return;
        
        const target = cy.nodes().filter(n => n.data('label').toLowerCase() === val || n.data('id').toLowerCase() === val).first();
        if(target.length) {
            cy.animate({ zoom: 1.8, center: { eles: target }, duration: 400 });
            cy.nodes().removeClass('selected');
            target.addClass('selected');
            inspectNode(target.id());
        } else {
            alert("Package not found in current view.");
        }
    };

    window.centerRoot = function() {
        if(!cy || currentDisplayMode !== 'graph') return;
        const root = cy.nodes('[type="library"]').first();
        if (root.length) {
            const z = 1.2;
            const pos = root.position();
            cy.animate({ zoom: z, pan: { x: (els.canvas.clientWidth / 2) - (pos.x * z), y: (els.canvas.clientHeight / 2) - (pos.y * z) }, duration: 400 });
        }
    };

    window.fitGraph = function() {
        if(!cy || currentDisplayMode !== 'graph') return;
        cy.animate({ fit: { padding: 50 }, duration: 400 });
    };

    window.exportImage = function() {
        if(!cy || currentDisplayMode !== 'graph') return;
        const b64 = cy.png({ full: true, scale: 2, bg: '#121212' });
        const a = document.createElement('a');
        a.href = b64;
        a.download = 'dependency_graph_export.png';
        a.click();
    };

    window.downloadAllSPDX = function() {
        if (!rawZipBlob) {
            alert("No SPDX ZIP archive is currently loaded.");
            return;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(rawZipBlob);
        a.download = 'spdx_manifests.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    window.inspectNode = async function(nodeId) {
        currentSelectedNodeId = nodeId;
        const node = rawGraphData.nodes.find(n => n.id === nodeId);
        if(!node) return;
        const d = node.data;

        if(els.inspEmpty) els.inspEmpty.style.display = 'none';
        if(els.inspContent) els.inspContent.style.display = 'flex';
        
        if(els.inspTitle) els.inspTitle.textContent = node.label;
        if(els.inspOwner) els.inspOwner.textContent = d.packageOwner;
        if(els.inspStars) els.inspStars.textContent = d.stars || 0;
        if(els.inspContribs) els.inspContribs.textContent = d.contributors || 0;
        if(els.inspLicense) els.inspLicense.textContent = d.license || 'None';
        if(els.inspDepth) els.inspDepth.textContent = d.depth === 0 ? 'Root' : `L${d.depth}`;
        
        if (d.paper && els.inspPaper) {
            els.inspPaper.style.display = 'block';
            els.inspPaper.innerHTML = `
                <div style="font-size: 0.8rem; font-weight: bold; margin-bottom: 4px; color: #fff;">Cited Work:</div>
                <div style="font-size: 0.8rem; color: #ccc;">${d.paper.title}</div>
                <div style="margin-top: 5px;"><a href="${d.paper.url || d.paper.joss_pdf || ('https://doi.org/' + d.paper.doi)}" target="_blank" style="color: #007bff; text-decoration: none; font-size: 0.8rem;">Read Paper</a></div>
            `;
        } else if (els.inspPaper) {
            els.inspPaper.style.display = 'none';
        }

        currentLabel = node.label;
        if(els.inspSpdx) els.inspSpdx.textContent = "Extracting SPDX manifest...";
        
        if (loadedZip && d.snippetPath) {
            try {
                const targetFileName = d.snippetPath.split('/').pop(); 
                let spdxFile = null;
                for (let path in loadedZip.files) {
                    if (path.endsWith(targetFileName)) { spdxFile = loadedZip.files[path]; break; }
                }
                if (spdxFile) {
                    currentSnippet = await spdxFile.async("string");
                    if(els.inspSpdx) els.inspSpdx.textContent = currentSnippet;
                } else {
                    if(els.inspSpdx) els.inspSpdx.textContent = `File not found in ZIP.`;
                }
            } catch (err) { if(els.inspSpdx) els.inspSpdx.textContent = "Extraction failed."; }
        } else if (d.snippetPath) {
            let url = window.remoteBaseUrl ? `${window.remoteBaseUrl}/${d.snippetPath}` : ((window.location.protocol === 'file:') ? d.snippetPath : new URL(d.snippetPath, window.location.href).href);
            fetch(url).then(r => r.json()).then(json => {
                currentSnippet = JSON.stringify(json, null, 2);
                if(els.inspSpdx) els.inspSpdx.textContent = currentSnippet;
            }).catch(() => {
                if(els.inspSpdx) els.inspSpdx.textContent = "No SPDX data found. Please upload the unified ZIP artifact.";
            });
        } else {
            if(els.inspSpdx) els.inspSpdx.textContent = "No SPDX path defined for this node.";
        }
        
        if(currentDisplayMode === 'list') renderListView(); 
    };

    window.focusNodeInGraph = function(nodeId) {
        currentSelectedNodeId = nodeId;
        explicitlyExpandedNodes.add(nodeId);
        
        if (currentDisplayMode !== 'graph') {
            document.querySelectorAll('.dv-tab-btn')[1].click(); 
        }
        
        updateGraphState();
        inspectNode(nodeId); 
        
        setTimeout(() => {
            if(cy) {
                const target = cy.getElementById(nodeId);
                if(target.length) {
                    cy.animate({ zoom: 1.5, center: { eles: target }, duration: 500 });
                }
            }
        }, 150);
    };

    function renderCitations() {
        if (!els.citationsContainer) return;
        const papersMap = {};
        
        rawGraphData.nodes.forEach(n => {
            if(n.data.papers && n.data.papers.length > 0) {
                n.data.papers.forEach(p => {
                    if(!papersMap[p.doi]) papersMap[p.doi] = { paper: p, usages: [] };
                    
                    if(!papersMap[p.doi].usages.find(u => u.id === n.id)) {
                        papersMap[p.doi].usages.push(n);
                    }
                });
            }
        });
        
        let html = '';
        for (let doi in papersMap) {
            const data = papersMap[doi];
            
            let usagesHtml = data.usages.map(node => {
                let pathArr = [];
                let currId = node.id;
                let loops = 20; 
                
                while(currId && loops > 0) {
                    let n = rawGraphData.nodes.find(x => x.id === currId);
                    if(n) pathArr.unshift(n.label);
                    
                    let edge = rawGraphData.edges.find(e => e.source === currId);
                    currId = edge ? edge.target : null;
                    loops--;
                }
                
                let pathStr = pathArr.join(' <span style="color: #666; margin: 0 4px;">→</span> ');

                return `
                <li style="background: #252526; padding: 15px; border-radius: 6px; border: 1px solid #333; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="color: #007bff; font-weight: bold; font-size: 1.1rem;">${node.label}</span>
                        <button class="dv-btn-small" onclick="focusNodeInGraph('${node.id}')">View in Graph</button>
                    </div>
                    <div style="font-size: 0.95rem; color: #ccc;">
                        <span style="color: #888; text-transform: uppercase; font-size: 0.8rem; display: block; margin-bottom: 4px;">Dependency Chain:</span>
                        <div style="font-family: monospace; font-size: 1rem;">${pathStr}</div>
                    </div>
                </li>`;
            }).join('');

            html += `
            <div class="dv-citation-card">
                <h4 class="dv-citation-title">${data.paper.title}</h4>
                <div class="dv-citation-meta"><strong>Journal:</strong> ${data.paper.journal} | <strong>DOI:</strong> ${doi}</div>
                <div style="margin-top: 10px; margin-bottom: 20px;">
                    <a href="${data.paper.url || data.paper.joss_pdf || ('https://doi.org/' + doi)}" target="_blank" class="dv-btn-small" style="text-decoration: none; display: inline-block;">Read Original Paper</a>
                </div>
                <div>
                    <strong style="font-size: 1rem; color: #fff; display: block; margin-bottom: 10px;">Cited by Downstream Consumers:</strong>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        ${usagesHtml}
                    </ul>
                </div>
            </div>`;
        }
        
        if(!html) html = `<div style="text-align: center; color: #888; margin-top: 50px;">No citations or DOIs discovered in downstream dependents.</div>`;
        els.citationsContainer.innerHTML = html;
    }

    window.copySPDX = function() { if(currentSnippet) navigator.clipboard.writeText(currentSnippet); };
    window.downloadSingleSPDX = function() {
        if(!currentSnippet) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([currentSnippet], {type:"application/json"}));
        a.download = `${currentLabel}.spdx.json`;
        document.body.appendChild(a); a.click();
    };
})();