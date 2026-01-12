/*************************************************
 * CONFIG
 *************************************************/
const ACCESS_PASSWORD = "lupfig";

// Artifacts folder location
const ARTIFACTS_FOLDER = "./artifacts";

// localStorage keys
const LS_AUTH  = "suter_dashboard_authed";
const LS_CACHE = "suter_dashboard_tests_cache";
const LS_THEME = "suter_dashboard_theme";

/*************************************************
 * DOM
 *************************************************/
const loginOverlay = document.getElementById("loginOverlay");
const accessPasswordInput = document.getElementById("accessPassword");
const accessBtn = document.getElementById("accessBtn");
const loginError = document.getElementById("loginError");

const app = document.getElementById("app");
const lupfigClock = document.getElementById("lupfigClock");
const kyivClock = document.getElementById("kyivClock");
const lastDeployed = document.getElementById("lastDeployed");
const collapseAllBtn = document.getElementById("collapseAll");
const themeToggle = document.getElementById("themeToggle");
const sunIcon = document.getElementById("sunIcon");
const moonIcon = document.getElementById("moonIcon");

const summary   = document.getElementById("summary");
const emptyState = document.getElementById("emptyState");
const testsList = document.getElementById("testsList");
const loadingSpinner = document.getElementById("loadingSpinner");

const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");
const closeModal = document.getElementById("closeModal");

let currentFilter = null;
let allTests = [];
let searchQuery = "";
let searchDebounceTimer = null;

/*************************************************
 * HELPERS
 *************************************************/
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ===== A) STATUS NORMALIZATION ===== */
function normalizeStatus(s){
  if (!s) return "not_tested";
  const v = String(s).toLowerCase().trim();
  if (v === "pass" || v === "passed") return "pass";
  if (v === "fail" || v === "failed") return "fail";
  return "not_tested";
}

/* ===== B) SAFE ARTIFACT RESOLUTION ===== */
function resolveArtifact(base, path){
  if (!path) return null;
  return path;
}

function setAuthed(v){
  localStorage.setItem(LS_AUTH, v ? "1" : "0");
}
function isAuthed(){
  return localStorage.getItem(LS_AUTH) === "1";
}

/*************************************************
 * CLOCKS
 *************************************************/
function updateClocks(){
  const now = new Date();
  
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  
  const lupfigTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  
  const kyivTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  lupfigClock.textContent = lupfigTime.format(now);
  kyivClock.textContent = kyivTime.format(now);
}

/*************************************************
 * THEME
 *************************************************/
function setTheme(theme){
  if (theme === "dark"){
    document.body.classList.add("dark-mode");
    sunIcon.classList.add("hidden");
    moonIcon.classList.remove("hidden");
  }else{
    document.body.classList.remove("dark-mode");
    sunIcon.classList.remove("hidden");
    moonIcon.classList.add("hidden");
  }
  localStorage.setItem(LS_THEME, theme);
}

function toggleTheme(){
  const current = localStorage.getItem(LS_THEME) || "light";
  setTheme(current === "light" ? "dark" : "light");
}

/*************************************************
 * DATA LOADING
 *************************************************/
async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

let deploymentTimestamp = null;

async function discoverArtifactFolders(){
  try{
    const cacheBuster = Date.now();
    const index = await fetchJson(`./artifacts-index.json?v=${cacheBuster}`);
    if (index.generated_at){
      deploymentTimestamp = new Date(index.generated_at);
    }
    console.log('Loaded artifacts index:', index);
    return index.folders || [];
  }catch(err){
    console.error('Failed to load artifacts index:', err);
    return [];
  }
}

function extractTestName(folderName){
  return folderName;
}

function normalizeTestName(name){
  return name
    .replace(/^test_/, '')
    .replace(/\.json$/, '')
    .toLowerCase()
    .trim();
}

function normalizeArtifactPath(artifactPath, folderName){
  if (!artifactPath) return null;
  
  if (artifactPath.startsWith('artifacts/')){
    return `./${artifactPath}`;
  }
  
  if (artifactPath.startsWith('screenshots/') || artifactPath.startsWith('videos/')){
    return `./${ARTIFACTS_FOLDER}/${folderName}/${artifactPath}`;
  }
  
  return artifactPath;
}

async function loadTests(){
  const artifactsIndex = await discoverArtifactFolders();
  const artifactTests = new Map();

  for (const artifact of artifactsIndex){
    try{
      const folder = artifact.name;
      const jsonFile = artifact.json_file;
      
      if (!jsonFile){
        throw new Error('No JSON file found');
      }
      
      const testData = await fetchJson(`${ARTIFACTS_FOLDER}/${folder}/${jsonFile}`);
      
      const testName = extractTestName(folder);
      testData.test_name = testData.test_name || testName;
      testData.artifact_folder = folder;
      
      if (testData.steps && Array.isArray(testData.steps)){
        testData.steps = testData.steps.map(step => {
          if (step.screenshot){
            step.screenshot = normalizeArtifactPath(step.screenshot, folder);
          }
          return step;
        });
      }
      
      if (testData.video_file){
        testData.video_file = `${ARTIFACTS_FOLDER}/${folder}/videos/${testData.video_file}`;
      }else if (artifact.video_file){
        testData.video_file = `${ARTIFACTS_FOLDER}/${folder}/videos/${artifact.video_file}`;
      }
      
      artifactTests.set(testName, testData);
    }catch(err){
      console.warn(`Failed to load test from ${artifact.name}:`, err);
    }
  }

  const results = [];

  let manifest = null;
  try{
    manifest = await fetchJson('./data/manifest.json');
  }catch(err){
    console.warn('No manifest.json found, using artifacts only');
  }

  if (manifest && manifest.tests && Array.isArray(manifest.tests)){
    const manifestTestNames = new Set();
    
    for (const testFile of manifest.tests){
      const normalizedName = normalizeTestName(testFile);
      manifestTestNames.add(normalizedName);
      
      let found = false;
      for (const [artifactName, testData] of artifactTests){
        if (normalizeTestName(artifactName) === normalizedName){
          results.push(testData);
          artifactTests.delete(artifactName);
          found = true;
          break;
        }
      }
      
      if (!found){
        results.push({
          test_name: testFile.replace(/^test_/, '').replace('.json', ''),
          overall_status: "not_tested",
          duration: "-",
          started_at: "-",
          steps: []
        });
      }
    }
    
    for (const [name, data] of artifactTests){
      results.push(data);
    }
  }else{
    for (const [name, data] of artifactTests){
      results.push(data);
    }
  }

  return results;
}

/*************************************************
 * RENDERING
 *************************************************/
function renderSummary(tests){
  const total = tests.length;
  const pass  = tests.filter(t => normalizeStatus(t.overall_status) === "pass").length;
  const fail  = tests.filter(t => normalizeStatus(t.overall_status) === "fail").length;
  const nt    = total - pass - fail;

  const passPercent = total > 0 ? Math.round((pass / total) * 100) : 0;
  const failPercent = total > 0 ? Math.round((fail / total) * 100) : 0;
  const ntPercent = total > 0 ? 100 - passPercent - failPercent : 0;

  const passDeg = (pass / total) * 360;
  const failDeg = (fail / total) * 360;
  const ntDeg = (nt / total) * 360;

  const pieGradient = total > 0 
    ? `conic-gradient(
        var(--pass) 0deg ${passDeg}deg,
        var(--fail) ${passDeg}deg ${passDeg + failDeg}deg,
        var(--not-tested) ${passDeg + failDeg}deg 360deg
      )`
    : 'var(--border)';

  summary.innerHTML = `
    <div class="stat-card ${currentFilter === null ? 'active' : ''}" data-filter="all">
      <div class="stat-label">Total</div>
      <div class="stat-value">${total}</div>
    </div>
    <div class="stat-card pass ${currentFilter === 'pass' ? 'active' : ''} ${pass === 0 ? 'disabled' : ''}" data-filter="pass" data-count="${pass}">
      <div class="stat-label">Pass</div>
      <div class="stat-value">${pass}</div>
    </div>
    <div class="stat-card fail ${currentFilter === 'fail' ? 'active' : ''} ${fail === 0 ? 'disabled' : ''}" data-filter="fail" data-count="${fail}">
      <div class="stat-label">Fail</div>
      <div class="stat-value">${fail}</div>
    </div>
    <div class="stat-card not-tested ${currentFilter === 'not_tested' ? 'active' : ''} ${nt === 0 ? 'disabled' : ''}" data-filter="not_tested" data-count="${nt}">
      <div class="stat-label">Not Tested</div>
      <div class="stat-value">${nt}</div>
    </div>
    <div class="pie-chart-container">
      <div class="pie-chart" style="background: ${pieGradient}"></div>
      <div class="pie-legend">
        ${pass > 0 ? `<div class="pie-legend-item"><span class="pie-dot pass"></span>${passPercent}% Pass</div>` : ''}
        ${fail > 0 ? `<div class="pie-legend-item"><span class="pie-dot fail"></span>${failPercent}% Fail</div>` : ''}
        ${nt > 0 ? `<div class="pie-legend-item"><span class="pie-dot not-tested"></span>${ntPercent}% Not Tested</div>` : ''}
      </div>
    </div>
  `;
  
  document.querySelectorAll('.stat-card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('disabled')) return;
      const filter = card.dataset.filter;
      currentFilter = filter === 'all' ? null : filter;
      applyFilter();
    });
  });
}

function chevron(){
  return `
    <svg viewBox="0 0 24 24">
      <path d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"/>
    </svg>
  `;
}

function applyFilter(){
  const groupCards = testsList.querySelectorAll('.group-card');
  groupCards.forEach(groupCard => {
    const testCards = groupCard.querySelectorAll('.test-card');
    let visibleCount = 0;
    let visibleStatuses = [];
    
    testCards.forEach(testCard => {
      const testStatus = testCard.dataset.status;
      if (currentFilter === null || testStatus === currentFilter){
        testCard.classList.remove('filtered-out');
        visibleCount++;
        visibleStatuses.push(testStatus);
      } else {
        testCard.classList.add('filtered-out');
      }
    });
    
    // Hide group if no tests match the filter
    if (visibleCount === 0 && currentFilter !== null){
      groupCard.classList.add('filtered-out');
    } else {
      groupCard.classList.remove('filtered-out');
      
      // Update group status badge based on visible tests only
      const groupBadge = groupCard.querySelector('.group-row .badge');
      const groupCount = groupCard.querySelector('.group-count');
      
      if (groupBadge && currentFilter !== null){
        // When filtering, show the filtered status
        groupBadge.className = `badge ${currentFilter}`;
        groupBadge.textContent = currentFilter.replace("_", " ").toUpperCase();
      } else if (groupBadge && currentFilter === null){
        // When not filtering, recalculate based on all visible tests
        const hasFailure = visibleStatuses.includes('fail');
        const allPass = visibleStatuses.every(s => s === 'pass');
        const newStatus = hasFailure ? 'fail' : (allPass ? 'pass' : 'not_tested');
        groupBadge.className = `badge ${newStatus}`;
        groupBadge.textContent = newStatus.replace("_", " ").toUpperCase();
      }
      
      // Update count to show only visible tests
      if (groupCount){
        groupCount.textContent = visibleCount;
      }
    }
  });
  renderSummary(allTests);
}

function groupTestsByGroup(tests){
  const groups = new Map();
  for (const t of tests){
    const groupName = t.test_group || "Ungrouped";
    if (!groups.has(groupName)){
      groups.set(groupName, []);
    }
    groups.get(groupName).push(t);
  }
  return groups;
}

function getGroupStatus(tests){
  const hasFailure = tests.some(t => normalizeStatus(t.overall_status) === "fail");
  if (hasFailure) return "fail";
  const allPass = tests.every(t => normalizeStatus(t.overall_status) === "pass");
  if (allPass) return "pass";
  return "not_tested";
}

function filterTestsBySearch(tests, query){
  if (!query) return tests;
  const lowerQuery = query.toLowerCase();
  return tests.filter(t => 
    (t.test_name || "").toLowerCase().includes(lowerQuery)
  );
}

function renderTests(tests){
  allTests = tests;
  testsList.innerHTML = "";

  if (!tests.length){
    emptyState.classList.remove("hidden");
    summary.innerHTML = "";
    return;
  }

  emptyState.classList.add("hidden");
  renderSummary(tests);
  
  // Add search bar (only once)
  const searchBox = document.createElement("div");
  searchBox.className = "search-box-container";
  searchBox.innerHTML = `
    <div class="search-box">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input type="text" id="searchInput" placeholder="Search by test name..." value="${escapeHtml(searchQuery)}">
      ${searchQuery ? `<button class="search-clear" id="searchClear" title="Clear search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>` : ''}
    </div>
  `;
  testsList.appendChild(searchBox);
  
  const searchInput = document.getElementById('searchInput');
  if (searchInput){
    searchInput.addEventListener('input', (e) => {
      const value = e.target.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchQuery = value;
        renderTestsContent(allTests);
      }, 150);
    });
  }
  
  const searchClear = document.getElementById('searchClear');
  if (searchClear){
    searchClear.addEventListener('click', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchQuery = '';
      const input = document.getElementById('searchInput');
      if (input) input.value = '';
      renderTestsContent(allTests);
    });
  }
  
  // Render the tests content
  renderTestsContent(tests);
}

function renderTestsContent(tests){
  // Remove only the tests wrapper, keep search box
  const existingWrapper = testsList.querySelector('.tests-wrapper');
  if (existingWrapper){
    existingWrapper.remove();
  }
  
  const totalDuration = calculateTotalDuration(tests.filter(t => normalizeStatus(t.overall_status) !== "not_tested"));
  
  const testsWrapper = document.createElement("div");
  testsWrapper.className = "tests-wrapper";
  
  testsWrapper.innerHTML = `
    <div class="tests-header">
      <div>Status</div>
      <div>Group / Test Name</div>
      <div class="col-duration">${escapeHtml(totalDuration)}</div>
      <div class="col-started">Time</div>
      <div></div>
    </div>
  `;
  
  const testsContainer = document.createElement("div");
  testsContainer.className = "tests";
  testsWrapper.appendChild(testsContainer);

  // Filter tests by search query
  const filteredTests = filterTestsBySearch(tests, searchQuery);
  
  // Group tests by test_group
  const groups = groupTestsByGroup(filteredTests);
  
  for (const [groupName, groupTests] of groups){
    const groupStatus = getGroupStatus(groupTests);
    const groupDuration = calculateTotalDuration(groupTests.filter(t => normalizeStatus(t.overall_status) !== "not_tested"));
    
    const groupCard = document.createElement("div");
    groupCard.className = "group-card";
    groupCard.dataset.status = groupStatus;
    
    groupCard.innerHTML = `
      <div class="group-row" tabindex="0" role="button" aria-expanded="false">
        <div class="badge ${groupStatus}">${groupStatus.replace("_"," ").toUpperCase()}</div>
        <div class="group-name">${escapeHtml(groupName)} <span class="group-count">${groupTests.length}</span></div>
        <div class="meta col-duration">${escapeHtml(groupDuration)}</div>
        <div class="meta col-started"></div>
        <div class="chev">${chevron()}</div>
      </div>
      <div class="group-tests"></div>
    `;
    
    const groupRow = groupCard.querySelector(".group-row");
    const groupTestsContainer = groupCard.querySelector(".group-tests");
    
    groupRow.addEventListener("click", () => {
      groupCard.classList.toggle("expanded");
      groupRow.setAttribute(
        "aria-expanded",
        groupCard.classList.contains("expanded") ? "true" : "false"
      );
    });
    
    // Render tests within this group
    for (const t of groupTests){
      const status = normalizeStatus(t.overall_status);
      const base = t.artifact_base || null;

      const steps = Array.isArray(t.steps) && t.steps.length
        ? t.steps
        : [{ step: "Test not executed", status: "not_tested" }];

      const videoSrc = t.video_file;
      const isNotTested = status === "not_tested";
      const kyivTime = convertToKyivTime(t.started_at);

      const card = document.createElement("div");
      card.className = "test-card";
      card.dataset.status = status;
      if (isNotTested) card.classList.add("not-expandable");

      card.innerHTML = `
        <div class="test-row" ${isNotTested ? '' : 'tabindex="0" role="button" aria-expanded="false"'}>
          <div class="badge ${status}">${status.replace("_"," ").toUpperCase()}</div>
          <div class="test-name">${escapeHtml(t.test_name || "Unnamed test")}</div>
          <div class="meta col-duration">${escapeHtml(formatDuration(t.duration))}</div>
          <div class="meta col-started">${escapeHtml(kyivTime)}</div>
          ${isNotTested ? '<div class="chev"></div>' : `<div class="chev">${chevron()}</div>`}
        </div>

        <div class="steps">
          ${t.test_description ? `<div class="test-description">${escapeHtml(t.test_description)}</div>` : ''}
          ${videoSrc ? `<div class="video-player">
            <video controls controlsList="nodownload" preload="metadata" src="${videoSrc}"></video>
          </div>` : ''}
          ${steps.map(s => {
            const st = normalizeStatus(s.status);
            const screenshotSrc = resolveArtifact(base, s.screenshot);

            const ssContent = screenshotSrc
              ? `<a class="screenshot-link-icon" href="${screenshotSrc}" target="_blank" title="Open in new tab">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
                <div class="screenshot-thumb" data-screenshot="${screenshotSrc}">
                  <img src="${screenshotSrc}" alt="Screenshot" loading="lazy">
                </div>`
              : `<span class="meta">-</span>`;

            const stepIcon = st === 'pass' 
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
              : st === 'fail'
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
              : `<span>-</span>`;

            return `
              <div class="step-row">
                <div class="step-badge ${st}">${stepIcon}</div>
                <div class="step-name">${escapeHtml(s.step)}</div>
                <div class="step-screenshot">${ssContent}</div>
              </div>
            `;
          }).join("")}
        </div>
      `;

      const row = card.querySelector(".test-row");
      
      if (!isNotTested){
        const videoPlayer = card.querySelector(".video-player");
        const video = videoPlayer ? videoPlayer.querySelector("video") : null;
        
        if (video){
          video.addEventListener("error", () => {
            videoPlayer.innerHTML = `<div class="video-unavailable">VIDEO FILE NOT FOUND</div>`;
          });
        }
        
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          
          card.classList.toggle("expanded");
          row.setAttribute(
            "aria-expanded",
            card.classList.contains("expanded") ? "true" : "false"
          );
        });
        
        const screenshotThumbs = card.querySelectorAll(".screenshot-thumb");
        screenshotThumbs.forEach(thumb => {
          thumb.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const screenshotSrc = thumb.dataset.screenshot;
            if (screenshotSrc){
              openImageModal(screenshotSrc);
            }
          });
        });
      }

      groupTestsContainer.appendChild(card);
    }
    
    testsContainer.appendChild(groupCard);
  }
  
  testsList.appendChild(testsWrapper);
}

/*************************************************
 * LAST DEPLOYED
 *************************************************/
function formatRelativeTime(date){
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  
  if (diffDays >= 1){
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }
  
  if (diffHr >= 1){
    const remainingMin = diffMin % 60;
    return `${diffHr}h ${remainingMin}m ago`;
  }
  
  if (diffMin >= 1){
    const remainingSec = diffSec % 60;
    return `${diffMin}m ${remainingSec}s ago`;
  }
  
  return `${diffSec}s ago`;
}

function updateLastDeployed(){
  if (deploymentTimestamp){
    lastDeployed.textContent = formatRelativeTime(deploymentTimestamp);
  }else{
    lastDeployed.textContent = "--";
  }
}

function formatDuration(duration){
  if (!duration) return "-";
  
  const match = duration.match(/(\d+)\s*hr\s*(\d+)\s*min\s*(\d+)\s*sec/);
  if (!match) return duration;
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  
  if (hours === 0 && minutes === 0){
    return `${seconds} sec`;
  }
  
  if (hours === 0){
    return `${minutes} min ${seconds} sec`;
  }
  
  return duration;
}

function parseDurationToSeconds(duration){
  if (!duration || duration === "-") return 0;
  
  const match = duration.match(/(\d+)\s*hr\s*(\d+)\s*min\s*(\d+)\s*sec/);
  if (!match) return 0;
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTotalDuration(totalSeconds){
  if (totalSeconds === 0) return "-";
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours === 0 && minutes === 0){
    return `${seconds} sec`;
  }
  
  if (hours === 0){
    return `${minutes} min ${seconds} sec`;
  }
  
  return `${hours} hr ${minutes} min ${seconds} sec`;
}

function calculateTotalDuration(tests){
  const totalSeconds = tests.reduce((sum, test) => {
    return sum + parseDurationToSeconds(test.duration);
  }, 0);
  return formatTotalDuration(totalSeconds);
}

function convertToKyivTime(utcTimeString){
  if (!utcTimeString || utcTimeString === "-") return "-";
  
  try {
    const date = new Date(utcTimeString);
    if (isNaN(date.getTime())) return utcTimeString;
    
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date).replace(",", "");
  } catch (err) {
    return utcTimeString;
  }
}

/*************************************************
 * AUTH
 *************************************************/
function handleLogin(){
  if (accessPasswordInput.value.toLowerCase() === ACCESS_PASSWORD){
    setAuthed(true);
    loginOverlay.classList.add("hidden");
    app.classList.remove("hidden");
    init();
  }else{
    loginError.textContent = "Incorrect password";
  }
}

/*************************************************
 * INIT
 *************************************************/
async function init(){
  if (loadingSpinner) loadingSpinner.classList.remove("hidden");
  try{
    const tests = await loadTests();
    localStorage.setItem(LS_CACHE, JSON.stringify(tests));
    renderTests(tests);
  }catch{
    const cached = JSON.parse(localStorage.getItem(LS_CACHE) || "[]");
    renderTests(cached);
  }
  updateLastDeployed();
  if (loadingSpinner) loadingSpinner.classList.add("hidden");
}

accessBtn.addEventListener("click", handleLogin);
accessPasswordInput.addEventListener("keydown", e => {
  if (e.key === "Enter") handleLogin();
});

themeToggle.addEventListener("click", toggleTheme);

collapseAllBtn.addEventListener("click", () => {
  const expandedGroups = document.querySelectorAll(".group-card.expanded");
  expandedGroups.forEach(group => {
    group.classList.remove("expanded");
    const row = group.querySelector(".group-row");
    if (row) row.setAttribute("aria-expanded", "false");
  });
  
  const expandedCards = document.querySelectorAll(".test-card.expanded");
  expandedCards.forEach(card => {
    card.classList.remove("expanded");
    const row = card.querySelector(".test-row");
    if (row) row.setAttribute("aria-expanded", "false");
  });
});

/*************************************************
 * IMAGE MODAL
 *************************************************/
function openImageModal(imageSrc){
  modalImage.src = imageSrc;
  imageModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeImageModal(){
  imageModal.classList.add("hidden");
  modalImage.src = "";
  document.body.style.overflow = "";
}

closeModal.addEventListener("click", (e) => {
  e.stopPropagation();
  closeImageModal();
});

imageModal.addEventListener("click", (e) => {
  if (e.target === imageModal){
    closeImageModal();
  }
});

modalImage.addEventListener("click", (e) => {
  e.stopPropagation();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !imageModal.classList.contains("hidden")){
    closeImageModal();
  }
});

/*************************************************
 * BOOT
 *************************************************/
const savedTheme = localStorage.getItem(LS_THEME) || "light";
setTheme(savedTheme);

updateClocks();
setInterval(updateClocks, 1000);

if (isAuthed()){
  loginOverlay.classList.add("hidden");
  app.classList.remove("hidden");
  init();
}else{
  loginOverlay.classList.remove("hidden");
}
