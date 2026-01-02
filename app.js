/*************************************************
 * CONFIG
 *************************************************/
const ACCESS_PASSWORD = "12345";

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
const themeToggle = document.getElementById("themeToggle");
const sunIcon = document.getElementById("sunIcon");
const moonIcon = document.getElementById("moonIcon");

const summary   = document.getElementById("summary");
const emptyState = document.getElementById("emptyState");
const testsList = document.getElementById("testsList");

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
  return folderName.replace(/_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_\d{2}$/, '');
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

  summary.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total</div>
      <div class="stat-value">${total}</div>
    </div>
    <div class="stat-card pass">
      <div class="stat-label">Pass</div>
      <div class="stat-value">${pass}</div>
    </div>
    <div class="stat-card fail">
      <div class="stat-label">Fail</div>
      <div class="stat-value">${fail}</div>
    </div>
    <div class="stat-card not-tested">
      <div class="stat-label">Not Tested</div>
      <div class="stat-value">${nt}</div>
    </div>
  `;
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

function renderTests(tests){
  testsList.innerHTML = "";

  if (!tests.length){
    emptyState.classList.remove("hidden");
    summary.innerHTML = "";
    return;
  }

  emptyState.classList.add("hidden");
  renderSummary(tests);

  for (const t of tests){
    const status = normalizeStatus(t.overall_status);
    const base   = t.artifact_base || null;

    /* ===== D) STEPS FALLBACK ===== */
    const steps = Array.isArray(t.steps) && t.steps.length
      ? t.steps
      : [{ step: "Test not executed", status: "not_tested" }];

    const videoSrc = t.video_file;
    const isNotTested = status === "not_tested";

    const card = document.createElement("div");
    card.className = "test-card";
    if (isNotTested) card.classList.add("not-expandable");

    card.innerHTML = `
      <div class="test-row" ${isNotTested ? '' : 'tabindex="0" role="button" aria-expanded="false"'}>
        <div class="badge ${status}">${status.replace("_"," ").toUpperCase()}</div>
        <div class="test-name">${escapeHtml(t.test_name || "Unnamed test")}</div>
        <div class="meta col-duration">${escapeHtml(formatDuration(t.duration))}</div>
        <div class="meta col-started">${escapeHtml(t.started_at || "-")}</div>
        ${isNotTested ? '<div class="chev"></div>' : `<div class="chev">${chevron()}</div>`}
      </div>

      <div class="steps">
        <div class="video-player" data-video-src="${videoSrc || ''}">
          ${videoSrc ? `<video controls controlsList="nodownload" preload="metadata"></video>` : `<div class="video-unavailable">NO VIDEO AVAILABLE</div>`}
        </div>
        ${steps.map(s => {
          const st = normalizeStatus(s.status);
          const screenshotSrc = resolveArtifact(base, s.screenshot);

          const ssLink = screenshotSrc
            ? `<a class="link" href="${screenshotSrc}" target="_blank">Open screenshot</a>`
            : `<span class="meta">Not tested</span>`;

          return `
            <div class="step-row">
              <div class="badge ${st}">${st.replace("_"," ").toUpperCase()}</div>
              <div class="step-name">${escapeHtml(s.step)}</div>
              <div>${ssLink}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    const row = card.querySelector(".test-row");
    
    if (!isNotTested){
      const videoPlayer = card.querySelector(".video-player");
      const video = videoPlayer ? videoPlayer.querySelector("video") : null;
      const videoSrcData = videoPlayer ? videoPlayer.dataset.videoSrc : null;
      
      if (video && videoSrcData){
        video.addEventListener("error", () => {
          videoPlayer.innerHTML = `<div class="video-unavailable">VIDEO FILE NOT FOUND</div>`;
        });
        video.src = videoSrcData;
      }
      
      row.addEventListener("click", () => {
        card.classList.toggle("expanded");
        row.setAttribute(
          "aria-expanded",
          card.classList.contains("expanded") ? "true" : "false"
        );
      });
    }

    testsList.appendChild(card);
  }
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

/*************************************************
 * AUTH
 *************************************************/
function handleLogin(){
  if (accessPasswordInput.value === ACCESS_PASSWORD){
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
  try{
    const tests = await loadTests();
    localStorage.setItem(LS_CACHE, JSON.stringify(tests));
    renderTests(tests);
  }catch{
    const cached = JSON.parse(localStorage.getItem(LS_CACHE) || "[]");
    renderTests(cached);
  }
  updateLastDeployed();
}

accessBtn.addEventListener("click", handleLogin);
accessPasswordInput.addEventListener("keydown", e => {
  if (e.key === "Enter") handleLogin();
});

themeToggle.addEventListener("click", toggleTheme);

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
