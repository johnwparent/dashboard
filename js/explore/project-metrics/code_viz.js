
// Polyfill for RegExp.escape — available only in Chrome 132+/Firefox 134+
RegExp.escape ??= (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// =============================================================================
// SECTION 1: CONFIG
// Sort option maps and constants — injectable via MetricsVisualizer.defaultConfig
// =============================================================================

const _MV_SORT_OPTIONS = {
  function: {
    cogComplexity:  ['cognitive_complexity', 'Cognitive Complexity'],
    numlines:       ['lines',       'Number of Lines'],
    numstatements:  ['statements',  'Number of Statements'],
    numbranches:    ['branches',    'Number of Branches'],
    numparameters:  ['parameters',  'Number of Parameters'],
    nestinglvl:     ['level',       'Nesting Level'],
    numvariables:   ['variables',   'Number of Variables'],
  },
  file: {
    cogComplexity: ['averageScore', 'Cognitive Complexity'],
    numlines:      ['totalLoc',     'Number of Lines'],
    nummethods:    ['methodCount',  'Number of Methods'],
  },
};

// =============================================================================
// SECTION 2: STATE FACTORY
// Returns a fresh, isolated state object for each MetricsVisualizer instance.
// =============================================================================

function _mvCreateState() {
  return {
    urlBase:           '',
    projectId:         '',
    cdashURL:          '',
    currentData:       [],    // parsed function metrics array (sorted/filtered)
    currentView:       'file',
    sortMethod:        '',
    sortOrder:         'dsc',
    filterExclude:     true,
    filterParam:       '',
    buildCount:        0,
    firstRender:       true,
    functionMetrics: {
      averageScore:     0,
      functionCount:    0,
      loc:              0,
      fileCount:        0,
      highestScore:     { value: 0,    function: '' },
      lowestScore:      { value: 1000, function: '' },
      longestFunction:  { value: 0,    function: '' },
      branchCount:      { value: 0,    function: '' },
    },
    fileMetrics: {
      fileCount:         0,
      numberOfFilesOver: 0,
      worstFile:         '',
      worstScore:        0,
      bestFile:          '',
      bestScore:         9999,
      totalScore:        0,
      mostLoc:           0,
      highestLocFile:    '',
      averageScore:      0,
    },
    perFileMetrics:    {},
    methodsAboveMargin: 0,
  };
}

// =============================================================================
// SECTION 3: UTILITIES
// Pure functions — no DOM access, no state. Safe to call from any context.
// =============================================================================

function _mvGetSiteBase() {
  return document.querySelector('script[src*="code_viz"]')?.src.split('/js/')[0] ?? '';
}

function _mvHexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function _mvMap(value, fromSource, toSource, fromTarget, toTarget) {
  return (value - fromSource) / (toSource - fromSource) * (toTarget - fromTarget) + fromTarget;
}

// inspired by https://stackoverflow.com/a/46543292
function _mvGetColor(startColor, endColor, min, max, value) {
  const s   = _mvHexToRgb(startColor);
  const e   = _mvHexToRgb(endColor);
  const pct = _mvMap(value, min, max, 0, 1);
  const r   = Math.round((e.r - s.r) * pct + s.r);
  const g   = Math.round((e.g - s.g) * pct + s.g);
  const b   = Math.round((e.b - s.b) * pct + s.b);
  return `rgb(${r}, ${g}, ${b})`;
}

function _mvSplitAtFirstCapital(str) {
  if (!str) return [];
  const index = str.search(/[A-Z]/);
  if (index === -1 || index === 0) return [str];
  return [str.slice(0, index), str.slice(index)];
}

function _mvToISOStringWithTimezone(date, old) {
  const year   = date.getFullYear();
  const month  = (date.getMonth() + 1).toString().padStart(2, '0');
  const day    = date.getDate().toString().padStart(2, '0');
  const hours  = old ? '00' : '24';
  const offset = date.getTimezoneOffset();
  const sign   = offset > 0 ? '-' : '+';
  const offH   = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
  const offM   = (Math.abs(offset) % 60).toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:00:00${sign}${offH}:${offM}`;
}

// =============================================================================
// SECTION 4: CDASH API
// All network I/O. Pure async functions — no DOM, no state.
// =============================================================================

async function _mvCDashPost(url, query) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`HTTP Error! status ${response.status}`);
  return response.json();
}

function _mvGetBuildNodeId(data) {
  const edges = data.data.build.files.edges;
  if (edges.length !== 1) console.error('Unexpected file count in CDash response');
  return edges[0].node.id;
}

function _mvGetProjectNodeId(data) {
  const edges = data.data.projects.edges;
  if (edges.length !== 1) console.error('Unexpected project count in CDash response');
  return edges[0].node.id;
}

async function _mvGetFileId(url, bid) {
  return _mvCDashPost(url, `query { build(id:${bid}) { files { edges { node { id } } } } }`);
}

async function _mvGetBuildDate(url, bid) {
  return _mvCDashPost(url, `query { build(id:${bid}) { submissionTime } }`);
}

async function _mvGetProjectId(url, projectName) {
  const query = `
query {
  projects(filters: { all: [{ eq: { name: "${projectName}" } }] }) {
    edges { node { id } }
  }
}`;
  const rsp = await _mvCDashPost(url, query);
  return _mvGetProjectNodeId(rsp);
}

async function _mvFetchMetricsData(rsp, cdash, bid) {
  const fileId   = _mvGetBuildNodeId(rsp);
  const response = await fetch(`${cdash.protocol}//${cdash.hostname}/build/${bid}/file/${fileId}`);
  if (!response.ok) throw new Error(`HTTP Error! status ${response.status}`);
  return response.text();
}

function _mvGetGraphQLEndpoint(cdashUrl) {
  return `${cdashUrl.protocol}//${cdashUrl.hostname}/graphql`;
}

// =============================================================================
// SECTION 5: MetricsVisualizer CLASS
// Encapsulates all state, DOM references, and rendering logic.
//
// Drop-in usage:
//   new MetricsVisualizer('codeMetrics');            // Jekyll / standalone
//   new MetricsVisualizer(this.$el, { threshold: 20 }); // Vue component
//
// ES module conversion: add `export` before `class`, remove the bottom IIFE.
// =============================================================================

class MetricsVisualizer {

  // Default configuration — override any key via the constructor config param
  static defaultConfig = {
    threshold:          25,
    acceptedExtensions: '.json,.out,.txt',
    siteBase:           null,   // auto-detected from script URL if null
    exampleDataPath:    null,   // auto-detected from siteBase if null
  };

  constructor(containerEl, config = {}) {
    this._container = typeof containerEl === 'string'
      ? document.getElementById(containerEl)
      : containerEl;

    if (!this._container) {
      console.error('MetricsVisualizer: container element not found');
      return;
    }

    this.config = Object.assign({}, MetricsVisualizer.defaultConfig, config);
    this.config.siteBase        = this.config.siteBase        ?? _mvGetSiteBase();
    this.config.exampleDataPath = this.config.exampleDataPath
      ?? (this.config.siteBase + '/explore/project-metrics/metrics-example.out');

    this.state = _mvCreateState();

    // DOM element references — populated in _init()
    this._ui              = null;
    this._metricContainer = null;
    this._detailPanel     = null;
    this._detailTitle     = null;
    this._detailSubtitle  = null;
    this._detailBody      = null;
    this._sortSelect      = null;

    this._init();
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /** Load and render a File object (from drag-drop or file picker). */
  async loadFile(file) {
    this._showLoadStatus('Reading file…');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => {
        try {
          const parser = new MetricParser();
          parser.parse(e.target.result);
          this._parseMetricJson(parser.metrics);
          this._displayMetrics();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsText(file);
    });
  }

  /** Load metrics from a CDash build URL. */
  async loadCDashBuild(cdashUrl) {
    if (typeof cdashUrl === 'string') cdashUrl = new URL(cdashUrl);
    await this._getCDashBuildContext(cdashUrl);
  }

  /** Load metrics from a CDash dashboard URL. */
  async loadCDashDashboard(cdashUrl) {
    if (typeof cdashUrl === 'string') cdashUrl = new URL(cdashUrl);
    await this._getCDashDashboardContext(cdashUrl);
  }

  /** Fetch and render the bundled HDF5 example dataset. */
  async loadExample() {
    this._showLoadStatus('Loading example data…');
    const res = await fetch(this.config.exampleDataPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parser = new MetricParser();
    parser.parse(text);
    this._parseMetricJson(parser.metrics);
    this._displayMetrics();
  }

  /** Remove all DOM output and event listeners created by this instance. */
  destroy() {
    this._container.innerHTML = '';
    this._ui = null;
    this._metricContainer = null;
    this._detailPanel = null;
    this._sortSelect = null;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: INITIALIZATION
  // ---------------------------------------------------------------------------

  _init() {
    this._ui = document.createElement('div');
    this._ui.id = 'user-interface';
    this._createPathSelectionUI();
    this._container.appendChild(this._ui);

    this._metricContainer = document.createElement('div');
    this._metricContainer.id = 'metric-container';
    this._container.appendChild(this._metricContainer);
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: DATA LAYER
  // Pure state transformations — no DOM access.
  // ---------------------------------------------------------------------------

  _extractPerFileMetrics(data, file) {
    const s = this.state;
    s.perFileMetrics[file].totalLoc   += data.lines;
    s.perFileMetrics[file].totalScore += data.cognitive_complexity;

    const cc = data.cognitive_complexity;
    if (cc > this.config.threshold) {
      s.perFileMetrics[file].numberOver += 1;
      s.methodsAboveMargin += 1;
    }
    if (cc > s.perFileMetrics[file].worstScore.score) {
      s.perFileMetrics[file].worstScore = { score: cc, method: data.name };
    }
    if (cc < s.perFileMetrics[file].bestScore.score) {
      s.perFileMetrics[file].bestScore = { score: cc, method: data.name };
    }
  }

  _parseMetricJson(data) {
    const s = this.state;
    s.currentData        = [];
    s.perFileMetrics     = {};
    s.methodsAboveMargin = 0;
    s.filterParam        = '';
    s.filterExclude      = true;
    this._container.querySelectorAll('.dynamic-search-bar').forEach(el => { el.value = ''; });
    s.functionMetrics    = {
      averageScore:    0, functionCount: 0, loc: 0, fileCount: 0,
      highestScore:    { value: 0,    function: '' },
      lowestScore:     { value: 1000, function: '' },
      longestFunction: { value: 0,    function: '' },
      branchCount:     { value: 0,    function: '' },
    };
    s.fileMetrics = {
      fileCount: 0, numberOfFilesOver: 0, worstFile: '', worstScore: 0,
      bestFile: '', bestScore: 9999, totalScore: 0, mostLoc: 0,
      highestLocFile: '', averageScore: 0,
    };

    let funcCount  = 0;
    let totalScore = 0;

    for (const file in data) {
      s.perFileMetrics[file] = {
        methodCount: 0, numberOver: 0,
        worstScore:  { score: 0,    method: '' },
        bestScore:   { score: 9999, method: '' },
        totalScore: 0, totalLoc: 0, averageScore: 0, averageLoc: 0,
      };

      for (const func in data[file]) {
        this._extractPerFileMetrics(data[file][func], file);
        funcCount  += 1;
        totalScore += data[file][func].cognitive_complexity;

        const fm  = s.functionMetrics;
        const cc  = data[file][func].cognitive_complexity;
        const nb  = data[file][func].branches;
        const len = data[file][func].statements;

        fm.functionCount += 1;
        fm.loc           += data[file][func].lines;
        if (cc  > fm.highestScore.value)    { fm.highestScore    = { value: cc,  function: func }; }
        if (cc  < fm.lowestScore.value)     { fm.lowestScore     = { value: cc,  function: func }; }
        if (len > fm.longestFunction.value) { fm.longestFunction = { value: len, function: func }; }
        if (nb  > fm.branchCount.value)     { fm.branchCount     = { value: nb,  function: func }; }

        s.currentData.push(data[file][func]);
      }

      const pfm = s.perFileMetrics[file];
      if (pfm.worstScore.score > s.fileMetrics.worstScore) {
        s.fileMetrics.worstScore = pfm.worstScore.score;
        s.fileMetrics.worstFile  = file;
      }
      if (pfm.bestScore.score < s.fileMetrics.bestScore) {
        s.fileMetrics.bestScore = pfm.bestScore.score;
        s.fileMetrics.bestFile  = file;
      }
      if (pfm.totalLoc > s.fileMetrics.mostLoc) {
        s.fileMetrics.mostLoc        = pfm.totalLoc;
        s.fileMetrics.highestLocFile = file;
      }

      const methodCount = Object.keys(data[file]).length;
      pfm.averageScore = (pfm.totalScore / methodCount).toFixed(2);
      pfm.averageLoc   = pfm.totalLoc / methodCount;
      pfm.methodCount  = methodCount;
      if (parseFloat(pfm.averageScore) > this.config.threshold) {
        s.fileMetrics.numberOfFilesOver += 1;
      }
    }

    s.functionMetrics.averageScore = (totalScore / funcCount).toFixed(2);
    s.functionMetrics.fileCount    = Object.keys(data).length;
    s.fileMetrics.fileCount        = Object.keys(data).length;
    s.fileMetrics.averageScore     = (totalScore / s.fileMetrics.fileCount).toFixed(2);
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: RENDERING
  // Read state, write DOM into this._metricContainer.
  // ---------------------------------------------------------------------------

  _clearMetric() {
    this._metricContainer.innerHTML = '';
  }

  _showLoadStatus(message) {
    this._metricContainer.innerHTML = '';
    const p = document.createElement('p');
    p.className   = 'pm-load-status';
    p.textContent = message;
    this._metricContainer.appendChild(p);
  }

  _displayMetrics() {
    this._clearMetric();

    const renderPerView = () => {
      this._clearMetric();
      if (this.state.currentView === 'file') {
        this.state.sortMethod = this.state.sortMethod || 'averageScore';
        this._displayFileInfo();
      } else {
        this.state.sortMethod = this.state.sortMethod || 'cognitive_complexity';
        this._displayFunctionInfo();
      }
      this._highlightInfoLinks();
    };

    const viewToggleOptions = {
      defaultView:      'file',
      onChangeCallback: (selectedView) => {
        this.state.currentView = selectedView;
        this.state.sortMethod  = '';
        this._changeSortOptions();
        renderPerView();
      },
    };

    if (this.state.firstRender) {
      const pathWrapper = this._ui.querySelector('.pm-path-wrapper');
      if (pathWrapper) pathWrapper.style.display = 'none';
      this._createControlsCard();
      this._createViewToggleCard(viewToggleOptions);
      this._createDetailPanel();
      this.state.firstRender = false;
    }

    renderPerView();
  }

  _displayFileInfo() {
    const s = this.state;

    // ── Aggregate stat cards ────────────────────────────────────────────────
    const overallMetrics = document.createElement('div');
    overallMetrics.classList.add('overall-metrics-container');
    overallMetrics.id = 'overallMetrics';

    const addCard = (name, data, dataFile = null) => {
      const card  = document.createElement('div');
      card.classList.add('code-metric-overview');
      const h3 = document.createElement('h3');
      h3.classList.add('overall-metrics-name');
      h3.textContent = name;
      const val = document.createElement('p');
      val.classList.add('overall-metrics-value');
      val.innerHTML = data;
      card.appendChild(h3);
      card.appendChild(val);
      if (dataFile) {
        const link = document.createElement('a');
        link.classList.add('overall-metrics-link');
        link.href = '#' + dataFile + '-metrics';
        const fn = document.createElement('div');
        fn.classList.add('overall-metrics-file-name');
        fn.textContent = dataFile;
        link.appendChild(fn);
        card.appendChild(link);
      }
      overallMetrics.appendChild(card);
    };

    const fm = s.fileMetrics;
    const af = s.functionMetrics;
    addCard('Average Cognitive Complexity Score', fm.averageScore);
    addCard('Function Count',                     af.functionCount);
    addCard('Lines of Code',                      af.loc);
    addCard('File Count',                         fm.fileCount);
    addCard(`Files over threshold (${this.config.threshold})`, fm.numberOfFilesOver);
    addCard('Longest File', fm.mostLoc, fm.highestLocFile);
    addCard('Highest Avg Complexity Score', fm.worstScore, fm.worstFile);
    addCard('Lowest Avg Complexity Score',  fm.bestScore,  fm.bestFile);

    // ── Charts ──────────────────────────────────────────────────────────────
    const chartBox = this._buildCharts(s);
    overallMetrics.appendChild(chartBox);
    this._metricContainer.appendChild(overallMetrics);

    // ── Legend ──────────────────────────────────────────────────────────────
    const metricBox = document.createElement('div');
    metricBox.classList.add('code-metric-box');

    const legend = document.createElement('div');
    legend.classList.add('code-metric-legend');
    legend.style.zIndex = Object.keys(s.perFileMetrics).length + 1;
    ['Name', 'Average Cognitive Complexity'].forEach(txt => {
      const p = document.createElement('p');
      p.textContent = txt;
      legend.appendChild(p);
    });
    metricBox.appendChild(legend);

    // ── Rows ────────────────────────────────────────────────────────────────
    const cmp = s.sortOrder === 'dsc'
      ? (a, b) => b[1][s.sortMethod] - a[1][s.sortMethod]
      : (a, b) => a[1][s.sortMethod] - b[1][s.sortMethod];

    const entries = Object.entries(s.perFileMetrics).sort(cmp);
    const fileKeys = Object.keys(s.perFileMetrics);

    entries.forEach((item, idx) => {
      const [location, metrics] = item;
      if (this._fileIsFiltered(location)) return;

      const scoreColor = _mvGetColor('#00FF00', '#FF0000', 0, 100, metrics.averageScore);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.backgroundColor = scoreColor;
      btn.style.color = '#ffffff';
      btn.classList.add('code-info-toggle');
      btn.id = location + '-metrics';
      btn.addEventListener('click', () => {
        this._container.querySelectorAll('.code-info-toggle.selected')
          .forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        this._openFileDetailPanel(location, metrics);
      });

      const nameP = document.createElement('p');
      nameP.textContent = location;
      const ccP = document.createElement('p');
      ccP.textContent = metrics.averageScore;
      btn.appendChild(nameP);
      btn.appendChild(ccP);

      const row = document.createElement('div');
      row.classList.add('code-metric-row');
      row.style.zIndex = `${fileKeys.length - idx}`;
      row.appendChild(btn);
      metricBox.appendChild(row);
    });

    this._metricContainer.appendChild(metricBox);
  }

  _displayFunctionInfo() {
    const s = this.state;
    if (!s.currentData) return;

    const cmp = s.sortOrder === 'dsc'
      ? (a, b) => b[s.sortMethod] - a[s.sortMethod]
      : (a, b) => a[s.sortMethod] - b[s.sortMethod];
    s.currentData.sort(cmp);

    // ── Aggregate stat cards ────────────────────────────────────────────────
    const overallMetrics = document.createElement('div');
    overallMetrics.classList.add('overall-metrics-container');
    overallMetrics.id = 'overallMetrics';

    for (const item of Object.keys(s.functionMetrics)) {
      const card = document.createElement('div');
      card.classList.add('code-metric-overview');

      const h3 = document.createElement('h3');
      h3.classList.add('overall-metrics-name');
      if (item === 'loc') {
        h3.textContent = 'Lines of Code';
      } else {
        const parts = _mvSplitAtFirstCapital(item);
        if (parts.length > 1) {
          const mid = item.includes('Score') ? ' Cognitive Complexity ' : ' ';
          h3.textContent = parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + mid + parts[1];
        } else {
          h3.textContent = parts[0];
        }
      }

      const val = document.createElement('p');
      val.classList.add('overall-metrics-value');

      let ref;
      if (typeof s.functionMetrics[item] === 'object') {
        val.innerHTML = s.functionMetrics[item].value;
        const funcName = document.createElement('div');
        funcName.classList.add('overall-metrics-function-name');
        funcName.textContent = s.functionMetrics[item].function;
        ref = document.createElement('a');
        ref.classList.add('overall-metrics-link');
        ref.href = '#' + s.functionMetrics[item].function + '-metrics';
        ref.appendChild(funcName);
      } else {
        val.innerHTML = s.functionMetrics[item];
      }

      card.appendChild(h3);
      card.appendChild(val);
      if (ref) card.appendChild(ref);
      overallMetrics.appendChild(card);
    }

    // ── Charts ──────────────────────────────────────────────────────────────
    const chartBox = this._buildCharts(s);
    overallMetrics.appendChild(chartBox);
    this._metricContainer.appendChild(overallMetrics);

    // ── Legend ──────────────────────────────────────────────────────────────
    const metricBox = document.createElement('div');
    metricBox.classList.add('code-metric-box');

    const legend = document.createElement('div');
    legend.classList.add('code-metric-legend');
    legend.style.zIndex = s.currentData.length + 1;
    ['Name', 'Location', 'Cognitive Complexity'].forEach(txt => {
      const p = document.createElement('p');
      p.textContent = txt;
      legend.appendChild(p);
    });
    metricBox.appendChild(legend);

    // ── Rows ────────────────────────────────────────────────────────────────
    s.currentData.forEach((item, idx) => {
      if (this._functionIsFiltered(item)) return;

      const scoreColor = _mvGetColor('#00FF00', '#FF0000', 0, 100, item.cognitive_complexity);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.backgroundColor = scoreColor;
      btn.style.color = '#ffffff';
      btn.classList.add('code-info-toggle');
      btn.id = item.name + '-metrics';
      btn.addEventListener('click', () => {
        this._container.querySelectorAll('.code-info-toggle.selected')
          .forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        this._openFunctionDetailPanel(item);
      });

      const nameP = document.createElement('p');
      nameP.textContent = item.name;
      const locP = document.createElement('p');
      locP.textContent = item.location;
      const ccP = document.createElement('p');
      ccP.textContent = item.cognitive_complexity;
      btn.append(nameP, locP, ccP);

      const row = document.createElement('div');
      row.classList.add('code-metric-row');
      row.style.zIndex = `${s.currentData.length - idx}`;
      row.appendChild(btn);
      metricBox.appendChild(row);
    });

    this._metricContainer.appendChild(metricBox);
  }

  // Builds the two Chart.js canvases and returns the container div.
  _buildCharts(s) {
    const chartBox = document.createElement('div');
    chartBox.classList.add('chart-container');

    const methodBox = document.createElement('div');
    methodBox.classList.add('chart-box');
    const methodCanvas = document.createElement('canvas');
    methodCanvas.id = 'methodChart';
    methodBox.appendChild(methodCanvas);

    const fileBox = document.createElement('div');
    fileBox.classList.add('chart-box');
    const fileCanvas = document.createElement('canvas');
    fileCanvas.id = 'fileChart';
    fileBox.appendChild(fileCanvas);

    chartBox.append(methodBox, fileBox);

    const filesOver = Object.values(s.perFileMetrics).filter(m => m.numberOver > 0).length;

    const methodConfig = {
      type: 'pie',
      data: {
        labels: ['Over Threshold', 'Under Threshold'],
        datasets: [{
          label: 'Method Metrics',
          data: [s.methodsAboveMargin, s.functionMetrics.fileCount - s.methodsAboveMargin],
          backgroundColor: ['rgb(255, 99, 132)', 'rgb(6, 108, 18)'],
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          title:  { display: true, text: 'Methods over threshold' },
        },
      },
    };

    const fileConfig = {
      type: 'doughnut',
      data: {
        labels: ['Files with Methods Over Threshold', 'Files with All Methods Under Threshold'],
        datasets: [{
          label: 'File Metrics',
          data: [filesOver, s.functionMetrics.fileCount - filesOver],
          backgroundColor: ['rgb(54, 162, 235)', 'rgb(255, 205, 86)'],
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          title:  { display: true, text: 'Files with methods over threshold' },
        },
      },
    };

    window.requestAnimationFrame(() => {
      const mCtx = methodCanvas.getContext('2d');
      const fCtx = fileCanvas.getContext('2d');
      if (mCtx) new Chart(mCtx, methodConfig);
      else console.error('Failed to get 2D context for Method Chart.');
      if (fCtx) new Chart(fCtx, fileConfig);
      else console.error('Failed to get 2D context for File Chart.');
    });

    return chartBox;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: FILTER HELPERS
  // ---------------------------------------------------------------------------

  _fileIsFiltered(location) {
    if (!this.state.filterParam) return false;
    const match = new RegExp(RegExp.escape(this.state.filterParam), 'i').test(location);
    return this.state.filterExclude ? match : !match;
  }

  _functionIsFiltered(func) {
    if (!this.state.filterParam) return false;
    const re = new RegExp(RegExp.escape(this.state.filterParam), 'i');
    const match = re.test(func.name) || re.test(func.signature);
    return this.state.filterExclude ? match : !match;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: DETAIL PANEL
  // ---------------------------------------------------------------------------

  _makeSection(heading, htmlContent) {
    const sec = document.createElement('div');
    sec.className = 'detail-panel-section';
    const h = document.createElement('h3');
    h.textContent = heading;
    sec.appendChild(h);
    if (htmlContent) sec.innerHTML += htmlContent;
    return sec;
  }

  _makeInfoBox(label, value) {
    const box = document.createElement('div');
    box.className = 'info-box';
    const h = document.createElement('h3');
    h.textContent = value;
    const p = document.createElement('p');
    p.textContent = label;
    box.appendChild(h);
    box.appendChild(p);
    return box;
  }

  _createDetailPanel() {
    const panel = document.createElement('div');
    panel.id        = 'detail-panel';
    panel.className = 'detail-panel';

    const header = document.createElement('div');
    header.className = 'detail-panel-header';

    const titleGroup = document.createElement('div');
    this._detailTitle = document.createElement('h2');
    this._detailTitle.id = 'detail-panel-title';
    this._detailSubtitle = document.createElement('p');
    this._detailSubtitle.id = 'detail-panel-subtitle';
    titleGroup.append(this._detailTitle, this._detailSubtitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'detail-panel-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this._closeDetailPanel());

    header.append(titleGroup, closeBtn);
    panel.appendChild(header);

    this._detailBody = document.createElement('div');
    this._detailBody.id        = 'detail-panel-body';
    this._detailBody.className = 'detail-panel-body';
    panel.appendChild(this._detailBody);

    this._detailPanel = panel;
    this._container.appendChild(panel);
  }

  _closeDetailPanel() {
    this._detailPanel.classList.remove('open');
    this._container.querySelectorAll('.code-info-toggle.selected')
      .forEach(el => el.classList.remove('selected'));
  }

  _openFunctionDetailPanel(item) {
    this._detailTitle.textContent    = item.name;
    this._detailSubtitle.textContent = 'Function details';

    const severity      = item.cognitive_complexity >= this.config.threshold ? 'High' : 'Low';
    const thresholdText = item.cognitive_complexity >= this.config.threshold
      ? 'Over recommended threshold' : 'Under recommended threshold';

    this._detailBody.innerHTML = '';
    this._detailBody.appendChild(this._makeSection('Location',  `<code>${item.location}</code>`));
    this._detailBody.appendChild(this._makeSection('Signature', `<pre>${item.signature}</pre>`));

    const metricsSection = this._makeSection('Metrics', '');
    const stats          = document.createElement('div');
    stats.className      = 'code-stats';
    [
      ['Cognitive complexity', item.cognitive_complexity],
      ['Nesting',              item.nesting],
      ['Lines',                item.lines],
      ['Statements',           item.statements],
      ['Branches',             item.branches],
      ['Parameters',           item.parameters],
      ['Variables',            item.variables],
    ].forEach(([label, value]) => {
      if (value === undefined) return;
      stats.appendChild(this._makeInfoBox(label, value));
    });
    metricsSection.appendChild(stats);
    this._detailBody.appendChild(metricsSection);

    const statusSection = this._makeSection('Status', '');
    const badge         = document.createElement('span');
    badge.className     = `severity-badge severity-${severity.toLowerCase()}`;
    badge.textContent   = severity;
    const threshEl      = document.createElement('p');
    threshEl.textContent = thresholdText;
    statusSection.append(badge, threshEl);
    this._detailBody.appendChild(statusSection);

    const actions  = document.createElement('div');
    actions.className = 'detail-panel-actions';
    const copyBtn  = document.createElement('button');
    copyBtn.textContent = 'Copy location';
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(item.location));
    const openBtn  = document.createElement('a');
    openBtn.textContent = 'Open in source';
    openBtn.href   = this.state.urlBase + item.location.split(':')[0];
    openBtn.target = '_blank';
    actions.append(copyBtn, openBtn);
    this._detailBody.appendChild(actions);

    this._detailPanel.classList.add('open');
  }

  _openFileDetailPanel(location, metrics) {
    this._detailTitle.textContent    = location;
    this._detailSubtitle.textContent = 'File details';

    const severity      = metrics.averageScore >= this.config.threshold ? 'High' : 'Low';
    const thresholdText = metrics.averageScore >= this.config.threshold
      ? 'Over recommended threshold' : 'Under recommended threshold';

    this._detailBody.innerHTML = '';

    const metricsSection = this._makeSection('Metrics', '');
    const stats          = document.createElement('div');
    stats.className      = 'code-stats';
    [
      ['Highest Cognitive Complexity', `${metrics.worstScore.score} (${metrics.worstScore.method})`],
      ['Lowest Cognitive Complexity',  `${metrics.bestScore.score} (${metrics.bestScore.method})`],
      ['Total Lines of Code',          metrics.totalLoc],
      ['Average Lines of Code',        metrics.averageLoc],
      ['Average Cognitive Complexity', metrics.averageScore],
      ['Methods Over Threshold',       metrics.numberOver],
    ].forEach(([label, value]) => {
      if (value === undefined) return;
      stats.appendChild(this._makeInfoBox(label, value));
    });
    metricsSection.appendChild(stats);
    this._detailBody.appendChild(metricsSection);

    const statusSection = this._makeSection('Status', '');
    const badge         = document.createElement('span');
    badge.className     = `severity-badge severity-${severity.toLowerCase()}`;
    badge.textContent   = severity;
    const threshEl      = document.createElement('p');
    threshEl.textContent = thresholdText;
    statusSection.append(badge, threshEl);
    this._detailBody.appendChild(statusSection);

    const actions  = document.createElement('div');
    actions.className = 'detail-panel-actions';
    const copyBtn  = document.createElement('button');
    copyBtn.textContent = 'Copy location';
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(location));
    const openBtn  = document.createElement('a');
    openBtn.textContent = 'View related file';
    openBtn.href   = this.state.urlBase + location.split(':')[0];
    openBtn.target = '_blank';
    actions.append(copyBtn, openBtn);
    this._detailBody.appendChild(actions);

    this._detailPanel.classList.add('open');
  }

  _highlightInfoLinks() {
    const HIGHLIGHT_MS   = 2000;
    const highlightClass = 'highlight-flash';
    this._container.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', () => {
        const targetId  = anchor.getAttribute('href');
        const targetEl  = document.querySelector(CSS.escape(targetId));
        if (targetEl) {
          targetEl.classList.add(highlightClass);
          setTimeout(() => targetEl.classList.remove(highlightClass), HIGHLIGHT_MS);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: CONTROLS (sort / filter / view toggle)
  // ---------------------------------------------------------------------------

  _handleSort(criteria) {
    this.state.sortMethod = criteria;
    this._displayMetrics();
  }

  _handleOrdering(isChecked) {
    this.state.sortOrder = isChecked ? 'dsc' : 'asc';
    this._displayMetrics();
  }

  _changeSortOptions() {
    if (!this._sortSelect) return;
    const opts = this.state.currentView === 'file'
      ? _MV_SORT_OPTIONS.file
      : _MV_SORT_OPTIONS.function;
    this._sortSelect.options.length = 0;
    Object.keys(opts).forEach((key, i) => {
      const opt = document.createElement('option');
      opt.value       = opts[key][0];
      opt.textContent = opts[key][1];
      if (i === 0) opt.selected = true;
      this._sortSelect.appendChild(opt);
    });
  }

  _createSortSelector(container, sortOptions) {
    const wrapper = document.createElement('div');
    wrapper.className = 'js-sort-selector-container';

    const label = document.createElement('label');
    label.className   = 'js-sort-label';
    label.textContent = 'Sort by:';
    label.htmlFor     = `${container.id}-select`;

    const select = document.createElement('select');
    select.className = 'js-sort-select';
    select.id        = `${container.id}-select`;
    this._sortSelect = select;

    select.addEventListener('change', (e) => this._handleSort(e.target.value));

    Object.keys(sortOptions).forEach((key, i) => {
      const opt = document.createElement('option');
      opt.value       = sortOptions[key][0];
      opt.textContent = sortOptions[key][1];
      if (i === 0) opt.selected = true;
      select.appendChild(opt);
    });

    wrapper.append(label, select);
    container.appendChild(wrapper);
  }

  _createFileViewToggle(parent, defaultView = 'file', onChangeCallback = null) {
    const wrap  = document.createElement('div');
    wrap.className = 'js-view-toggle-container';

    const fileBtn = document.createElement('button');
    fileBtn.className    = 'js-view-toggle-option';
    fileBtn.textContent  = 'File';
    fileBtn.dataset.value = 'file';

    const funcBtn = document.createElement('button');
    funcBtn.className    = 'js-view-toggle-option';
    funcBtn.textContent  = 'Function';
    funcBtn.dataset.value = 'function';

    (defaultView === 'function' ? funcBtn : fileBtn).classList.add('active');
    wrap.append(fileBtn, funcBtn);

    wrap.addEventListener('click', (e) => {
      const clicked = e.target.closest('.js-view-toggle-option');
      if (!clicked || clicked.classList.contains('active')) return;
      wrap.querySelector('.active').classList.remove('active');
      clicked.classList.add('active');
      if (typeof onChangeCallback === 'function') onChangeCallback(clicked.dataset.value);
    });

    parent.appendChild(wrap);
  }

  _createToggleSwitch(parent, switchId, defaultChecked = true, onChangeCallback = null) {
    const label = document.createElement('label');
    label.className = 'js-toggle-switch';
    label.htmlFor   = switchId;

    const input = document.createElement('input');
    input.type      = 'checkbox';
    input.id        = switchId;
    input.name      = switchId;
    input.className = 'js-switch-input';
    input.checked   = defaultChecked;

    const slider = document.createElement('span');
    slider.className = 'js-switch-slider';

    const labelText = document.createElement('span');
    labelText.className   = 'js-switch-label-text';
    labelText.textContent = defaultChecked ? 'Descending' : 'Ascending';

    input.addEventListener('change', (e) => {
      labelText.textContent = e.target.checked ? 'Descending' : 'Ascending';
      if (typeof onChangeCallback === 'function') onChangeCallback(e.target.checked, e.target.id);
    });

    label.append(input, slider, labelText);
    parent.appendChild(label);
  }

  _addSearchBar(parent, exclusion = false) {
    const filterType = exclusion ? 'exclude' : 'include';
    const input = document.createElement('input');
    input.type        = 'search';
    input.id          = filterType + '-method-filter';
    input.className   = 'dynamic-search-bar';
    input.placeholder = `Filter (${filterType})...`;
    input.setAttribute('aria-label', `Filter (${filterType})`);

    const applyFilter = () => {
      if (!this.state.currentData.length) return;
      this.state.filterParam   = input.value.trim();
      this.state.filterExclude = exclusion;
      this._displayMetrics();
    };

    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilter, 300);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(debounceTimer); applyFilter(); }
    });

    parent.appendChild(input);
    return input;
  }

  _createViewToggleCard(options) {
    const card = document.createElement('div');
    card.className = 'view-toggle-card';

    const title = document.createElement('h2');
    title.textContent = 'View';
    card.appendChild(title);

    const content = document.createElement('div');
    content.className = 'view-toggle-card-content';
    content.id        = 'ui-view-toggle-content';

    this._createFileViewToggle(content, options.defaultView, options.onChangeCallback);

    card.appendChild(content);
    this._ui.appendChild(card);
  }

  _createControlsCard() {
    const card = document.createElement('div');
    card.className = 'controls-card';
    card.id        = 'filter-controls-card';

    const title = document.createElement('h2');
    title.textContent = 'Filter & Sort Controls';
    card.appendChild(title);

    const content = document.createElement('div');
    content.className = 'controls-card-content';

    const searchGroup = document.createElement('div');
    searchGroup.className = 'search-controls';
    searchGroup.id        = 'search-controls-container';
    this._addSearchBar(searchGroup, false);
    this._addSearchBar(searchGroup, true);

    const sortGroup = document.createElement('div');
    sortGroup.className = 'sort-controls';
    sortGroup.id        = 'sort-controls-container';
    this._createSortSelector(
      sortGroup,
      this.state.currentView === 'file' ? _MV_SORT_OPTIONS.file : _MV_SORT_OPTIONS.function
    );
    this._createToggleSwitch(sortGroup, 'sort-direction-toggle', true,
      (isChecked) => this._handleOrdering(isChecked)
    );

    content.append(searchGroup, sortGroup);
    card.appendChild(content);
    this._ui.appendChild(card);
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: PATH SELECTION UI
  // "Choose your path" landing screen shown before data is loaded.
  // ---------------------------------------------------------------------------

  _createPathSelectionUI() {
    const base = this.config.siteBase;

    const wrapper = document.createElement('div');
    wrapper.className = 'pm-path-wrapper';

    const backLink = document.createElement('a');
    backLink.className = 'pm-path-back';
    backLink.href      = base + '/explore/project-metrics/';
    backLink.innerHTML = '&larr; Back to main page';
    wrapper.appendChild(backLink);

    const titleEl = document.createElement('h1');
    titleEl.className   = 'pm-path-title';
    titleEl.textContent = 'Project Sustainability Metric Visualizer';
    wrapper.appendChild(titleEl);

    const subtitleEl = document.createElement('p');
    subtitleEl.className   = 'pm-path-page-subtitle';
    subtitleEl.textContent = 'Add metric data to begin analyzing your C/C++ project';
    wrapper.appendChild(subtitleEl);

    const chooseH = document.createElement('h2');
    chooseH.className   = 'pm-path-choose';
    chooseH.textContent = 'Choose your path';
    wrapper.appendChild(chooseH);

    const grid = document.createElement('div');
    grid.className = 'pm-path-grid';
    wrapper.appendChild(grid);

    // ── Card 1: Try the tool ────────────────────────────────────────────────
    const card1  = this._buildPathCard(grid, 'fa-line-chart', 'I want to try the tool',
      'Explore the visualizer with pre-loaded sample data from a real project');
    const tryBtn = this._buildPathBtn(card1, 'Try with sample data');
    tryBtn.addEventListener('click', async () => {
      tryBtn.disabled    = true;
      tryBtn.textContent = 'Loading...';
      try {
        await this.loadExample();
      } catch (err) {
        console.error('Example load failed:', err);
        tryBtn.textContent = 'Failed — try again';
        tryBtn.disabled    = false;
      }
    });

    // ── Card 2: Upload metrics file ─────────────────────────────────────────
    const card2     = this._buildPathCard(grid, 'fa-upload', 'I have metrics file',
      'Upload a local clang-tidy metrics output file.');
    const uploadBtn = this._buildPathBtn(card2, 'Upload metrics file');
    const expand2   = this._buildExpandPanel(card2);

    let selectedFile = null;

    const dropZone = document.createElement('label');
    dropZone.className = 'pm-path-dropzone';
    dropZone.htmlFor   = 'pm-file-input';

    const dzIcon = document.createElement('i');
    dzIcon.className = 'fa fa-cloud-upload pm-path-dz-icon';
    dzIcon.setAttribute('aria-hidden', 'true');

    const dzText = document.createElement('span');
    dzText.className = 'pm-path-dz-text';
    dzText.innerHTML = 'Drag & drop file(s) or <span class="pm-path-browse">Browse</span>';

    const fileInput = document.createElement('input');
    fileInput.type      = 'file';
    fileInput.id        = 'pm-file-input';
    fileInput.accept    = this.config.acceptedExtensions;
    fileInput.className = 'pm-path-file-input';

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        selectedFile      = fileInput.files[0];
        dzText.textContent = `✅ ${selectedFile.name}`;
      }
    });
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('pm-path-dropzone--over');
    });
    ['dragleave', 'dragend'].forEach(t =>
      dropZone.addEventListener(t, () => dropZone.classList.remove('pm-path-dropzone--over'))
    );
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('pm-path-dropzone--over');
      if (e.dataTransfer.files.length) {
        selectedFile      = e.dataTransfer.files[0];
        dzText.textContent = `✅ ${selectedFile.name}`;
      }
    });
    dropZone.append(dzIcon, dzText, fileInput);
    expand2.appendChild(dropZone);

    const loadBtn = this._buildPathBtn(expand2, 'Load in visualizer');
    loadBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      loadBtn.disabled    = true;
      loadBtn.textContent = 'Loading...';
      try {
        await this.loadFile(selectedFile);
      } catch (err) {
        console.error('Parse failed:', err);
        loadBtn.textContent = 'Error parsing file';
        loadBtn.disabled    = false;
      }
    });

    uploadBtn.addEventListener('click', () => this._activateCard(card2, uploadBtn, expand2));

    // ── Card 3: CDash URL ───────────────────────────────────────────────────
    const card3    = this._buildPathCard(grid, 'fa-database', 'I have CDash URL',
      'Paste a CDash build URL to load recurring project metrics.');
    const cdashBtn = this._buildPathBtn(card3, 'Connect CDash build');
    const expand3  = this._buildExpandPanel(card3);

    const urlInput = document.createElement('input');
    urlInput.type        = 'url';
    urlInput.className   = 'pm-path-url-input';
    urlInput.placeholder = 'https://your-cdash.org/builds/123456';
    expand3.appendChild(urlInput);

    const connectBtn = this._buildPathBtn(expand3, 'Connect CDash build');
    connectBtn.addEventListener('click', () => {
      const raw = urlInput.value.trim();
      if (!raw) { urlInput.focus(); return; }
      try {
        const cdashUrl = raw.startsWith('http') ? new URL(raw) : new URL('https://' + raw);
        connectBtn.disabled    = true;
        connectBtn.textContent = 'Connecting...';
        this._getCDashBuildContext(cdashUrl).catch(err => {
          console.error('CDash connection failed:', err);
          connectBtn.textContent = 'Connection failed';
          connectBtn.disabled    = false;
        });
      } catch {
        urlInput.classList.add('pm-path-url-input--error');
        urlInput.focus();
      }
    });
    urlInput.addEventListener('input', () => urlInput.classList.remove('pm-path-url-input--error'));
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectBtn.click(); });
    cdashBtn.addEventListener('click', () => {
      this._activateCard(card3, cdashBtn, expand3);
      urlInput.focus();
    });

    // ── Footer ──────────────────────────────────────────────────────────────
    const footer      = document.createElement('div');
    footer.className  = 'pm-path-footer';
    const inner       = document.createElement('div');
    inner.className   = 'pm-path-footer-inner';
    const footIcon    = document.createElement('i');
    footIcon.className = 'fa fa-info-circle pm-path-footer-icon';
    footIcon.setAttribute('aria-hidden', 'true');
    const footTitle   = document.createElement('strong');
    footTitle.className   = 'pm-path-footer-title';
    footTitle.textContent = 'I need to generate metrics';
    const footDesc    = document.createElement('p');
    footDesc.className   = 'pm-path-footer-desc';
    footDesc.textContent = 'Learn how to configure your project and generate metric data';
    const footLink    = document.createElement('a');
    footLink.className   = 'pm-path-footer-link';
    footLink.href        = base + '/explore/project-metrics/getting-started/';
    footLink.textContent = 'View setup guide →';
    inner.append(footIcon, footTitle, footDesc, footLink);
    footer.appendChild(inner);
    wrapper.appendChild(footer);

    this._ui.appendChild(wrapper);
  }

  // Path card helper builders
  _buildPathCard(parent, iconClass, title, desc) {
    const card = document.createElement('div');
    card.className = 'pm-path-card';
    const icon = document.createElement('i');
    icon.className = `fa ${iconClass} pm-path-card-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const h3 = document.createElement('h3');
    h3.className   = 'pm-path-card-title';
    h3.textContent = title;
    const p = document.createElement('p');
    p.className   = 'pm-path-card-desc';
    p.textContent = desc;
    card.append(icon, h3, p);
    parent.appendChild(card);
    return card;
  }

  _buildPathBtn(parent, text) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'pm-path-card-btn';
    btn.textContent = text;
    parent.appendChild(btn);
    return btn;
  }

  _buildExpandPanel(parent) {
    const panel = document.createElement('div');
    panel.className = 'pm-path-expand';
    parent.appendChild(panel);
    return panel;
  }

  _activateCard(card, triggerBtn, expandPanel) {
    triggerBtn.style.display = 'none';
    expandPanel.classList.add('pm-path-expand--open');
    card.classList.add('pm-path-card--active');
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: CDASH INTEGRATION
  // ---------------------------------------------------------------------------

  async _getCDashBuildContext(cdashUrl) {
    const bid  = cdashUrl.pathname.split('/').pop();
    const url  = _mvGetGraphQLEndpoint(cdashUrl);
    const rsp  = await _mvGetFileId(url, bid);
    try {
      const raw = await _mvFetchMetricsData(rsp, cdashUrl, bid);
      const parser = new MetricParser();
      parser.parse(raw);
      this._parseMetricJson(parser.metrics);
      this._displayMetrics();
    } catch (err) {
      console.error('Error fetching CDash file:', err);
    }
  }

  async _getCDashDashboardContext(cdashUrl) {
    const projectName = cdashUrl.searchParams.get('project');
    if (!projectName) {
      console.error('Ill-formed CDash dashboard URL — cannot find project name');
      return;
    }
    const graphqlEndpoint    = _mvGetGraphQLEndpoint(cdashUrl);
    this.state.cdashURL      = graphqlEndpoint;
    this.state.projectId     = await _mvGetProjectId(graphqlEndpoint, projectName);
    this._renderCalendarWidget();
  }

  async _cdashRenderRangeData(url, pid, old, current) {
    const query = `
query {
  project(id:${pid}) {
    builds(filters: {
      all: [
        { lt: { submissionTime: "${current}" } },
        { gt: { submissionTime: "${old}" } }
      ]
    }) {
      edges { node { id } }
    }
  }
}`;
    const rsp   = await _mvCDashPost(url, query);
    const edges = rsp.data.project.builds.edges;
    if (!edges.length) { console.error('No builds found between these dates'); return; }

    const bids    = edges.map(e => e.node.id);
    this.state.buildCount = bids.length;
    const entries = [];

    for (const bid of bids) {
      const fileRsp = await _mvGetFileId(url, bid);
      try {
        const raw       = await _mvFetchMetricsData(fileRsp, new URL(url), bid);
        const parser    = new MetricParser();
        parser.parse(raw);
        const dateRsp   = await _mvGetBuildDate(url, bid);
        entries.push([bid, dateRsp.data.build.submissionTime, parser.metrics]);
      } catch (err) {
        console.error('Error fetching CDash file:', err);
      }
    }

    const rangeBox = this._addRangeMetricBox(this._metricContainer);
    this._addRangeLegend(rangeBox);
    entries.forEach(([bid, date, metrics], idx) => {
      this._parseMetricJson(metrics);
      this._addBuildEntry(bid, date, rangeBox, idx);
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: CALENDAR / DATE RANGE UI
  // ---------------------------------------------------------------------------

  _renderCalendarWidget() {
    let currentDate = new Date();
    let startDate   = null;
    let endDate     = null;

    const h2 = document.createElement('h2');
    h2.textContent = 'Select a Date Range';

    const calContainer = document.createElement('div');
    calContainer.id    = 'calendar-container';

    const calHeader = document.createElement('div');
    calHeader.className = 'calendar-header';
    const prevBtn  = document.createElement('button');
    prevBtn.id     = 'prev-month-btn';
    prevBtn.innerHTML = '&lt;';
    const monthH3  = document.createElement('h3');
    monthH3.id     = 'month-year-display';
    const nextBtn  = document.createElement('button');
    nextBtn.id     = 'next-month-btn';
    nextBtn.innerHTML = '&gt;';
    calHeader.append(prevBtn, monthH3, nextBtn);

    const weekdays = document.createElement('div');
    weekdays.className = 'calendar-weekdays';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
      const div = document.createElement('div');
      div.textContent = d;
      weekdays.appendChild(div);
    });

    const calDays = document.createElement('div');
    calDays.id        = 'calendar-days';
    calDays.className = 'calendar-grid';

    const rangeDisplay = document.createElement('p');
    rangeDisplay.id          = 'selected-dates-display';
    rangeDisplay.textContent = 'No dates selected';

    calContainer.append(calHeader, weekdays, calDays);
    this._ui.append(h2, calContainer, rangeDisplay);

    const renderCalendar = () => {
      const year  = currentDate.getFullYear();
      const month = currentDate.getMonth();
      monthH3.textContent = `${currentDate.toLocaleString('default', { month: 'long' })} ${year}`;
      calDays.innerHTML   = '';

      const firstDay     = new Date(year, month, 1).getDay();
      const daysInMonth  = new Date(year, month + 1, 0).getDate();
      const prevMonthEnd = new Date(year, month, 0).getDate();

      for (let i = firstDay; i > 0; i--) {
        const d = document.createElement('div');
        d.classList.add('day', 'prev-month');
        d.textContent = prevMonthEnd - i + 1;
        calDays.appendChild(d);
      }
      for (let i = 1; i <= daysInMonth; i++) {
        const d    = document.createElement('div');
        d.classList.add('day');
        d.textContent   = i;
        d.dataset.date  = new Date(year, month, i).toISOString();
        const thisDate  = new Date(year, month, i);
        if (startDate && thisDate.getTime() === startDate.getTime()) d.classList.add('selected', 'start-range');
        if (endDate   && thisDate.getTime() === endDate.getTime())   d.classList.add('selected', 'end-range');
        if (startDate && endDate && thisDate > startDate && thisDate < endDate) d.classList.add('in-range');
        calDays.appendChild(d);
      }
      const fill = (7 - (calDays.children.length % 7)) % 7;
      for (let i = 1; i <= fill; i++) {
        const d = document.createElement('div');
        d.classList.add('day', 'next-month');
        d.textContent = i;
        calDays.appendChild(d);
      }
    };

    prevBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    nextBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });

    calDays.addEventListener('click', (e) => {
      if (!e.target.classList.contains('day') || !e.target.dataset.date) return;
      const selected = new Date(e.target.dataset.date);
      if (!startDate || (startDate && endDate)) {
        startDate = selected;
        endDate   = null;
      } else {
        if (selected < startDate) { endDate = startDate; startDate = selected; }
        else                      { endDate = selected; }
        const start = _mvToISOStringWithTimezone(startDate, true);
        const end   = _mvToISOStringWithTimezone(endDate,   false);
        this._cdashRenderRangeData(this.state.cdashURL, this.state.projectId, start, end);
      }
      rangeDisplay.textContent = startDate && endDate
        ? `Selected Range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`
        : startDate
          ? `Selected Start Date: ${startDate.toLocaleDateString()}`
          : 'No dates selected';
      renderCalendar();
    });

    renderCalendar();
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: RANGE / BUILD ENTRY UI
  // ---------------------------------------------------------------------------

  _addRangeMetricBox(parent) {
    const box = document.createElement('div');
    box.classList.add('code-metric-box');
    box.id = 'range-code-metric-box';
    parent.appendChild(box);
    return box;
  }

  _addRangeLegend(parent) {
    const legend = document.createElement('div');
    legend.classList.add('code-metric-legend');
    legend.style.zIndex = Object.keys(this.state.perFileMetrics).length + 1;
    ['Build #', 'Date', 'Average Cognitive Complexity'].forEach(txt => {
      const p = document.createElement('p');
      p.textContent = txt;
      legend.appendChild(p);
    });
    parent.appendChild(legend);
  }

  _minimalFileContext(parent) {
    const s   = this.state;
    const cmp = s.sortOrder === 'dsc'
      ? (a, b) => b[1][s.sortMethod] - a[1][s.sortMethod]
      : (a, b) => a[1][s.sortMethod] - b[1][s.sortMethod];
    const entries  = Object.entries(s.perFileMetrics).sort(cmp);
    const fileKeys = Object.keys(s.perFileMetrics);

    entries.forEach((item, idx) => {
      const [location, metrics] = item;
      if (this._fileIsFiltered(location)) return;

      const scoreColor = _mvGetColor('#00FF00', '#FF0000', 0, 100, metrics.averageScore);
      const btn = document.createElement('button');
      btn.type  = 'button';
      btn.style.backgroundColor = scoreColor;
      btn.style.color           = '#ffffff';
      btn.classList.add('code-info-toggle');
      btn.addEventListener('click', () => {
        this._container.querySelectorAll('.code-info-toggle.selected')
          .forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        this._openFileDetailPanel(location, metrics);
      });

      [location, 'file', metrics.averageScore].forEach(txt => {
        const p = document.createElement('p');
        p.textContent = txt;
        btn.appendChild(p);
      });

      const row = document.createElement('div');
      row.classList.add('code-metric-row');
      row.style.zIndex = `${fileKeys.length - idx}`;
      row.appendChild(btn);
      parent.appendChild(row);
    });
  }

  _addBuildEntry(bid, date, parent, idx) {
    const scoreColor = _mvGetColor('#00FF00', '#FF0000', 0, 100, this.state.fileMetrics.averageScore);

    const btn = document.createElement('button');
    btn.type  = 'button';
    btn.style.backgroundColor = scoreColor;
    btn.style.color           = '#ffffff';
    btn.classList.add('code-info-toggle');

    [
      `Build #${bid}`,
      `Date: ${date}`,
      this.state.fileMetrics.averageScore,
    ].forEach(txt => {
      const p = document.createElement('p');
      p.textContent = txt;
      btn.appendChild(p);
    });

    const chevron = document.createElement('i');
    chevron.classList.add('fa', 'fa-chevron-down');
    btn.appendChild(chevron);

    const row = document.createElement('div');
    row.classList.add('code-metric-row');
    row.style.zIndex = `${this.state.buildCount - idx}`;
    row.appendChild(btn);

    const codeEl = document.createElement('div');
    codeEl.classList.add('code-info-item');
    codeEl.id           = bid + '-metrics';
    codeEl.style.display = 'none';

    btn.addEventListener('click', () => {
      codeEl.style.display = codeEl.style.display === 'block' ? 'none' : 'block';
    });

    const statsEl = document.createElement('div');
    statsEl.classList.add('code-stats');

    const makeStatEl = (name, stat, funcName) => {
      const item   = document.createElement('div');
      item.classList.add('info-box');
      const h      = document.createElement('h3');
      h.textContent = name;
      const body   = document.createElement('p');
      body.textContent = stat;
      item.append(h, body);
      if (funcName) {
        const fn = document.createElement('p');
        fn.textContent = funcName;
        item.appendChild(fn);
      }
      statsEl.appendChild(item);
      codeEl.appendChild(statsEl);
    };

    const fm = this.state.fileMetrics;
    makeStatEl('Highest Cognitive Complexity', fm.worstScore, fm.worstFile);
    makeStatEl('Lowest Cognitive Complexity',  fm.bestScore,  fm.bestFile);
    makeStatEl('Total Lines of Code',          fm.totalLoc);
    makeStatEl('Highest Lines of Code',        fm.mostLoc,   fm.highestLocFile);
    makeStatEl('Average Cognitive Complexity', fm.averageScore);
    makeStatEl('Files over Complexity Threshold', fm.numberOfFilesOver);

    row.appendChild(codeEl);
    parent.appendChild(row);
    this._minimalFileContext(codeEl);
  }
}

// =============================================================================
// SECTION 6: JEKYLL ENTRY POINT
// Thin wrapper that initializes MetricsVisualizer for the static site.
// For Vue/CDash: new MetricsVisualizer(this.$el, config) inside mounted().
// For ES module: add `export` before `class MetricsVisualizer`, remove this IIFE.
// =============================================================================

(function () {
  const viz    = new MetricsVisualizer('codeMetrics');
  const params = new URLSearchParams(window.location.search);
  if (params.has('bid') && params.has('cdash')) {
    const cdashUrl = new URL('https://' + params.get('cdash') + '/builds/' + params.get('bid'));
    viz.loadCDashBuild(cdashUrl).catch(err => console.error('CDash auto-load failed:', err));
  }
}());
