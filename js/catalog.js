/** GLOBALS */
// GiHub Data Directory
var ghDataDir = '../explore/github-data';
// Global chart standards
var stdTotalWidth = 500,
  stdTotalHeight = 400;
var stdMargin = { top: 40, right: 40, bottom: 40, left: 40 },
  stdWidth = stdTotalWidth - stdMargin.left - stdMargin.right,
  stdHeight = stdTotalHeight - stdMargin.top - stdMargin.bottom,
  stdMaxBuffer = 1.07;
var stdDotRadius = 4,
  stdLgndDotRadius = 5,
  stdLgndSpacing = 20;

/** ELEMENTS */

const HIDDEN_CLASS = 'hidden';

const REPO_SECTION_ELEMENT = document.getElementById('repositories');
const ELEMENT_NAV_DESKTOP = document.getElementById('category-nav');
const ELEMENT_NAV_MOBILE = document.getElementById('category-hamburger-nav');
const REPO_HEADER_ELEMENT = document.getElementById('category-header');
const ELEMENT_WELCOME_TEXT = document.getElementById('welcome-text');

const ELEMENT_SEARCH = document.getElementById('searchText');

const ELEMENT_SINGLE_REPO_TARGET = document.getElementById('catalog-repo-single');

const ELEMENTS_ONLY_LIST = document.querySelectorAll('.catalog-list-only');
const ELEMENTS_ONLY_SINGLE_REPO = document.querySelectorAll('.catalog-single-only');

/** STATE VARIABLES */

//let searchTimeout; // TODO uncomment debounce once we have enough data
/**
 * Value of the text field which is visible on the category list view.
 */
let filterText = '';
/**
 * Value of the dropdown which is visible on the category list view.
 *
 * if this starts with a '-', reverse the sort order
 */
let orderProp = 'name';
/**
 * Index of the active category from the catData array, relevant for showing visible repositories on the category list view.
 *
 * This value will also be tracked in the URL, but as the category's "urlParam".
 */
let selectedCategoryIndex = 0;
/**
 * Value of the visible repository. Also gets tracked in the URL.
 *
 * If this is an empty string or nullish - show category list view. Otherwise, show repository detail view
 */
let visibleRepo = '';
/**
 * category data which gets populated from an initial fetch. the first item is a hardcoded value meant to represent no filter
 */
const catData = [
  {
    title: 'ALL SOFTWARE',
    icon: {
      path: '/assets/images/categories/catalog.svg', // don't use baseUrl here, we'll add it in the src of the img tag
      alt: 'All Software',
    },
    description: {
      short: `Browse all ${window.config.labName} open source projects`,
      long: '',
    },
    displayTitle: 'All Software',
    urlParam: 'all',
    topics: [],
  },
];
/**
 * Mapping of repositories to topics
 */
const topicRepos = [];
/**
 * flag which will permanently be set to "true" once user visits category list page
 */
let hasUserVisitedCategoryListPageYet = false;

/////////////////////////////////////////////////////////
//////////// UTIL FUNCTIONS ////////////////////////////
/////////////////////////////////////////////////////////

/**
 *
 * @param {String} str provided string
 * @returns string with first character of each word capitalized
 */
function titleCase(str) {
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

//check if repo is tagged as one of the categories
function containsTopics(catTopics, repoTopics) {
  if (!catTopics.length) return true;
  for (let i = 0; i < catTopics.length; i++) {
    if (repoTopics.includes(catTopics[i])) {
      return true;
    }
  }
  return false;
}

//////////////////////////////////////////////////////////
///////////////// REPO DETAIL FUNCTIONS //////////////////
//////////////////////////////////////////////////////////

/**
 * @param {string|null|undefined} queryParam parameter which may have been decoded from URL query parameter (or may not exist)
 */
function renderSingleRepoError(queryParam) {
  ELEMENT_SINGLE_REPO_TARGET.innerHTML = `
    <h2><span class="fa fa-exclamation-circle"></span> Whoops...</h2>
    <p>${
      queryParam ? `The repository ${queryParam} is not in our catalog.` : 'No repository specified in the URL (i.e. "?category=&repo=").'
    }</p>
  `;
}

/**
 * @param {Object} repo repo property from intReposInfo.json
 * @param {number} pulls count of all pull requests (open + closed)
 * @param {number} issues count of all issues (open + closed)
 */
function renderSingleRepoHTML(repo, pulls, issues) {
  ELEMENT_SINGLE_REPO_TARGET.innerHTML = `
    <h2 class="page-header text-center">
      <a class="title" href="${repo.url}" title="View Project on GitHub">${sanitizeHTML(repo.name)}</a>
      <br />
      <a class="subtitle" href="https://github.com/${repo.owner.login}" title="View Owner on GitHub">
        <span class="fa fa-user-circle"></span>${repo.owner.login}
      </a>
      ${
        repo.primaryLanguage
          ? `
        <span class="subtitle" title="Primary Language">
          <span class="fa fa-code"></span>
          ${repo.primaryLanguage.name}
        </span>
      `
          : ''
      }
      ${
        repo.licenseInfo && repo.licenseInfo.spdxId !== 'NOASSERTION'
          ? `
        <a
          class="subtitle"
          href="${repo.licenseInfo.url}"
          title="${repo.licenseInfo.name}"
        >
          <span class="fa fa-balance-scale"></span>
          ${repo.licenseInfo.spdxId}
        </a>
      `
          : ''
      }
    </h2>

    <p class="stats text-center">
      <a href="${repo.url}"> <span class="fa fa-github"></span>GitHub Page </a>

      ${
        repo.cdash
          ? `
          <a href="${repo.cdash}"> <img src="${window.config.baseUrl}/assets/images/logos/cdash.svg" height="20" width="20" class="cdash-icon"></img>CDash Dashboard </a>
      `
          : ''
      }

      ${
        repo.homepageUrl
          ? `
        <a href="${repo.homepageUrl}"> <span class="fa fa-globe"></span>Project Website </a>
      `
          : ''
      }
    </p>
    ${
      repo.description
        ? `
      <blockquote cite="${repo.url}"> ${sanitizeHTML(repo.description)} </blockquote>
    `
        : ''
    }

    <div class="text-center">
      <div id="metrics-section"></div>
    </div>
  `;
}

/**
 *
 * @param {string} queryParam parameter which was decoded from URL query parameter
 */
function renderSingleRepo(queryParam) {
  fetch(`${window.config.baseUrl}/explore/github-data/intReposInfo.json`)
    .then((res) => res.json())
    .then((infoJson) => {
      const reposObj = infoJson.data;
      if (reposObj.hasOwnProperty(queryParam)) {
        const repo = reposObj[queryParam];
        let pulls = 0;
        let issues = 0;
        const pullCounters = ['pullRequests_Merged', 'pullRequests_Open'];
        const issueCounters = ['issues_Closed', 'issues_Open'];
        pullCounters.forEach(function (c) {
          pulls += repo[c]['totalCount'];
        });
        issueCounters.forEach(function (c) {
          issues += repo[c]['totalCount'];
        });
        renderSingleRepoHTML(repo, pulls, issues);
        draw_line_repoActivity('repoActivityChart', queryParam);
        draw_pie_repoUsers('pieUsers', queryParam);
        draw_line_repoCreationHistory('repoCreationHistory', queryParam);
        draw_pie_languages('languagePie', queryParam);
        draw_cloud_topics('topicCloud', queryParam);
        if (repo.stargazers.totalCount) {
          draw_line_repoStarHistory('repoStarHistory', queryParam);
        }
        if (pulls) {
          draw_pie_repoPulls('piePulls', queryParam);
        }
        if (issues) {
          draw_pie_repoIssues('pieIssues', queryParam);
        }
        // Load and display sustainability metrics
        loadSustainabilityMetrics(queryParam);
      } else {
        renderSingleRepoError(queryParam);
      }
    });
}

/**
 * Load and display sustainability metrics for a repository.
 * Tries the new per-package CASS format first; falls back to the legacy flat format.
 * @param {string} repoName repository name (owner/repo format)
 */
function loadSustainabilityMetrics(repoName) {
  // Extract repository name from owner/repo format (e.g., HDFGroup/hdf5 -> hdf5)
  const repoNameOnly = repoName.split('/')[1];
  const metricsPath = `${window.config.baseUrl}/explore/github-data/${repoNameOnly}-metrics/metrics.json`;

  fetch(metricsPath)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Metrics file not found: ${repoNameOnly}-metrics/metrics.json`);
      }
      return res.json();
    })
    .then((metricsData) => {
      renderSustainabilityMetrics(metricsData);
    })
    .catch((error) => {
      console.log('Sustainability metrics not available:', error);
      // Still render the metrics structure with all placeholders
      renderSustainabilityMetrics(null);
    });
}

/**
 * Render sustainability metrics as a pinwheel card grid.
 * Each sub-metric is a blade: color=passing, muted=failing, gray=not collected.
 * Works for any repository — data comes from {repo}-metrics/metrics.json.
 * @param {Object|null} metrics parsed metrics.json (null = no data available)
 */
function renderSustainabilityMetrics(metrics) {
  const metricsSection = document.getElementById('metrics-section');

  // ── Sub-metric definitions (CASS Sustainability Metrics Report v3) ──────────
  const DIMENSIONS = [
    {
      id: 'impact', label: '4.1 Impact', icon: 'fa-line-chart',
      headerClass: 'impact-header', color: '#1F6024', muted: '#bbf7d0',
      items: [
        { num: '4.1.1', blades: 5, short: 'Citation & Adoption', title: 'Software Citation and Adoption',
          subMetrics: ['Enhanced Citations and Mentions','Improved DOI Tracking','Comprehensive Citation Metadata','Advanced Dependency Analysis','AI-Enhanced Training Detection'] },
        { num: '4.1.2', blades: 3, short: 'Field Research', title: 'Field Research Impact',
          subMetrics: ['AI-Enhanced Publication Analysis','Comprehensive Institutional Tracking','Impact Narrative Extraction'] }
      ]
    },
    {
      id: 'sustainability', label: '4.2 Sustainability', icon: 'fa-leaf',
      headerClass: 'sustainability-header', color: '#1F5B60', muted: '#99f6e4',
      items: [
        { num: '4.2.1',  blades: 5,  short: 'CoC & Governance',    title: 'Codes of Conduct (CoC), Governance, and Contributor Guidelines',
          subMetrics: ['Enhanced Document Detection','Governance Keyword Analysis','OpenSSF Badge Integration','CHAOSS Governance Metrics','Governance Effectiveness Assessment'] },
        { num: '4.2.2',  blades: 5,  short: 'Licensing & FAIR',    title: 'Open-Source Licensing and FAIR Compliance',
          subMetrics: ['Enhanced License Detection','Automated FAIR4RS Assessment','OSI License Validation','License Exception Handling','FAIR Metadata Assessment'] },
        { num: '4.2.3',  blades: 6,  short: 'Active Maintenance',  title: 'Active Maintenance',
          subMetrics: ['Commit Activity Pattern Analysis','Maintenance Mode Indicator Detection','Activity Trend Monitoring','Release Pattern Assessment','Multi-Channel Communication Activity','Contributor Abandonment Forecasting'] },
        { num: '4.2.4',  blades: 7,  short: 'Engagement',          title: 'Engagement',
          subMetrics: ['Response Time Tracking','Issue Resolution Analysis','Pull Request Flow Assessment','Support Request Closure Analysis','Engagement Quality Metrics','Communication Pattern Analysis','Community Participation Assessment'] },
        { num: '4.2.5',  blades: 8,  short: 'Outreach',            title: 'Outreach',
          subMetrics: ['New Contributor Tracking','Contributor Retention Analysis','Contributor Lifecycle Mapping','Contribution Type Diversity','Good First Issue Effectiveness','External Event Participation','Training Material Integration','Onboarding Infrastructure Assessment'] },
        { num: '4.2.6',  blades: 7,  short: 'Welcomeness',         title: 'Welcomeness',
          subMetrics: ['CHAOSS Community Experience Metrics','Response Quality and Tone Analysis','Communication Sentiment Analysis','Contributor Journey Mapping','Language and Communication Review','Leadership Role Representation','Decision-Making Visibility'] },
        { num: '4.2.7',  blades: 5,  short: 'Collaboration',       title: 'Collaboration',
          subMetrics: ['Advanced Dependency Analysis','Cross-project Reference Detection','Interoperability Assessment','Collaboration Network Analysis','Standards Compliance Tracking'] },
        { num: '4.2.8',  blades: 5,  short: 'Financial',           title: 'Financial Sustainability',
          subMetrics: ['Enhanced Funding Documentation Analysis','Institutional Affiliation Tracking','NIH R50 Award Tracking','Corporate Sponsorship Detection','Funding Portfolio Analysis'] },
        { num: '4.2.9',  blades: 5,  short: 'Institutional',       title: 'Institutional & Organizational Support',
          subMetrics: ['RSE Position Detection','Institutional Support Tracking','Career Development Indicators','NIH R50 Award Integration','Institutional Policy Analysis'] },
        { num: '4.2.10', blades: 5,  short: 'Community Health',    title: 'Project Longevity and Community Health',
          subMetrics: ['Comprehensive Activity Analysis','Contributor Viability Assessment','Maintenance Mode Detection','Community Health Trends','Project Lifecycle Assessment'] }
      ]
    },
    {
      id: 'quality', label: '4.3 Quality', icon: 'fa-star',
      headerClass: 'quality-header', color: '#1F3A60', muted: '#bae6fd',
      items: [
        { num: '4.3.1', blades: 5,  short: 'Reliability',      title: 'Reliability and Robustness',
          subMetrics: ['Advanced Static Analysis','Enhanced Security Analysis','CERT Guidelines Compliance','Test Coverage Excellence','Reliability Trend Analysis'] },
        { num: '4.3.2', blades: 5,  short: 'Dev Practices',    title: 'Development Practices',
          subMetrics: ['CI/CD Effectiveness Assessment','Testing Framework Excellence','Code Review Quality Analysis','Development Tool Integration','Community Contribution Facilitation'] },
        { num: '4.3.3', blades: 5,  short: 'Reproducibility',  title: 'Reproducibility',
          subMetrics: ['FAIR4RS Compliance Assessment','Containerization Excellence','Version Control Best Practices','Environment Management','Reproducibility Documentation'] },
        { num: '4.3.4', blades: 5,  short: 'Usability',        title: 'Usability',
          subMetrics: ['User Experience Assessment','Documentation Completeness Analysis','Accessibility Feature Detection','Installation Success Tracking','Usage Analytics Integration'] },
        { num: '4.3.5', blades: 5,  short: 'Accessibility',    title: 'Accessibility',
          subMetrics: ['Portable Build System Detection','Container Availability Assessment','Architecture Compatibility Analysis','Platform Documentation Evaluation','Deployment Environment Testing'] },
        { num: '4.3.6', blades: 5,  short: 'Maintainability',  title: 'Maintainability and Understandability',
          subMetrics: ['Advanced Complexity Analysis','Code Quality Assessment','Documentation Quality Evaluation','Knowledge Distribution Analysis','Refactoring and Evolution Tracking'] },
        { num: '4.3.7', blades: 10, short: 'Performance',      title: 'Performance and Efficiency',
          subMetrics: ['Performance Benchmarking Integration','Environmental Impact Assessment','Resource Utilization Analysis','Scalability Assessment','Optimization Practice Evaluation','Memory Efficiency Analysis','I/O Performance Profiling','Algorithmic Complexity Assessment','Power Measurement Integration','Performance Portability Assessment'] }
      ]
    }
  ];

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const SCORE_KEYS = new Set(['score', 'compliance score']);

  function countSubItems(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    let n = 0;
    div.querySelectorAll('p').forEach(p => {
      const s = p.querySelector('strong');
      if (!s) return;
      if (!SCORE_KEYS.has(s.textContent.replace(':', '').trim().toLowerCase())) n++;
    });
    return n || 4;
  }

  function parseScore(html) {
    if (!html) return null;
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = div.textContent || '';
    const m = text.match(/Score:\s*(\d+)\/(\d+)/);
    if (!m) return null;
    const raw = +m[1], denom = +m[2];
    let failing = 0, na = 0;
    div.querySelectorAll('p').forEach(p => {
      if (p.classList.contains('sub-detail')) return;
      if (!p.querySelector('strong')) return;
      if (SCORE_KEYS.has(p.querySelector('strong').textContent.replace(':', '').trim().toLowerCase())) return;
      if (p.textContent.includes('✗')) failing++;
      else if (/\bN\/A\b|not applicable/i.test(p.textContent)) na++;
    });
    if (denom <= 20) return { filled: raw, failing, na, total: denom, label: `${raw}/${denom}` };
    const total = countSubItems(html);
    return { filled: Math.round(raw / denom * total), failing: 0, na: 0, total, label: `${raw}/${denom}` };
  }

  function pinwheelSVG(filled, failing, na, total, color, muted) {
    const S = 64, cx = S / 2, cy = S / 2;
    const R = S * 0.41, ri = S * 0.13, sw = S * 0.13, rw = S * 0.065, leanX = S * 0.09;
    const bPath = `M ${-rw} ${-ri} C ${-sw*1.1} ${-(ri+R)*0.42}, ${-sw*0.3+leanX} ${-R*0.82}, ${leanX} ${-R} C ${sw*0.7+leanX} ${-R*0.82}, ${sw*1.0} ${-(ri+R)*0.42}, ${rw} ${-ri} Z`;
    const GRAY = '#d1d5db';
    const NA_STROKE = '#94a3b8';
    let paths = '';
    for (let i = 0; i < total; i++) {
      const deg = (360 / total) * i;
      const t = `translate(${cx},${cy}) rotate(${deg.toFixed(1)})`;
      if (i < filled) {
        paths += `<path d="${bPath}" fill="${color}" transform="${t}"/>`;
      } else if (i < filled + failing) {
        paths += `<path d="${bPath}" fill="${muted}" transform="${t}"/>`;
      } else if (i < filled + failing + na) {
        paths += `<path d="${bPath}" fill="none" stroke="${NA_STROKE}" stroke-width="1.5" stroke-dasharray="3 2" transform="${t}"/>`;
      } else {
        paths += `<path d="${bPath}" fill="${GRAY}" transform="${t}"/>`;
      }
    }
    paths += `<circle cx="${cx}" cy="${cy}" r="${ri*0.75}" fill="#fff" stroke="#e2e8f0" stroke-width="1"/>`;
    return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  }

  // ── Build HTML ───────────────────────────────────────────────────────────────
  let html = '<div class="pw-metrics-container"><h2 class="metrics-main-title">Metrics</h2>';

  DIMENSIONS.forEach(dim => {
    const dimData = metrics ? metrics[dim.id] : null;
    html += `
      <div class="metric-dimension pw-dimension" id="pw-dim-${dim.id}">
        <div class="dimension-header ${dim.headerClass} pw-dim-header" style="cursor:pointer">
          <span class="pw-dim-icon"><span class="fa ${dim.icon}"></span></span>
          <h3 style="margin:0">${dim.label}</h3>
          <span class="pw-accordion-arrow fa fa-chevron-down" style="margin-left:auto;font-size:11px;color:rgba(255,255,255,0.75)"></span>
        </div>
        <div class="pw-card-grid">`;

    dim.items.forEach(item => {
      const entry = dimData && dimData[item.num] ? dimData[item.num] : null;
      const data = entry ? entry.data : null;
      const score = parseScore(data);
      const blades = item.blades || 4;
      const filled = data ? (score ? score.filled : blades) : 0;
      const failing = data ? (score ? score.failing : 0) : 0;
      const na = data ? (score ? score.na : 0) : 0;
      const total = score ? score.total : blades;
      const collected = filled + failing;
      const isPending = !data;
      const pwColor = isPending ? '#cbd5e1' : dim.color;
      const pwMuted = isPending ? '#e2e8f0' : dim.muted;
      const scoreHTML = data
        ? `<span>${filled}/${collected} ●</span>` + (collected < total ? `<span class="pw-score-total"> /${total}</span>` : '')
        : `<span class="pw-score-total">○ pending</span>`;

      html += `<div class="metric-card pw-card ${data ? 'has-data' : ''}"
                    style="color:${isPending ? '#94a3b8' : dim.color}"
                    data-dim="${dim.id}" data-num="${item.num}" title="${item.title}">
        ${pinwheelSVG(filled, failing, na, total, pwColor, pwMuted)}
        <div class="card-num">${item.num}</div>
        <div class="card-title">${item.short}</div>
      </div>`;
    });

    html += `</div>
        <div class="pw-detail-panel" id="pw-detail-${dim.id}">
          <div class="pw-detail-header">
            <span class="pw-detail-dot" style="background:${dim.color}"></span>
            <span class="pw-detail-title"></span>
          </div>
          <div class="pw-detail-body"></div>
        </div>
      </div>`;
  });

  html += '</div>';
  metricsSection.innerHTML = html;

  // ── Wire up interactions via event delegation ────────────────────────────────
  DIMENSIONS.forEach(dim => {
    const dimData = metrics ? metrics[dim.id] : null;
    const dimEl = document.getElementById(`pw-dim-${dim.id}`);
    const panel = document.getElementById(`pw-detail-${dim.id}`);
    const grid  = dimEl.querySelector('.pw-card-grid');
    let activeCard = null;

    // Accordion header
    dimEl.querySelector('.pw-dim-header').addEventListener('click', () => {
      const collapsed = grid.style.display === 'none';
      grid.style.display = collapsed ? '' : 'none';
      panel.style.display = collapsed ? '' : 'none';
      const arrow = dimEl.querySelector('.pw-accordion-arrow');
      arrow.style.transform = collapsed ? '' : 'rotate(-90deg)';
    });

    // Card clicks
    grid.addEventListener('click', e => {
      const card = e.target.closest('.pw-card');
      if (!card) return;

      const itemNum = card.dataset.num;
      const itemDef = dim.items.find(i => i.num === itemNum);
      const entry   = dimData && dimData[itemNum] ? dimData[itemNum] : null;
      const data    = entry ? entry.data : null;

      const opening = card !== activeCard;
      if (activeCard) { activeCard.classList.remove('active'); activeCard = null; }
      panel.classList.remove('pw-detail-visible');

      if (opening) {
        card.classList.add('active');
        activeCard = card;
        const titleEl = panel.querySelector('.pw-detail-title');
        const sectionDesc = SECTION_DESCRIPTIONS[itemNum];
        const titleText = `${itemNum} ${itemDef ? itemDef.title : ''}`;
        if (sectionDesc) {
          const sup = `<sup class="metric-help" tabindex="0" role="button" `
            + `aria-label="About ${escapeAttr(titleText)}" `
            + `data-desc="${escapeAttr(sectionDesc)}">?</sup>`;
          titleEl.innerHTML = titleText + sup;
          attachTooltipHandlers(titleEl);
        } else {
          titleEl.textContent = titleText;
        }

        let bodyHTML = data || '';
        if (!data && itemDef && itemDef.subMetrics) {
          bodyHTML = itemDef.subMetrics.map(sm => {
            const desc = SUBMETRIC_DESCRIPTIONS[sm];
            const sup = desc
              ? `<sup class="metric-help" tabindex="0" role="button" aria-label="About ${escapeAttr(sm)}" data-desc="${escapeAttr(desc)}">?</sup>`
              : '';
            return `<p class="pw-pending-sub">${sm}${sup}</p>`;
          }).join('') + '<p class="pw-pending-note">Data collection not yet implemented for this metric.</p>';
        } else if (!data) {
          bodyHTML = '<p class="pw-pending-note">Data collection pending.</p>';
        }
        // Strip the Score: line from the detail body
        bodyHTML = bodyHTML.replace(/<p[^>]*><strong>Score:<\/strong>[^<]*<\/p>/g, '');
        // Colorize ✓ and ✗ symbols
        bodyHTML = bodyHTML.replace(/✓/g, '<span style="color:#16a34a;font-weight:600">✓</span>');
        bodyHTML = bodyHTML.replace(/✗/g, '<span style="color:#dc2626;font-weight:600">✗</span>');
        // Inject sub-metric help tooltips for collected sections
        if (data) bodyHTML = addSubmetricTooltips(bodyHTML);

        const body = panel.querySelector('.pw-detail-body');
        body.innerHTML = bodyHTML;
        attachTooltipHandlers(body);
        body.querySelectorAll('p').forEach(p => {
          if (p.classList.contains('sub-detail')) return;
          const t = p.textContent;
          if (t.includes('Not yet collected')) { p.classList.add('pw-not-collected'); return; }
          const strong = p.querySelector('strong');
          if (!strong) return;
          if (t.includes('✓')) strong.style.color = '#16a34a';
          else if (t.includes('✗')) strong.style.color = '#dc2626';
        });
        panel.classList.add('pw-detail-visible');
      }
    });
  });
}

/**
 * Get descriptive label for sustainability score
 * @param {number} score score value (0-100)
 * @returns {string} descriptive label
 */
function getScoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Needs Improvement';
  return 'Limited Data';
}

// ─── CASS v3 per-package metrics rendering ────────────────────────────────────

/**
 * Brief descriptions for each CASS v3 section, sourced from the
 * CASS Sustainability Metrics Report v3.
 */
const SECTION_DESCRIPTIONS = {
  '4.1.1': 'Measures how frequently and accurately the software is cited in academic literature and adopted across research ecosystems, including DOI tracking and dependency analysis.',
  '4.1.2': "Assesses the software's contribution to scientific discoveries and research outcomes within specific research domains.",
  '4.2.1': 'Evaluates the presence and quality of governance documents, codes of conduct, and contributor guidelines that define community behavior and decision-making processes.',
  '4.2.2': "Assesses the clarity and permissiveness of the project's license and its alignment with FAIR (Findable, Accessible, Interoperable, Reusable) principles for research software.",
  '4.2.3': 'Measures the level of ongoing development activity including commit frequency, release cadence, and responsiveness to maintenance signals.',
  '4.2.4': 'Evaluates how responsive and active the project team is in addressing issues, pull requests, and community support requests.',
  '4.2.5': 'Measures efforts to attract new contributors, retain existing ones, and grow the project community through events and training materials.',
  '4.2.6': 'Assesses the quality and inclusiveness of community interactions, including communication tone, contributor journey support, and leadership diversity.',
  '4.2.7': 'Evaluates cross-project dependencies, interoperability with other tools, and participation in the broader scientific software ecosystem.',
  '4.2.8': 'Measures the diversity and stability of funding sources, including grants, corporate sponsors, and institutional support.',
  '4.2.9': 'Assesses organizational backing through dedicated RSE positions, institutional commitments, and career development pathways for research software engineers.',
  '4.2.10': 'Evaluates long-term sustainability indicators including contributor diversity, activity trends, and community resilience over time.',
  '4.3.1': 'Measures code correctness and safety through static analysis, security scanning, test coverage, and adherence to coding standards.',
  '4.3.2': 'Evaluates the maturity of CI/CD pipelines, testing frameworks, code review processes, and development tooling.',
  '4.3.3': 'Assesses whether the software can be reliably built and executed across different environments, including containerization and FAIR4RS compliance.',
  '4.3.4': 'Measures how accessible the software is to its intended users, including documentation quality, installation ease, and user experience.',
  '4.3.5': 'Evaluates the ability to build and run across diverse computing platforms, architectures, and deployment environments.',
  '4.3.6': 'Assesses code complexity, documentation quality, knowledge distribution among contributors, and long-term code evolution patterns.',
  '4.3.7': 'Measures computational performance, resource utilization, scalability, and environmental impact across different hardware platforms and architectures.',
};

/**
 * Descriptions for each CASS v3 sub-metric, sourced from the
 * CASS Sustainability Metrics Report v3.
 */
const SUBMETRIC_DESCRIPTIONS = {
  // 4.1.1 Software Citation and Adoption
  "Enhanced Citations and Mentions": "Advanced tools, including Semantic Scholar's enhanced API (2024), OpenAlex's comprehensive scholarly database, and AI-powered citation extraction from preprints and grey literature.",
  "Improved DOI Tracking": "Integration with Software Heritage, Zenodo enhanced APIs, and emerging platforms like DataCite for comprehensive software publication tracking.",
  "Comprehensive Citation Metadata": "Enhanced CITATION.cff and codemeta.json detection with validation tools and automated metadata quality assessment for machine-readable software citation.",
  "Advanced Dependency Analysis": "Multi-platform ecosystem mapping including Spack, conda-forge, PyPI, CRAN, Bioconductor, and domain-specific package managers.",
  "AI-Enhanced Training Detection": "Machine learning-powered analysis of educational content across platforms including Coursera, edX, institutional repositories, and GitHub Classroom materials.",
  // 4.1.2 Field Research Impact
  "AI-Enhanced Publication Analysis": "Large language model-powered analysis of scientific literature to identify software-enabled discoveries and methodological innovations.",
  "Comprehensive Institutional Tracking": "Advanced web scraping and API integration with major research facilities, national laboratories, and computational centers.",
  "Impact Narrative Extraction": "Natural language processing to identify and categorize impact claims from publications, facility reports, and research announcements.",
  // 4.2.1 Codes of Conduct, Governance, and Contributor Guidelines
  "Enhanced Document Detection": "Advanced file scanning for CODE_OF_CONDUCT.md, CONTRIBUTING.md, GOVERNANCE.md, and variant naming conventions using GitHub Contents API.",
  "Governance Keyword Analysis": "Natural language processing to detect governance-related keywords, decision-making processes, and community structure indicators.",
  "OpenSSF Badge Integration": "Automated assessment of OpenSSF Best Practices Badge completion status, particularly governance documentation requirements.",
  "CHAOSS Governance Metrics": "Implementation of standardized CHAOSS governance health indicators, including decision-making transparency and community participation metrics.",
  "Governance Effectiveness Assessment": "Analysis of issue resolution patterns, decision implementation tracking, and community participation in governance processes.",
  // 4.2.2 Open-Source Licensing and FAIR Compliance
  "Enhanced License Detection": "Advanced SPDX license identification with improved parsing of license exceptions (e.g., 'Apache 2.0 with LLVM exceptions').",
  "Automated FAIR4RS Assessment": "Integration with FAIR-IMPACT project tools, including FAIRsoft and F-UJI Extended Service for quantitative FAIR compliance checking.",
  "OSI License Validation": "Comprehensive comparison against the Open Source Initiative-approved license list with automated compliance scoring.",
  "License Exception Handling": "Specialized tools for detecting and correctly categorizing license modifications and exceptions that standard APIs miss.",
  "FAIR Metadata Assessment": "Automated evaluation of research software metadata quality, documentation completeness, and interoperability standards.",
  // 4.2.3 Active Maintenance
  "Commit Activity Pattern Analysis": "Evaluation of commit frequency, seasonal trends, and gaps using 20-day rolling windows to forecast contributor activity.",
  "Maintenance Mode Indicator Detection": "Automated identification of archive status flags, maintenance mode labels, and explicit abandonment announcements in README files or repository descriptions.",
  "Activity Trend Monitoring": "Tracking of overall project activity patterns to distinguish stable mature projects from concerning declines that may indicate abandonment risk.",
  "Release Pattern Assessment": "Examination of release frequency, versioning schemes, semantic versioning compliance, and the ratio of feature development to bug fixes over time.",
  "Multi-Channel Communication Activity": "Observation of mailing lists, forums, Slack/Discord channels, and other community platforms for signs of active engagement.",
  "Contributor Abandonment Forecasting": "Probabilistic modeling based on recent contribution patterns to identify contributors at risk of abandonment using survival analysis techniques.",
  // 4.2.4 Engagement
  "Response Time Tracking": "Measurement of time to first response for issues, pull requests, and discussions, filtering automated bot responses and tracking by contributor type.",
  "Issue Resolution Analysis": "Tracking of issue resolution time, the ratio of open to closed issues, and identification of persistent backlogs indicating maintainer overload.",
  "Pull Request Flow Assessment": "Analysis of pull request opening and closing patterns, time to merge, and the ratio of PRs accepted versus closed without merge.",
  "Support Request Closure Analysis": "Tracking the ratio of closed versus opened support requests over time to identify trends in community responsiveness and maintainer capacity.",
  "Engagement Quality Metrics": "Analysis of interaction patterns focusing on depth and quality of maintainer responses, including comprehensiveness, actionability, and follow-through.",
  "Communication Pattern Analysis": "Examination of response consistency across issue types, contributor types, and channels to identify potential gaps or biases in engagement.",
  "Community Participation Assessment": "Analysis of issue resolution by non-core members, indicating distributed decision-making and community empowerment beyond core maintainer teams.",
  // 4.2.5 Outreach
  "New Contributor Tracking": "Measurement of new contributors making their first contribution across code commits, issue creation, pull requests, and code reviews, tracking trends over time.",
  "Contributor Retention Analysis": "Comprehensive tracking of contributor progression from first-time to casual to repeat contributors, including cohort analysis.",
  "Contributor Lifecycle Mapping": "Longitudinal analysis tracking individual contributor trajectories from initial discovery through sustained participation.",
  "Contribution Type Diversity": "Assessment of contribution types beyond code, including documentation, community management, event participation, mentorship, and translation.",
  "Good First Issue Effectiveness": "Analysis of newcomer-labeled issues and their impact on new contributor attraction, monitoring frequency, resolution rates, and time-to-claim metrics.",
  "External Event Participation": "Tracking of project representation at conferences, workshops, and meetups, including correlation with new contributor activity spikes.",
  "Training Material Integration": "Detection of project inclusion in educational content across Coursera, edX, institutional repositories, and university curricula.",
  "Onboarding Infrastructure Assessment": "Evaluation of onboarding resources, getting-started guides, contribution pathways, and mentorship program structure.",
  // 4.2.6 Welcomeness
  "CHAOSS Community Experience Metrics": "Assessments based on the CHAOSS framework, including measures related to welcoming, learning, contributing, and proposing changes.",
  "Response Quality and Tone Analysis": "Evaluating communication quality in community support, considering tone, clarity, acknowledgment of contributions, and constructiveness.",
  "Communication Sentiment Analysis": "Automated tracking of sentiment in community channels to identify general tone, potential conflict, and changes in interaction quality.",
  "Contributor Journey Mapping": "Automated analysis of onboarding success rates, retention patterns, contributor role progression, and common disengagement points.",
  "Language and Communication Review": "Analyzing documentation and communications for clarity, adherence to communication standards, and use of welcoming language.",
  "Leadership Role Representation": "Analyzing the distribution of leadership roles among different contributor demographics, locations, and organizational affiliations.",
  "Decision-Making Visibility": "Evaluating the accessibility of decision-making processes, meeting summaries, roadmap transparency, and community input in major decisions.",
  // 4.2.7 Collaboration
  "Cross-project Reference Detection": "AI-powered analysis of GitHub Issues and PRs for collaboration mentions, cross-project references, and shared development activities.",
  "Interoperability Assessment": "Automated analysis of API standards compliance, data format standardization, and integration capabilities.",
  "Collaboration Network Analysis": "Network analysis of contributor overlaps, shared dependencies, and cross-project communication patterns.",
  "Standards Compliance Tracking": "Assessment of adherence to domain-specific standards and protocols for scientific software interoperability.",
  // 4.2.8 Financial Sustainability
  "Enhanced Funding Documentation Analysis": "AI-powered parsing of README.md, FUNDING.yml, and documentation for comprehensive sponsorship and funding acknowledgment detection.",
  "Institutional Affiliation Tracking": "Advanced analysis of contributor organizational diversity using GitHub Users API and institutional email domain analysis.",
  "NIH R50 Award Tracking": "Specific monitoring for NIH Research Software Engineer award recipients and similar dedicated funding mechanisms.",
  "Corporate Sponsorship Detection": "Automated detection of corporate funding, in-kind contributions, and industry partnership indicators.",
  "Funding Portfolio Analysis": "Comprehensive assessment of funding source diversity, amounts, and temporal distribution patterns.",
  // 4.2.9 Institutional & Organizational Support
  "RSE Position Detection": "Automated identification of contributors with dedicated RSE titles or research software career positions using LinkedIn API and institutional directory analysis.",
  "Institutional Support Tracking": "Analysis of funding acknowledgments for institutional software development commitments and career pathway indicators.",
  "Career Development Indicators": "Detection of professional development activities, RSE community participation, and career advancement opportunities.",
  "NIH R50 Award Integration": "Specific tracking of NIH Research Software Engineer award recipients and similar dedicated career funding mechanisms.",
  "Institutional Policy Analysis": "Assessment of institutional policies supporting research software development and RSE career recognition.",
  // 4.2.10 Project Longevity and Community Health
  "Comprehensive Activity Analysis": "Multi-dimensional tracking of commit history, release frequency, issue resolution patterns, and community engagement indicators.",
  "Contributor Viability Assessment": "Analysis of contributor diversity, retention patterns, knowledge distribution, and succession planning indicators.",
  "Maintenance Mode Detection": "Automated detection of sustainability warning indicators, including pinned maintenance notices, archive status, and reduced activity patterns.",
  "Community Health Trends": "Longitudinal analysis of community engagement patterns, contributor onboarding success, and long-term participation trends.",
  "Project Lifecycle Assessment": "Classification of project maturity stages with appropriate sustainability indicators for each lifecycle phase.",
  // 4.3.1 Reliability and Robustness
  "Advanced Static Analysis": "Modern tools like DeepSource, CodeAnt.ai, or SemGrep with AI-powered analysis achieving improved false positive rates compared to traditional tools.",
  "Enhanced Security Analysis": "Comprehensive vulnerability detection using SAST/DAST tools, dependency vulnerability scanning, and automated security patch recommendations.",
  "CERT Guidelines Compliance": "Automated assessment of CERT Secure Coding Guidelines adherence with a specific focus on memory safety, input validation, and error handling.",
  "Test Coverage Excellence": "Advanced coverage analysis including branch coverage, mutation testing, and coverage quality assessment beyond simple percentage metrics.",
  "Reliability Trend Analysis": "Longitudinal tracking of defect density, Mean Time Between Failures (MTBF), and reliability improvement patterns.",
  // 4.3.2 Development Practices
  "CI/CD Effectiveness Assessment": "Analysis of pipeline success rates, build performance, deployment frequency, and automation quality using GitHub Actions, GitLab CI, or other platform APIs.",
  "Testing Framework Excellence": "Comprehensive evaluation of testing practices, including unit, integration, performance, and security testing coverage.",
  "Code Review Quality Analysis": "Assessment of review participation, review thoroughness, defect detection rates, and knowledge sharing through review processes.",
  "Development Tool Integration": "Analysis of linter configuration, code formatting consistency, dependency management, and development environment standardization.",
  "Community Contribution Facilitation": "Evaluation of how development practices support external contributions and community engagement.",
  // 4.3.3 Reproducibility
  "FAIR4RS Compliance Assessment": "Automated evaluation using FAIR-IMPACT project tools, including FAIRsoft and F-UJI Extended Service for quantitative FAIR compliance scoring.",
  "Containerization Excellence": "Analysis of Docker, Singularity, or other container configurations with emphasis on build success, documentation quality, and reproducibility testing.",
  "Version Control Best Practices": "Assessment of semantic versioning, release management, dependency pinning, and reproducible build configurations.",
  "Environment Management": "Evaluation of dependency management practices, environment specification completeness, and cross-platform compatibility.",
  "Reproducibility Documentation": "Analysis of installation instructions, usage examples, and reproducibility claims with validation testing where possible.",
  // 4.3.4 Usability
  "User Experience Assessment": "Integration with validated instruments like the User Experience Questionnaire (UEQ) with psychometric validation across 30+ languages.",
  "Documentation Completeness Analysis": "Automated evaluation of installation instructions, API documentation, tutorial availability, and user guide quality.",
  "Accessibility Feature Detection": "Analysis of internationalization support, UI accessibility features, alternative text for images, and inclusive design practices.",
  "Installation Success Tracking": "Automated testing of installation procedures across different platforms, package managers, and computing environments.",
  "Usage Analytics Integration": "Assessment of user engagement patterns, common user pathways, and usability pain points through analytics where available.",
  // 4.3.5 Accessibility (Portability)
  "Portable Build System Detection": "Analysis of installation scripts and portable build systems (e.g., Spack, Conda, CMake) with cross-platform compatibility assessment.",
  "Container Availability Assessment": "Evaluation of Docker, Singularity container availability and functionality across different container platforms.",
  "Architecture Compatibility Analysis": "Assessment of compatibility with accelerators, modern architectures, and diverse hardware configurations.",
  "Platform Documentation Evaluation": "Analysis of setup documentation quality across different platforms, clusters, and computing environments.",
  "Deployment Environment Testing": "Automated testing of software deployment across representative computing environments.",
  // 4.3.6 Maintainability and Understandability
  "Advanced Complexity Analysis": "Modern tools assessing cyclomatic complexity, cognitive complexity, nesting depth, and maintainability indices with AI-powered insights.",
  "Code Quality Assessment": "Comprehensive analysis of code duplication, design patterns, architectural consistency, and technical debt indicators.",
  "Documentation Quality Evaluation": "Assessment of code comments, API documentation, architectural documentation, and developer onboarding materials.",
  "Knowledge Distribution Analysis": "Evaluation of code ownership patterns, contributor knowledge distribution, and bus factor assessment for maintainability risks.",
  "Refactoring and Evolution Tracking": "Analysis of code evolution patterns, refactoring frequency, and maintenance burden trends over time.",
  // 4.3.7 Performance and Efficiency
  "Performance Benchmarking Integration": "Automated assessment using established benchmark suites, including HPC Challenge, SPEC benchmarks, and domain-specific performance tests.",
  "Environmental Impact Assessment": "Integration with ISO/IEC 21031:2024 SCI specification for carbon footprint measurement and energy efficiency optimization.",
  "Resource Utilization Analysis": "Comprehensive monitoring of CPU efficiency, memory usage patterns, I/O performance, and GPU utilization optimization.",
  "Scalability Assessment": "Analysis of parallel computing support, distributed system capabilities, and performance scaling characteristics.",
  "Optimization Practice Evaluation": "Assessment of compiler optimization usage, profiling tool integration, and performance-focused development practices.",
  "Memory Efficiency Analysis": "Profiling tools (Valgrind, Heaptrack) to measure memory footprint, leak detection, and allocation patterns.",
  "I/O Performance Profiling": "Darshan and parallel I/O benchmarks for characterizing file system access patterns and throughput.",
  "Algorithmic Complexity Assessment": "Static analysis tools to identify computational complexity, with validation through scaling studies.",
  "Power Measurement Integration": "RAPL (Running Average Power Limit) interface, NVML for GPU power, and external power meters for energy consumption validation.",
  "Performance Portability Assessment": "Consistent benchmarking across CPU architectures (x86, ARM, POWER), GPU vendors (NVIDIA, AMD, Intel), and accelerators.",
};

/**
 * Escape a string for use in an HTML attribute value.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Post-process a CASS section's HTML string to insert a clickable "?"
 * superscript after each sub-metric label that has a known description.
 * Only targets main-metric rows (<p><strong>Label:</strong>), not sub-detail rows.
 * @param {string} html Raw HTML string from metrics.json data field
 * @returns {string} HTML string with tooltip superscripts injected
 */
function addSubmetricTooltips(html) {
  return html.replace(
    /<p(?! class)[^>]*><strong>([^<]+):<\/strong>/g,
    (match, label) => {
      const desc = SUBMETRIC_DESCRIPTIONS[label.trim()];
      if (!desc) return match;
      const sup = `<sup class="metric-help" tabindex="0" role="button" `
        + `aria-label="About ${escapeAttr(label.trim())}" `
        + `data-desc="${escapeAttr(desc)}">?</sup>`;
      return `<p><strong>${label}${sup}:`;
    }
  );
}

/**
 * Create and attach a single shared tooltip element to the document body.
 * Safe to call multiple times — only creates the element once.
 */
function initMetricTooltips() {
  if (document.getElementById('metric-tooltip')) return;
  const tt = document.createElement('div');
  tt.id = 'metric-tooltip';
  tt.setAttribute('role', 'tooltip');
  document.body.appendChild(tt);

  document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('metric-help')) {
      tt.style.display = 'none';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') tt.style.display = 'none';
  });
}

/**
 * Wire up click/keyboard handlers on every .metric-help element inside container.
 * @param {HTMLElement} container
 */
function attachTooltipHandlers(container) {
  initMetricTooltips();
  const tt = document.getElementById('metric-tooltip');

  container.querySelectorAll('.metric-help').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      tt.textContent = el.getAttribute('data-desc');
      tt.style.display = 'block';
      // Position above the icon; clamp to viewport left edge
      const rect = el.getBoundingClientRect();
      const ttW = tt.offsetWidth;
      const left = Math.max(8, rect.left + rect.width / 2 - ttW / 2);
      const top = rect.top - tt.offsetHeight - 10;
      tt.style.left = left + 'px';
      tt.style.top = top + 'px';
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
}

/**
 * Render the new CASS v3 per-package metrics.json format.
 * Sections with collected data show their HTML; stub sections show a placeholder.
 * Each sub-metric label gets a "?" superscript tooltip sourced from SUBMETRIC_DESCRIPTIONS.
 * @param {Object} metrics Parsed metrics.json object
 */
function renderCassMetrics(metrics) {
  const metricsSection = document.getElementById('metrics-section');
  if (!metricsSection) return;

  const dimensions = [
    { key: 'impact',         label: '4.1 Impact' },
    { key: 'sustainability', label: '4.2 Sustainability' },
    { key: 'quality',        label: '4.3 Quality' },
  ];

  let html = `
    <h3>Sustainability Metrics</h3>
    <div class="sustainability-overview">
      <div class="metric-score-card">
        <h4>Overall Sustainability Score</h4>
        <div class="score-circle">
          <span class="score-value">${metrics.overall_score != null ? metrics.overall_score : '–'}/100</span>
        </div>
        <p class="score-label">${getScoreLabel(metrics.overall_score || 0)}</p>
      </div>
    </div>
  `;

  dimensions.forEach(({ key, label }) => {
    const sections = metrics[key];
    if (!sections) return;

    const sortedEntries = Object.entries(sections).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    );

    html += `<div class="metric-dimension">
      <div class="dimension-header"><h3>${label}</h3></div>
      <div class="dimension-content">`;

    sortedEntries.forEach(([num, info]) => {
      if (!info || !info.data) {
        html += `<div class="metric-subsection metric-subsection--stub">
          <h4>${num} ${info ? info.title : ''}</h4>
          <p class="metric-stub-note">Not yet collected</p>
        </div>`;
      } else {
        const processedData = addSubmetricTooltips(info.data);
        html += `<div class="metric-subsection">
          <h4>${num} ${info.title}</h4>
          <div class="metric-data">${processedData}</div>
        </div>`;
      }
    });

    html += `</div></div>`;
  });

  metricsSection.innerHTML = html;
  attachTooltipHandlers(metricsSection);
}

/////////////////////////////////////////////////////////
//////////// REPO LIST RENDER FUNCTIONS /////////////
/////////////////////////////////////////////////////////

function renderRepoListHeaderHtml() {
  // selectedCategoryIndex will be set to a valid number on initialization
  const category = catData[selectedCategoryIndex];
  REPO_HEADER_ELEMENT.innerHTML = `
    <img
      src="${window.config.baseUrl}${category.icon.path}"
      width="125"
      height="125"
      alt="${category.icon.alt}"
      title="${category.icon.alt}"
      loading="lazy"
    />
    <div class="title-description">
      <h2>${category.title}</h2>
      <p>${category.description.short}${category.description.long}</p>
    </div>
  `;
}

function renderRepoListHtml() {
  const isOrderReversed = orderProp.startsWith('-');
  const resolvedOrderProp = isOrderReversed ? orderProp.slice(1) : orderProp;
  // Safety check: ensure topicRepos array exists for this category
  if (!topicRepos[selectedCategoryIndex] || !Array.isArray(topicRepos[selectedCategoryIndex])) {
    console.error(`topicRepos[${selectedCategoryIndex}] is not valid`, topicRepos[selectedCategoryIndex]);
    REPO_SECTION_ELEMENT.innerHTML = '<p>Error loading repositories for this category.</p>';
    return;
  }
  const items = topicRepos[selectedCategoryIndex]
    .filter((repo) => {
      // Filter out repos that haven't been fully populated yet
      if (!repo.name || !repo.owner) {
        return false;
      }
      // If there's no filter text, include all repos
      if (!filterText) {
        return true;
      }
      // Otherwise, check if any field matches the filter text
      return (
        repo.name.toLowerCase().includes(filterText) ||
        repo.owner.toLowerCase().includes(filterText) ||
        (repo.language && repo.language.toLowerCase().includes(filterText)) ||
        (repo.description && repo.description.toLowerCase().includes(filterText)) ||
        repo.nameWithOwner.toLowerCase().includes(filterText)
      );
    })
    .sort((a, b) => {
      // Use case-insensitive sorting for string properties
      let x = a[resolvedOrderProp];
      let y = b[resolvedOrderProp];
      if (typeof x === 'string') x = x.toLowerCase();
      if (typeof y === 'string') y = y.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  if (isOrderReversed) {
    items.reverse();
  }
  REPO_SECTION_ELEMENT.innerHTML = items
    .map(
      (repo) => `
  <div class="catalog-grid-item">
    <a class="repoLink">
      <h3 class="text-center">
        <span title="Name">${repo.name}</span>
        <small><span title="Owner">${repo.owner}</span></small>
        <small><span title="Primary Language">${repo.language || '-'}</span></small>
      </h3>
    </a>
    ${repo.description ? `<p>${sanitizeHTML(repo.description)}</p>` : ''}

    <p class="stats text-center">
      <a href="${repo.gitUrl}" title="GitHub Repository">
        <span class="fa fa-github"></span>
      </a>

      <a href="/dashboard/explore/spack-dependencies/?package=${repo.name}" title="View Dependencies">
        <span class="fa fa-pie-chart"></span>
      </a>
      ${
        repo.homepageUrl
          ? `
        <a href="${repo.homepageUrl}" title="Project Website">
          <span class="fa fa-globe"></span>
        </a>
      `
          : ''
      }
      ${
        repo.cdash
          ? `
          <a href="${repo.cdash}" title="CDash Testing Dashboard"><img src="${window.config.baseUrl}/assets/images/logos/cdash.svg" height="20" width="20" alt="CDash"></img></a>
      `
          : ''
      }

    </p>
  </div>
  `,
    )
    .join('');
  const repoLinks = document.getElementsByClassName('repoLink');
  for (let i = 0; i < repoLinks.length; i++) {
    repoLinks[i].addEventListener('click', () => {
      const repo = encodeURIComponent(items[i].nameWithOwner);
      setVisibleRepo(repo);
    });
  }
}

/**
 * Call when the user updates category (either through the UI or through the browser)
 *
 * @param {number} categoryIdx selected index of the category
 */
function onCategoryUpdate(categoryIdx) {
  selectedCategoryIndex = categoryIdx;
  console.log(`Category updated to index ${categoryIdx}, category: ${catData[categoryIdx]?.title}, repos count: ${topicRepos[categoryIdx]?.length}`);
  const categoryButtons = document.getElementsByClassName('tab');
  for (let i = 0; i < categoryButtons.length; i++) {
    const button = categoryButtons[i];
    if (button.id.endsWith(categoryIdx)) {
      button.classList.add('selected-tab');
    } else {
      button.classList.remove('selected-tab');
    }
  }
  // Show welcome text only for "All Software" category (index 0)
  if (ELEMENT_WELCOME_TEXT) {
    if (categoryIdx === 0) {
      ELEMENT_WELCOME_TEXT.classList.remove(HIDDEN_CLASS);
    } else {
      ELEMENT_WELCOME_TEXT.classList.add(HIDDEN_CLASS);
    }
  }
  renderRepoListHeaderHtml();
  renderRepoListHtml();
}

////////////////////////////////////////////////
///////////// MAIN UPDATE FUNCTIONS /////////////
////////////////////////////////////////////////

function showCategoryList() {
  setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 0);
  ELEMENTS_ONLY_LIST.forEach((ele) => ele.classList.remove(HIDDEN_CLASS));
  ELEMENTS_ONLY_SINGLE_REPO.forEach((ele) => ele.classList.add(HIDDEN_CLASS));
}

function showSingleRepo() {
  setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 0);
  ELEMENTS_ONLY_SINGLE_REPO.forEach((ele) => ele.classList.remove(HIDDEN_CLASS));
  ELEMENTS_ONLY_LIST.forEach((ele) => ele.classList.add(HIDDEN_CLASS));
}

/**
 *
 * User has selected a visible repository. If user selects empty repository, render category list instead.
 *
 * @param {string} newValue the next repo to change
 * @param {boolean} shouldPushState Set to true the first time the user navigates to the catalog, or navigates from history. 
 *   Leave as false or undefined if the user triggers a click event.
 *
 */
function setVisibleRepo(newValue, shouldPushState) {
  visibleRepo = newValue;
  if (!visibleRepo) {
    if (!hasUserVisitedCategoryListPageYet) {
      hasUserVisitedCategoryListPageYet = true;
      // init
      fetch(`${window.config.baseUrl}/catalog/category_info.json`)
        .then((res) => res.json())
        .then((catInfoJson) => {
          Object.values(catInfoJson.data)
            .map((data) => {
              data['displayTitle'] = titleCase(data.title);
              // this is used both in the URL and the HTML ID
              data['urlParam'] = categoryToUrl(data.title);
              return data;
            })
            .sort((a, b) => {
              const x = a['displayTitle'];
              const y = b['displayTitle'];
              return x < y ? -1 : x > y ? 1 : 0;
            })
            .forEach((category) => catData.push(category));
          // get selected index from URL query param, or default to "all software" if invalid/no param
          const initialCategory = new URLSearchParams(window.location.search).get('category')?.toLowerCase() || 'all';
          for (let c = 0; c < catData.length; c++) {
            if (catData[c].urlParam === initialCategory) {
              selectedCategoryIndex = c;
              break;
            }
          }

          // render category specific HTML
          renderRepoListHeaderHtml();
          ELEMENT_NAV_DESKTOP.innerHTML = catData
            .map(
              (category, idx) => `
            <button id="btn__${idx}" class="tab${idx === selectedCategoryIndex ? ' selected-tab' : ''}">
              <img
                src="${window.config.baseUrl}${category.icon.path}"
                height="40"
                width="40"
                alt="${category.icon.alt}"
                title="${category.icon.alt}"
                loading="lazy"
              />
              <span>
                ${sanitizeHTML(category.displayTitle)}
              </span>
            </button>
          `,
            )
            .join('');
          ELEMENT_NAV_MOBILE.innerHTML = catData
            .map(
              (category, idx) => `
            <button id="nav-btn__${idx}" class="tab${idx === selectedCategoryIndex ? ' selected-tab' : ''}">${sanitizeHTML(
                category.displayTitle,
              )}</button>
          `,
            )
            .join('');
          const tabElements = document.getElementsByClassName('tab');
          for (let i = 0; i < tabElements.length; i++) {
            const ele = tabElements[i];
            const tabIdx = Number(ele.id.split('__')[1]);
            ele.addEventListener('click', () => {
              window.history.pushState(
                { categoryIndex: tabIdx, repo: visibleRepo },
                '',
                `?category=${catData[tabIdx].urlParam}&repo=${visibleRepo}`,
              );
              onCategoryUpdate(tabIdx);
            });
          }

          // map topics to categories - first try CASS explicit mapping, then fall back to topics
          fetch(`${window.config.baseUrl}/catalog/cass_category_mapping.json`)
            .then((res) => res.json())
            .then((cassMapping) => {
              // Initialize category arrays with CASS mapping
              catData.forEach((category) => {
                const catRepos = [];
                const cassRepos = cassMapping.data[category.title] || [];
                // Add repos from CASS explicit mapping
                cassRepos.forEach((repoName) => {
                  catRepos.push({ nameWithOwner: repoName });
                });
                topicRepos.push(catRepos);
              });

              // Return promise to continue chain
              return fetch(`${window.config.baseUrl}/explore/github-data/intRepos_Topics.json`);
            })
            .then((res) => res.json())
            .then((topicJson) => {
              const reposObj = topicJson.data;
              // Add additional repos based on topics (that aren't already in CASS mapping)
              catData.forEach((category, idx) => {
                for (let r in reposObj) {
                  // Check if repo is already in this category from CASS mapping
                  const alreadyAdded = topicRepos[idx].some(existing => existing.nameWithOwner === r);
                  if (!alreadyAdded) {
                    const repo = reposObj[r];
                    const topics = [];
                    repo.repositoryTopics.nodes.forEach((node) => {
                      topics.push(node.topic.name);
                    });
                    if (containsTopics(category.topics, topics)) {
                      topicRepos[idx].push({ nameWithOwner: r });
                    }
                  }
                }
              });

              // Return promise to continue chain
              return fetch(`${window.config.baseUrl}/explore/github-data/intReposInfo.json`);
            })
            .then((res) => res.json())
            .then((infoJson) => {
              const reposInfoObj = infoJson.data;
              for (let repo in reposInfoObj) {
                    //reposInfoObj[repo] is the actual repo object
                    for (let j in topicRepos) {
                      //var category is array of objects
                      const category = topicRepos[j];
                      for (let count in category) {
                        // category[count] is a specific repo within a category
                        //if we find a repo that is included in the category repos, we save more info on it
                        if (category[count].nameWithOwner === reposInfoObj[repo].nameWithOwner) {
                          //save only necessary data fields
                          category[count]['name'] = reposInfoObj[repo].name;
                          category[count]['description'] = reposInfoObj[repo].description;
                          category[count]['ownerAvatar'] = reposInfoObj[repo].owner.avatarUrl;
                          category[count]['owner'] = reposInfoObj[repo].owner.login;
                          category[count]['stars'] = reposInfoObj[repo].stargazers.totalCount;
                          category[count]['gitUrl'] = reposInfoObj[repo].url;
                          category[count]['homepageUrl'] = reposInfoObj[repo].homepageUrl;
                          if (reposInfoObj[repo].primaryLanguage) {
                            category[count]['language'] = reposInfoObj[repo].primaryLanguage.name;
                          } else {
                            category[count]['language'] = '';
                          }
                          category[count]['forks'] = reposInfoObj[repo].forks.totalCount;
                          if (reposInfoObj[repo].cdash) {
                            category[count]['cdash'] = reposInfoObj[repo].cdash
                          }
                        }
                      }
                    }
                  }
                  renderRepoListHtml();
                });
        });
    }
    showCategoryList();
  } else {
    renderSingleRepo(decodeURIComponent(visibleRepo));
    showSingleRepo();
  }
  if (!shouldPushState) {
    window.history.pushState(
      { categoryIndex: selectedCategoryIndex, repo: visibleRepo },
      '',
      `?category=${catData[selectedCategoryIndex].urlParam}&repo=${visibleRepo}`,
    );
  }
}

/////////////////////////////////////////////////////////////////
////////////////////// INIT /////////////////////////////////////
/////////////////////////////////////////////////////////////////

// Sets initial category page
const repoFromUrl = new URLSearchParams(window.location.search).get('repo') || '';
setVisibleRepo(repoFromUrl, true);

////////////////////////////////////////////////////////////////
//////////////////////// EVENT LISTENERS ///////////////////////
////////////////////////////////////////////////////////////////

// searching
document.getElementById('searchText').addEventListener('input', (e) => {
  filterText = e.target.value.toLowerCase();
  renderRepoListHtml();
  // TODO test out debounce when we have a lot of data
  // clearTimeout(searchTimeout);
  // searchTimeout = setTimeout(() => {
  //   filterText = e.target.value.toLowerCase();
  //   renderRepoHtml();
  // }, 1000);
});

// sorting
document.getElementById('orderProp').addEventListener('change', (e) => {
  orderProp = e.target.value;
  renderRepoListHtml();
});

// mobile nav
document.getElementById('category-hamburger-btn').addEventListener('click', () => {
  ELEMENT_NAV_MOBILE.classList.toggle(HIDDEN_CLASS);
});

// back button on category list
document.getElementById('category-list-btn').addEventListener('click', () => {
  setVisibleRepo('');
});

// user presses back/forward buttons on their browser
window.addEventListener('popstate', (e) => {
  const oldRepoState = e.state?.repo;
  const hasOldRepoState = !!oldRepoState;
  if (!hasOldRepoState || oldRepoState !== visibleRepo) {
    setVisibleRepo(hasOldRepoState ? oldRepoState : '', true);
  }

  const oldCategoryState = e.state?.categoryIndex;
  const hasOldCategoryState = typeof oldCategoryState === 'number';
  if (!hasOldCategoryState || oldCategoryState !== selectedCategoryIndex) {
    onCategoryUpdate(hasOldCategoryState ? oldCategoryState : 0);
  }
});
