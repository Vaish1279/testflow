const { createClient } = window.supabase;
const supabaseClient = createClient(window.TESTFLOW_SUPABASE_URL, window.TESTFLOW_SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let authMode = "login";
let temporaryLogin = { email: "", password: "" };
let selectedRating = 0;
let projectFiles = [];
let lastReportId = null;

const PLAN_RANK = { free: 0, premium: 1, pro: 2 };
const TESTS = {
  functional: { label: "Functional testing", plan: "free" },
  ui: { label: "UI testing", plan: "free" },
  responsive: { label: "Responsive testing", plan: "free" },
  whitebox: { label: "White-box testing", plan: "premium" },
  function: { label: "Function analysis", plan: "premium" },
  path: { label: "Condition & path testing", plan: "premium" },
  execution: { label: "Execution & console insight", plan: "premium" },
  regression: { label: "Regression testing", plan: "pro" },
  compatibility: { label: "Compatibility testing", plan: "pro" },
  performance: { label: "Performance testing", plan: "pro" },
  evidence: { label: "Evidence collection", plan: "free" },
  report: { label: "Reports", plan: "free" }
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(message){
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>el.classList.remove("show"), 3200);
}
function openModal(id){ const el=$(id); if(!el)return; el.classList.add("open"); el.setAttribute("aria-hidden","false"); }
function closeModal(modal){ if(!modal)return; modal.classList.remove("open"); modal.setAttribute("aria-hidden","true"); }
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.closest(".modal"))));
$$(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m)}));

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function isAdmin(){ return currentProfile?.role === "admin"; }
function planRank(){ return isAdmin() ? 99 : PLAN_RANK[currentProfile?.plan || "free"]; }
function canUse(testKey){ return planRank() >= PLAN_RANK[TESTS[testKey]?.plan || "free"]; }
function requiredPlan(testKey){ return TESTS[testKey]?.plan || "free"; }
function prettySize(bytes){
  if(bytes < 1024) return `${bytes} B`;
  if(bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}

function setAuthUI(loggedIn){
  $$(".auth-nav,.auth-only,.footer-auth").forEach(el=>el.hidden=!loggedIn);
  $("#loginBtn").hidden=loggedIn;
  $("#history").hidden=!loggedIn;
  $("#accountBtn").textContent = isAdmin() ? "◎ Admin" : "◎ Account";
  updateWorkspaceAccess();
}

async function loadProfile(user){
  if(!user){ currentProfile=null; return; }
  const {data,error}=await supabaseClient.from("profiles").select("*").eq("id",user.id).single();
  if(error){ console.error("Profile load error",error); currentProfile=null; return; }
  currentProfile=data;
}

async function refreshAuth(){
  const {data:{session}} = await supabaseClient.auth.getSession();
  currentUser=session?.user || null;
  await loadProfile(currentUser);
  setAuthUI(!!currentUser);
  if(currentUser) await loadHistory();
}

supabaseClient.auth.onAuthStateChange(async (_event, session)=>{
  currentUser=session?.user || null;
  setTimeout(async()=>{
    await loadProfile(currentUser);
    setAuthUI(!!currentUser);
    if(currentUser) await loadHistory();
  },0);
});

function switchAuthMode(mode){
  authMode=mode;
  const signup=mode==="signup";
  $("#authTitle").textContent=signup?"Create your account":"Log in";
  $("#authMessage").textContent=signup
    ?"Create a Free account. No payment is required. Email confirmation is not required."
    :"Log in to access testing, private history, account and profile features.";
  $("#authName").style.display=signup?"block":"none";
  $("#authSubmit").textContent=signup?"Create account":"Log in";
  $("#switchAuth").textContent=signup?"Already have an account? Log in":"Create a new account";
  $("#forgotBtn").style.display=signup?"none":"block";
  $("#authEmail").value=temporaryLogin.email || "";
  $("#authPassword").value=temporaryLogin.password || "";
  $("#authStatus").textContent="";
}
$("#loginBtn").onclick=()=>{switchAuthMode("login");openModal("#authModal")};
$("#footerLogin").onclick=(e)=>{e.preventDefault();switchAuthMode("login");openModal("#authModal")};
$("#switchAuth").onclick=()=>switchAuthMode(authMode==="login"?"signup":"login");
$("#forgotBtn").onclick=async()=>{
  const email=$("#authEmail").value.trim();
  if(!email){$("#authStatus").textContent="Enter your email first.";return;}
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname+"?mode=reset"});
  $("#authStatus").textContent=error?error.message:"Password reset email sent. The reset email contains the secure reset link.";
};

$("#authForm").onsubmit=async(e)=>{
  e.preventDefault();
  const email=$("#authEmail").value.trim();
  const password=$("#authPassword").value;
  const name=$("#authName").value.trim();
  const status=$("#authStatus");
  status.textContent=authMode==="signup"?"Creating account…":"Logging in…";
  if(authMode==="signup"){
    const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{full_name:name}}});
    if(error){status.textContent=error.message;return}
    temporaryLogin={email,password};
    status.textContent="Congratulations! Your account has been created successfully. Login details are ready below.";
    switchAuthMode("login");
    $("#authStatus").textContent="Congratulations! Your account has been created successfully. Press Log in to continue.";
    if(data.user){
      try{ await supabaseClient.functions.invoke("send-account-created-email",{body:{user_id:data.user.id,email,full_name:name}}); }
      catch(err){ console.warn("Welcome email function not deployed/configured yet.",err); }
    }
  }else{
    const {error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error){status.textContent=error.message;return}
    temporaryLogin={email:"",password:""};
    closeModal($("#authModal"));
    toast("Logged in successfully.");
  }
};

function accountHtml(){
  if(!currentUser||!currentProfile)return "";
  const admin=isAdmin();
  const plan=admin?"ADMIN — ALL ACCESS":(currentProfile.plan||"free").toUpperCase();
  return `<b>${escapeHtml(currentProfile.full_name||"TestFlow user")}</b><br>${escapeHtml(currentUser.email)}<br><br><b>Role:</b> ${admin?"Admin":"User"}<br><b>Plan:</b> ${plan}<br><b>Testing access:</b> ${admin?"Free + Premium + Pro":"Based on your active plan"}`;
}
$("#accountBtn").onclick=async()=>{
  $("#accountInfo").innerHTML=accountHtml();
  if(isAdmin()){
    $("#upgradeBox").innerHTML='<div class="admin-access-box"><b>Admin access is active.</b><small>All Free, Premium and Pro capabilities are unlocked. No payment is required.</small></div><button class="secondary full" id="adminOpen">▤ Admin controls</button>';
    setTimeout(()=>$("#adminOpen").onclick=()=>{closeModal($("#accountModal"));openModal("#adminModal");loadAdminRequests();loadAdminStats()},0);
  }else{
    $("#upgradeBox").innerHTML=`<button class="secondary full" id="accountUpgrade">Request Premium / Pro</button>`;
    setTimeout(()=>$("#accountUpgrade").onclick=()=>{closeModal($("#accountModal"));openRequest("premium")},0);
  }
  openModal("#accountModal");
};
$("#logoutBtn").onclick=async()=>{await supabaseClient.auth.signOut();closeModal($("#accountModal"));toast("Logged out.");};
$("#profileBtn").onclick=async()=>{$("#profileName").value=currentProfile?.full_name||"";$("#profileEmail").value=currentUser?.email||"";openModal("#profileModal")};
$("#footerAccount").onclick=(e)=>{e.preventDefault();$("#accountBtn").click()};
$("#footerProfile").onclick=(e)=>{e.preventDefault();$("#profileBtn").click()};
$("#profileForm").onsubmit=async(e)=>{
  e.preventDefault();
  const full_name=$("#profileName").value.trim();
  const {error}=await supabaseClient.from("profiles").update({full_name}).eq("id",currentUser.id);
  $("#profileStatus").textContent=error?error.message:"Profile saved.";
  if(!error)currentProfile.full_name=full_name;
};

function getReportWarnings(session){
  const report=session?.report?.report_data?.report || session?.report?.report || session?.report?.report_data || {};
  const warnings=Array.isArray(report.warnings)?report.warnings:[];
  const fileWarnings=[];
  (report.fileDetails||[]).forEach(f=>{
    (f.issues||[]).forEach(issue=>fileWarnings.push(`${f.file||'File'}: ${issue}`));
  });
  return [...warnings,...fileWarnings].filter(Boolean);
}
function periodBounds(period){
  const now=new Date();
  const start=new Date(now); start.setHours(0,0,0,0);
  const end=new Date(start);
  if(period==='daily') end.setDate(end.getDate()+1);
  if(period==='weekly'){
    const day=start.getDay();
    const mondayOffset=(day+6)%7;
    start.setDate(start.getDate()-mondayOffset);
    end.setTime(start.getTime()); end.setDate(end.getDate()+7);
  }
  if(period==='monthly'){
    start.setDate(1);
    end.setFullYear(start.getFullYear(),start.getMonth()+1,1);
  }
  if(period==='yearly'){
    start.setMonth(0,1);
    end.setFullYear(start.getFullYear()+1,0,1);
  }
  return {start,end};
}
function renderPeriodicReports(rows,isAdmin=false){
  const periods=[['daily','Daily report'],['weekly','Weekly report'],['monthly','Monthly report'],['yearly','Yearly report']];
  const safeDate=v=>v?new Date(v).toLocaleString():'—';
  return `<div class="periodic-reports"><div class="periodic-head"><div><div class="eyebrow">TEST USAGE REPORTS</div><h3>${isAdmin?'All users':'Your'} testing reports</h3><p>${isAdmin?'Admin can see every user, test type, warning and warning detail.':'Only your own completed tests are included here.'}</p></div></div><div class="periodic-grid">${periods.map(([key,title])=>{
    const {start,end}=periodBounds(key);
    const items=rows.filter(s=>{const d=new Date(s.completed_at||s.started_at||s.created_at);return !Number.isNaN(d.getTime())&&d>=start&&d<end;});
    const warningItems=items.filter(s=>getReportWarnings(s).length);
    const passed=items.filter(s=>!getReportWarnings(s).length).length;
    const typeCounts={};const userCounts={};items.forEach(s=>{const label=(s.test_type||'General test').replace(/^Code Testing · |^Application Testing · /,'');typeCounts[label]=(typeCounts[label]||0)+1;if(isAdmin){const who=s.user_name||s.user_email||'Unknown user';userCounts[who]=(userCounts[who]||0)+1}});
    const breakdown=Object.entries(typeCounts).map(([k,v])=>`${escapeHtml(k)} × ${v}`).join(' · ')||'No tests in this period.';
    const userSummary=isAdmin?`<div class="periodic-user-summary"><b>User test count</b>${Object.entries(userCounts).map(([k,v])=>`<span>${escapeHtml(k)} <strong>${v}</strong></span>`).join('')||'<small>No user activity in this period.</small>'}</div>`:'';
    const detail=items.length?items.map(s=>{
      const warnings=getReportWarnings(s);const hasWarnings=warnings.length>0;
      const user=isAdmin?`<span><b>User</b>${escapeHtml(s.user_name||'Unknown user')}<small>${escapeHtml(s.user_email||'')}</small></span>`:'';
      return `<div class="periodic-row"><div><b>${escapeHtml(s.project_name||'Untitled project')}</b><small>${escapeHtml((s.test_type||'General test').replace(/^Code Testing · |^Application Testing · /,''))} · ${safeDate(s.completed_at||s.started_at)}</small></div>${user}<span class="periodic-warning ${hasWarnings?'has-warning':'no-warning'}"><b>${hasWarnings?'Warnings found':'No warnings'}</b><small>${hasWarnings?warnings.map(w=>escapeHtml(w)).join('<br>'):'No warning was recorded for this test.'}</small></span></div>`;
    }).join(''):'<div class="empty compact">No completed tests in this period.</div>';
    return `<article class="periodic-card"><div class="periodic-card-head"><div><span>${title}</span><h4>${items.length} test${items.length===1?'':'s'}</h4></div><span class="status-badge ${warningItems.length?'warning':'passed'}">${warningItems.length} warning test${warningItems.length===1?'':'s'}</span></div><div class="periodic-metrics"><span><b>${items.length}</b>Total</span><span><b>${passed}</b>No warning</span><span><b>${warningItems.length}</b>With warning</span></div>${userSummary}<p class="periodic-breakdown"><b>Tests used:</b> ${breakdown}</p><div class="periodic-list">${detail}</div></article>`;
  }).join('')}</div></div>`;
}

async function loadHistory(){
  if(!currentUser)return;
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    const {data,error}=await supabaseClient.rpc('get_test_history');
    if(!error){
      const rows=Array.isArray(data)?data:[];
      $('#periodicReports').innerHTML=renderPeriodicReports(rows,false);
      if(!rows.length){$('#historyList').innerHTML='<div class="empty">No test history yet. Run a completed test and it will appear here automatically.</div>';return}
      $('#historyList').innerHTML=`<div class="history-toolbar"><span>${rows.length} saved session${rows.length===1?'':'s'}</span><button class="danger small" id="deleteAllHistory">Delete all history</button></div>`+
        rows.map(s=>{const r=s.report||null;return `<div class="history-row"><div><b>${escapeHtml(s.project_name||'Untitled project')}</b><small>${escapeHtml(s.test_subject==='application'?'Application Testing':s.test_subject==='code'?'Code Testing':'Testing')} · ${escapeHtml((s.test_type||'General test').replace(/^Code Testing · |^Application Testing · /,''))} · ${s.started_at?new Date(s.started_at).toLocaleString():''}</small></div><span class="status-badge ${escapeHtml(s.status||'completed')} ">${escapeHtml(s.status||'completed')}</span><div class="history-actions"><small>${s.completed_at?new Date(s.completed_at).toLocaleString():'Completed'}</small>${r?`<button class="icon-action" title="View formal report" aria-label="View formal report" data-view-report="${r.id}">▣</button><button class="icon-action" title="Open download report" aria-label="Open download report" data-download-report="${r.id}">⇩</button>`:''}<button class="danger tiny" data-delete-session="${s.id}">Delete</button></div></div>`}).join('');
      $('#deleteAllHistory').onclick=deleteAllHistory;
      $$('[data-delete-session]').forEach(btn=>btn.onclick=()=>deleteSession(btn.dataset.deleteSession));
      $$('[data-view-report]').forEach(btn=>btn.onclick=async()=>openSavedReport(btn.dataset.viewReport));
      $$('[data-download-report]').forEach(btn=>btn.onclick=async()=>openSavedReport(btn.dataset.downloadReport));
      return;
    }
    lastError=error;
    await new Promise(r=>setTimeout(r,250*attempt));
  }
  $('#periodicReports').innerHTML='<div class="empty error-box">Periodic reports could not be loaded.</div>';
  $('#historyList').innerHTML=`<div class="empty error-box">History error: ${escapeHtml(lastError?.message||'Unable to load history.')}<br><small>Refresh once or run the latest TestFlow SQL.</small></div>`;
}

async function openSavedReport(reportId){
  const {data,error}=await supabaseClient.from('reports').select('id,session_id,title,report_data,created_at').eq('id',reportId).single();
  if(error||!data){toast(error?.message||'Saved report could not be opened.');return}
  const d=data.report_data||{};const report={...(d.report||{}),kind:d.report_kind||'report',testTypeLabel:d.report?.testTypeLabel||d.test_type||data.title,created_at:data.created_at};
  currentTestReport=report;lastReportId=data.id;reviewSubmitted=false;window.__reportWasDownloaded=false;
  showFormalReport(report,data.session_id);
}

async function deleteSession(id){
  if(!currentUser)return;
  if(!confirm("Delete this test session and its saved evidence/results?"))return;
  const {error}=await supabaseClient.from("test_sessions").delete().eq("id",id);
  if(error){toast(error.message);return}
  toast("Test session deleted.");
  await loadHistory();
}
async function deleteAllHistory(){
  if(!currentUser)return;
  if(!confirm("Delete all saved test sessions, results, evidence and reports for your account? This cannot be undone."))return;
  const {error}=await supabaseClient.from("test_sessions").delete().eq("user_id",currentUser.id);
  if(error){toast(error.message);return}
  toast("All test history deleted.");
  await loadHistory();
}
$("#refreshHistory").onclick=loadHistory;

let testSubject='code';
const CODE_ONLY_TESTS=['whitebox','function','path','execution'];
const APP_ONLY_TESTS=['ui','responsive'];
const SHARED_TESTS=['functional','regression','compatibility','performance','evidence','report'];
function testNeedsCode(key){return testSubject==='code' && !APP_ONLY_TESTS.includes(key);}
function testNeedsApp(key){return testSubject==='application' && !CODE_ONLY_TESTS.includes(key);}
function sourceReady(key){
  if(testNeedsCode(key)) return codeFiles.length>0;
  if(testNeedsApp(key)) return appFiles.length>0 && !!appEntryFile;
  return false;
}
let codeFiles=[];
let appFiles=[];
let appEntryFile=null;
let appZipName="";
let currentTestReport=null;
let reviewSubmitted=false;

function setTestSubject(subject){
  if(subject!=='code'&&subject!=='application')return;
  testSubject=subject;
  let key=$('#testType')?.value||'functional';
  if(subject==='code' && APP_ONLY_TESTS.includes(key)){key='functional';$('#testType').value=key;}
  if(subject==='application' && CODE_ONLY_TESTS.includes(key)){key='functional';$('#testType').value=key;}
  $$('.subject-btn').forEach(b=>b.classList.toggle('active',b.dataset.subject===subject));
  $('#subjectHint').textContent=subject==='code'?'Code report: analyse uploaded source files.':'Application report: analyse the uploaded ZIP and selected HTML entry page.';
  updateSelectedTestUI();
}
$$('.subject-btn').forEach(b=>b.addEventListener('click',()=>setTestSubject(b.dataset.subject)));

function updateWorkspaceAccess(){
  const signedIn=!!currentUser;
  $("#workspaceGate").hidden=signedIn;
  $("#workspaceControls").hidden=!signedIn;
  if(!signedIn){$("#workspaceStatus").textContent="Log in or create a Free account to start testing.";return;}
  const plan=isAdmin()?"ADMIN — ALL ACCESS":(currentProfile?.plan||"free").toUpperCase();
  $("#workspaceStatus").textContent=`Signed in · ${plan} · Choose Code Testing or Application Testing, select a test type, then run it.`;
  updateTestOptions();
}
function updateTestOptions(){
  const select=$("#testType");
  if(select){
    [...select.options].forEach(opt=>{const key=opt.value;const ok=canUse(key);opt.disabled=!ok;opt.textContent=ok?TESTS[key].label:`${TESTS[key].label} — ${requiredPlan(key).toUpperCase()}`;});
  }
  updateSelectedTestUI();
}
function updateSelectedTestUI(){
  const key=$("#testType")?.value||"functional";
  const meta=TESTS[key]||TESTS.functional;
  $("#selectedTestLabel").textContent=meta.label;
  $("#selectedTestPlan").textContent=isAdmin()?"ADMIN":requiredPlan(key).toUpperCase();
  const needsCode=testNeedsCode(key), needsApp=testNeedsApp(key);
  let hint=needsCode?"Code Testing subject: upload source files first.":needsApp?"Application Testing subject: upload a ZIP, select the HTML file, then run it.":"Choose a compatible testing subject first.";
  $("#selectedTestHint").textContent=hint;
  let runText=sourceReady(key)?`${testSubject==='code'?'Code':'Application'} source ready. Press Run selected test to create a separate ${testSubject==='code'?'Code':'Application'} report.`:needsCode?"Upload code files in the left panel.":needsApp?"Upload an application ZIP and select its HTML file in the right panel.":"This test type is not available for the selected subject.";
  if(!isAdmin()&&(currentProfile?.plan||'free')==='free'&&['functional','ui','responsive'].includes(key)) runText+=' Free plan limit: this test can be run once per day.';
  $("#runRequirement").textContent=runText;
  $("#runTestBtn").disabled=!currentUser || !canUse(key) || !sourceReady(key);
}
function selectTestingType(key){
  if(!TESTS[key])return;
  if(APP_ONLY_TESTS.includes(key))setTestSubject('application');
  else if(CODE_ONLY_TESTS.includes(key))setTestSubject('code');
  $("#testType").value=key;
  if(!canUse(key)){toast(`This test requires ${requiredPlan(key).toUpperCase()} access.`);return;}
  updateSelectedTestUI();
  document.querySelector("#workspace").scrollIntoView({behavior:"smooth",block:"start"});
  toast(`${TESTS[key].label} selected for ${testSubject==='code'?'Code Testing':'Application Testing'}.`);
}
$$('.type-card[data-test-type]').forEach(card=>card.addEventListener('click',()=>selectTestingType(card.dataset.testType)));
$("#testType").onchange=updateSelectedTestUI;
$("#workspaceLogin").onclick=()=>{if(currentUser)document.querySelector("#workspace").scrollIntoView({behavior:"smooth"});else{switchAuthMode("login");openModal("#authModal")}};
$("#heroStart").onclick=()=>{if(!currentUser){switchAuthMode("login");openModal("#authModal");return}document.querySelector("#workspace").scrollIntoView({behavior:"smooth"})};
$("#ctaStart").onclick=()=>$("#heroStart").click();
$("#startBtn").onclick=()=>$("#heroStart").click();

function showCodeFiles(files){
  codeFiles=Array.from(files||[]);
  if(!codeFiles.length){$("#codeSummary").textContent="No code uploaded.";$("#codeTerminal").innerHTML='<span class="terminal-muted">CODE TERMINAL — waiting for a code-testing source.</span>';updateSelectedTestUI();return;}
  const counts={js:0,py:0,java:0,c:0,php:0,other:0};
  codeFiles.forEach(f=>{const n=f.name.toLowerCase();if(/\.(js|ts|jsx|tsx)$/.test(n))counts.js++;else if(n.endsWith('.py'))counts.py++;else if(n.endsWith('.java'))counts.java++;else if(/\.(c|h|cpp|cc|cxx)$/.test(n))counts.c++;else if(n.endsWith('.php'))counts.php++;else counts.other++;});
  $("#codeSummary").textContent=`${codeFiles.length} file(s) · JS/TS ${counts.js} · Python ${counts.py} · Java ${counts.java} · C/C++ ${counts.c} · PHP ${counts.php}`;
  $("#codeTerminal").textContent=`[READY] Code source loaded.\n[FILES] ${codeFiles.length} file(s)\n[WAIT] Select a code testing type and press Run selected test.`;
  updateSelectedTestUI();
}
$("#codeInput").onchange=e=>showCodeFiles(e.target.files);
$("#clearCode").onclick=()=>{codeFiles=[];$("#codeInput").value="";showCodeFiles([])};

function makeEntry(path,name,size,textFn,blob){return {name,webkitRelativePath:path,size,text:textFn,blob}};
async function readZipApplication(file){
  if(!window.JSZip)throw new Error("ZIP reader is still loading. Refresh once and try again.");
  const zip=await JSZip.loadAsync(file);
  const entries=[];
  zip.forEach((path,entry)=>{
    if(!entry.dir){
      const z=zip.file(path);
      entries.push(makeEntry(path,path.split('/').pop()||path,entry._data?.uncompressedSize||0,async()=>z?await z.async('text'):"",async()=>z?await z.async('blob'):null));
    }
  });
  return entries;
}
$("#appZipInput").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    appFiles=await readZipApplication(file);appZipName=file.name.replace(/\.zip$/i,"");
    const htmls=appFiles.filter(f=>/\.(html?|xhtml)$/i.test(f.name));
    $("#appSummary").textContent=`${appFiles.length} file(s) · ${htmls.length} HTML page(s) · ZIP: ${appZipName}`;
    const select=$("#appEntrySelect");select.innerHTML=htmls.length?htmls.map((f,i)=>`<option value="${i}">${escapeHtml(f.webkitRelativePath||f.name)}</option>`).join(""):'<option value="">No HTML file found</option>';
    select.disabled=!htmls.length;$("#openAppBtn").disabled=!htmls.length;
    appEntryFile=htmls[0]||null;
    $("#appTerminal").textContent=htmls.length?`[ZIP OK] ${appZipName}\n[HTML] ${htmls.length} page(s) found.\n[SELECT] Choose the page you want to open.\n[READY] Application testing source is ready.`:`[ZIP OK] ${appZipName}\n[ERROR] No HTML page was found in this application ZIP.`;
    if(appEntryFile) await openApplicationPreview();
    updateSelectedTestUI();
  }catch(err){console.error(err);appFiles=[];appEntryFile=null;$("#appSummary").textContent="Could not read this ZIP.";$("#appTerminal").textContent=`[ERROR] ${err.message||"Invalid ZIP"}`;toast("Could not read the application ZIP.");updateSelectedTestUI();}
};
$("#appEntrySelect").onchange=async()=>{const htmls=appFiles.filter(f=>/\.(html?|xhtml)$/i.test(f.name));appEntryFile=htmls[Number($("#appEntrySelect").value)]||null;await openApplicationPreview();updateSelectedTestUI()};
$("#openAppBtn").onclick=()=>openApplicationPreview();
$("#clearApp").onclick=()=>{appFiles=[];appEntryFile=null;appZipName="";$("#appZipInput").value="";$("#appEntrySelect").innerHTML='<option>Upload application ZIP first</option>';$("#appEntrySelect").disabled=true;$("#openAppBtn").disabled=true;$("#appSummary").textContent="No application ZIP uploaded.";$("#appFrame").srcdoc="";$("#appTerminal").innerHTML='<span class="terminal-muted">APPLICATION TERMINAL — upload a ZIP and select an HTML file.</span>';updateSelectedTestUI()};

async function openApplicationPreview(){
  if(!appEntryFile)return;
  const html=await appEntryFile.text();
  const css=await Promise.all(appFiles.filter(f=>/\.css$/i.test(f.name)).slice(0,12).map(f=>f.text()));
  const js=await Promise.all(appFiles.filter(f=>/\.(js|mjs)$/i.test(f.name)).slice(0,12).map(f=>f.text()));
  window.__previewUrls?.forEach(u=>URL.revokeObjectURL(u));window.__previewUrls=[];
  const baseDir=(appEntryFile.webkitRelativePath||appEntryFile.name).split('/').slice(0,-1).join('/');
  const assets=appFiles.filter(f=>!(/\.(html?|xhtml|css|js|mjs)$/i.test(f.name)));
  for(const f of assets){
    const raw=f.webkitRelativePath||f.name;const url=URL.createObjectURL(await f.blob());window.__previewUrls.push(url);f.__previewUrl=url;
    const short=raw.split('/').pop();f.__shortName=short;
  }
  let doc=html;
  doc=doc.replace(/<link[^>]+href=["'][^"']+\.css[^"']*["'][^>]*>/gi,"");
  doc=doc.replace(/<script[^>]+src=["'][^"']+\.(?:js|mjs)[^"']*["'][^>]*><\/script>/gi,"");
  doc=doc.replace(/\b(src|href)=(['"])(?!https?:|data:|blob:|#|mailto:|tel:)([^'"]+)\2/gi,(m,attr,q,path)=>{
    const clean=decodeURIComponent(path.split('#')[0].split('?')[0]).replace(/^\.\//,'');
    const full=(baseDir?baseDir+'/':'')+clean;
    const match=appFiles.find(f=>((f.webkitRelativePath||f.name).replace(/^\.\//,'')===full)||f.__shortName===clean.split('/').pop());
    return match?.__previewUrl?`${attr}=${q}${match.__previewUrl}${q}`:m;
  });
  const cssBlock=`<style>${css.join("\n")}</style>`;
  const safeJs=js.join("\n").replace(/<\/script/gi,"<\\/script");
  const jsBlock=`<script>${safeJs}<\/script>`;
  doc=doc.replace(/<\/head>/i,`${cssBlock}</head>`);
  doc=doc.replace(/<\/body>/i,`${jsBlock}</body>`);
  $('#appFrame').srcdoc=doc;
  $('#browserPath').textContent=`testflow.local / ${appEntryFile.webkitRelativePath||appEntryFile.name}`;
  $('#appTerminal').textContent=`[OPEN] ${appEntryFile.webkitRelativePath||appEntryFile.name}\n[LOAD] HTML + project CSS + project JavaScript embedded for preview.\n[ASSETS] Local image/file assets were mapped for the preview where possible.\n[READY] Application is open in the TestFlow browser panel.\n[NOTE] Uploaded server-side PHP/backend code is not executed in this browser preview.`;
}
async function readText(file){try{return await file.text()}catch{return ""}}
function reportExpectation(testKey,kind,result){
  const label=TESTS[testKey]?.label||'Selected test';
  const expectedByKey={
    functional:'The tested feature should provide the expected controls, inputs and interaction signals without obvious functional blockers.',
    ui:'Visible controls, labels, images, navigation and interaction states should be present and reasonably usable.',
    responsive:'The source should include the structural signals needed for desktop, tablet and mobile layouts.',
    whitebox:'Internal code structure should expose understandable branches, loops and decision points for review.',
    function:'Functions should be identifiable, structurally reviewable and consistent with their expected return behaviour.',
    path:'Important decision points should expose identifiable execution paths for review.',
    execution:'Execution-related signals and error-handling patterns should be visible without obvious risky runtime constructs.',
    regression:'A repeatable baseline should be recorded so later runs can be compared against this result.',
    compatibility:'The project should contain structure and responsive signals that reduce common browser/screen compatibility risks.',
    performance:'The project should provide measurable performance-related structure and a saved baseline for later timing comparison.',
    evidence:'The supplied source and test observations should be traceable to the saved test session.',
    report:'The supplied source should produce a complete, readable report containing checks, findings and review items.'
  };
  const actual=result.status==='passed'
    ? 'The available TestFlow checks completed without a flagged review item for this run.'
    : `The available TestFlow checks completed, with ${result.warnings?.length||0} review item(s) requiring attention.`;
  return {subject:kind==='code'?'Code Testing':'Application Testing',expected:expectedByKey[testKey]||`The ${label.toLowerCase()} check should complete against the supplied source.`,actual,verdict:result.status==='passed'?'PASS':'PASS WITH REVIEW'};
}

async function analyzeCode(files,testKey){
  let text="";for(const f of files.slice(0,80))text+=`\n/* ${f.name} */\n${await readText(f)}`;
  const extCounts={};files.forEach(f=>{const m=f.name.toLowerCase().match(/\.([a-z0-9]+)$/);if(m)extCounts[m[1]]=(extCounts[m[1]]||0)+1});
  const findings=[],warnings=[],tests=[];
  const descriptions={whitebox:'Looks inside the uploaded source structure to identify branches, loops and code paths without changing the project.',function:'Finds functions and summarises their structure, return behaviour and possible risk signals.',path:'Reviews if/else, switch and related branches so important decision paths are visible.',execution:'Checks execution-related signals such as console output, risky runtime patterns and timing-ready evidence.',evidence:'Collects uploaded source facts and attaches them to a saved test session for traceability.',report:'Turns the uploaded source findings into a formal, readable report.'};
  tests.push(`Testing type: ${TESTS[testKey].label}.`); tests.push(`Purpose: ${descriptions[testKey]||'Checks the uploaded source for the selected testing purpose.'}`);
  tests.push(`Scanned ${files.length} uploaded source file(s).`);
  findings.push(`Source intake completed across ${Object.entries(extCounts).map(([k,v])=>`${v} .${k}`).join(', ')}.`);
  const funcs=(text.match(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g)||[]).length+(text.match(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)||[]).length;
  const branches=(text.match(/\bif\s*\(/g)||[]).length+(text.match(/\belse\b/g)||[]).length+(text.match(/\bswitch\s*\(/g)||[]).length+(text.match(/\bcase\s+/g)||[]).length;
  const loops=(text.match(/\b(?:for|while|do)\b/g)||[]).length;
  const returns=(text.match(/\breturn\b/g)||[]).length;
  const consoleCount=(text.match(/\bconsole\.(log|warn|error|debug|info)\s*\(/g)||[]).length;
  const evals=(text.match(/\beval\s*\(/g)||[]).length;
  const todos=(text.match(/\b(?:TODO|FIXME|HACK)\b/gi)||[]).length;
  findings.push(`Detected approximately ${funcs} function/arrow-function declaration(s), ${branches} branch marker(s), ${loops} loop keyword(s), and ${returns} return statement(s).`);
  tests.push(`Structural scan completed for functions, branches, loops, returns and common risk markers.`);
  if(consoleCount)warnings.push(`${consoleCount} console statement(s) found; review production logging.`);
  if(evals)warnings.push(`${evals} eval() usage detected; review for security and maintainability risk.`);
  if(todos)warnings.push(`${todos} TODO/FIXME/HACK marker(s) detected; review unfinished work.`);
  if(/catch\s*\{\s*\}/.test(text))warnings.push("Empty catch block detected; errors may be swallowed silently.");
  if(/password/i.test(text)&&/autocomplete\s*=\s*["']off["']/i.test(text))warnings.push("Password-related field uses autocomplete=off; review credential UX and browser autofill behaviour.");
  if(!funcs && /\.(js|ts|jsx|tsx)$/i.test(files[0]?.name||""))warnings.push("No function declaration was detected in the sampled JavaScript/TypeScript source.");
  if(testKey==='whitebox'){
    tests.push(`White-box focus: internal branches, loops and return structure were inspected.`);
    if(branches) findings.push(`Internal decision structure is visible through ${branches} branch marker(s).`); else warnings.push('No clear conditional branch was detected; review whether important decision logic is missing.');
  }
  if(testKey==='function'){
    tests.push('Function focus: declarations, arrow functions and return behaviour were inspected.');
    if(funcs) findings.push(`${funcs} function/arrow-function declaration(s) were identified for review.`); else warnings.push('No function declaration was detected in the uploaded source.');
    if(funcs && !returns) warnings.push('Functions were found but no return statement was detected in the sampled source; verify intended outputs.');
  }
  if(testKey==='path'){
    tests.push('Path focus: if/else, switch/case and loop markers were inspected as possible execution paths.');
    if(branches>0) findings.push(`${branches} decision marker(s) provide identifiable paths for review.`); else warnings.push('No decision path marker was detected in the uploaded source.');
  }
  if(testKey==='execution'){
    tests.push('Execution focus: console statements, risky patterns and error-handling signals were inspected.');
    findings.push(`Execution-readiness scan completed; ${consoleCount} console statement(s) and ${returns} return statement(s) were detected.`);
    if(!consoleCount) warnings.push('No console output was detected; runtime output should be verified with the actual execution worker for a complete execution test.');
  }
  if(testKey==='evidence') findings.push('Source-level evidence summary is attached to this test session.');
  if(testKey==='report') findings.push('The selected source was converted into a structured report with checks, positive findings and review items.');
  const status=warnings.length?"warning":"passed";
  let focus=`${TESTS[testKey].label} focus was applied to the source scan.`;
  tests.push(focus);
  const fileDetails=[];
  for(const f of files.slice(0,80)){
    const t=await readText(f);
    const count=(re)=>((t.match(re)||[]).length);
    fileDetails.push({file:f.webkitRelativePath||f.name,type:(f.name.split('.').pop()||'unknown').toLowerCase(),lines:t?t.split(/\r?\n/).length:0,functions:count(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g)+count(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g),branches:count(/\bif\s*\(/g)+count(/\belse\b/g)+count(/\bswitch\s*\(/g)+count(/\bcase\s+/g),loops:count(/\b(?:for|while|do)\b/g),issues:[...Array(count(/\beval\s*\(/g)).fill('eval() usage'),...Array(count(/\b(?:TODO|FIXME|HACK)\b/gi)).fill('unfinished-work marker')]});
  }
  const report={title:`${TESTS[testKey].label} — Code Report`,description:descriptions[testKey]||`TestFlow checks the uploaded code for ${TESTS[testKey].label.toLowerCase()}.`,testTypeLabel:TESTS[testKey].label,status,tests,findings,warnings,fileDetails,metrics:{files:files.length,functions:funcs,branches,loops,returns}}; Object.assign(report,reportExpectation(testKey,'code',report)); return report;
}
async function analyzeApplication(files,entry,testKey){
  const html=await readText(entry);let css="",js="";
  for(const f of files.filter(f=>/\.css$/i.test(f.name)).slice(0,20))css+=await readText(f)+"\n";
  for(const f of files.filter(f=>/\.(js|mjs)$/i.test(f.name)).slice(0,20))js+=await readText(f)+"\n";
  const findings=[],warnings=[],tests=[];
  const descriptions={functional:'Checks whether the uploaded application contains basic controls, forms and interaction signals expected for a working feature.',ui:'Reviews visible controls, labels, images, navigation and common usability/accessibility signals.',responsive:'Checks viewport metadata and responsive CSS signals supporting desktop, tablet and mobile layouts.',regression:'Creates a saved baseline from this run so future runs can be compared through TestFlow history.',compatibility:'Reviews application structure and responsive signals relevant to browser and screen compatibility.',performance:'Checks performance-related structure and records this run so timing evidence can be attached to the result.'};
  tests.push(`Testing type: ${TESTS[testKey].label}.`); tests.push(`Purpose: ${descriptions[testKey]||'Checks the uploaded application for the selected testing purpose.'}`);
  tests.push(`Application entry page: ${entry.webkitRelativePath||entry.name}.`);
  const buttons=(html.match(/<button\b/gi)||[]).length,inputs=(html.match(/<input\b/gi)||[]).length,forms=(html.match(/<form\b/gi)||[]).length,links=(html.match(/<a\b/gi)||[]).length,images=(html.match(/<img\b/gi)||[]).length;
  const viewport=/name=["']viewport["']/i.test(html),media=(css.match(/@media\b/gi)||[]).length,required=(html.match(/\brequired\b/gi)||[]).length;
  const badAlt=(html.match(/<img(?![^>]*\balt\s*=)[^>]*>/gi)||[]).length;
  const emptyLinks=(html.match(/<a[^>]+href=["'](?:#|javascript:)["'][^>]*>/gi)||[]).length;
  const ids=[...(html.matchAll(/\bid=["']([^"']+)["']/gi))].map(m=>m[1]);const dup=[...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))];
  findings.push(`Entry page loaded for analysis with ${buttons} button(s), ${inputs} input(s), ${forms} form(s), ${links} link(s) and ${images} image(s).`);
  if(viewport)findings.push("Responsive viewport metadata is present.");else warnings.push("Viewport meta tag is missing; mobile behaviour should be reviewed.");
  if(media)findings.push(`${media} responsive CSS media-query block(s) detected.`);else warnings.push("No CSS media-query block was detected.");
  if(forms&&required)findings.push(`${required} required form-control marker(s) detected.`);else if(forms)warnings.push("Form detected but no required attribute was found in the scanned entry page.");
  if(images&&badAlt)warnings.push(`${badAlt} image element(s) appear to be missing alt text.`);else if(images)findings.push("Image accessibility check found alt attributes on the scanned images.");
  if(emptyLinks)warnings.push(`${emptyLinks} placeholder navigation link(s) detected.`);
  if(dup.length)warnings.push(`Duplicate id value(s) detected: ${dup.slice(0,8).join(', ')}.`);
  if(/<input[^>]+type=["']password["']/i.test(html)&&!/(current-password|new-password)/i.test(html))warnings.push("Password field has no clear autocomplete hint.");
  if(/onclick\s*=|addEventListener\s*\(/i.test(html+js))findings.push("Interactive JavaScript behaviour is present in the uploaded project.");
  if(testKey==='functional'){
    tests.push('Functional focus: forms, controls, validation signals, links and interaction hooks were inspected.');
    if(forms && (required || /addEventListener\s*\(\s*['"]submit/i.test(js))) findings.push('The uploaded application contains form validation/submit-related signals.');
    else if(forms) warnings.push('A form exists, but strong validation/submit handling signals were not detected in the scanned source.');
    if(buttons) findings.push(`${buttons} button(s) are present as user interaction points.`); else warnings.push('No button element was detected on the selected page.');
  }
  if(testKey==='ui'){
    tests.push('UI focus: controls, labels, images, navigation and accessibility-related markup were inspected.');
    const labels=(html.match(/<label\b/gi)||[]).length;
    if(inputs && labels>=inputs) findings.push('Form inputs have matching label markup at the page level.');
    else if(inputs) warnings.push(`${inputs} input(s) were found; review visible labels for clarity and accessibility.`);
  }
  if(testKey==='responsive'){
    tests.push('Responsive focus: viewport metadata and responsive CSS breakpoints were inspected.');
    if(viewport && media) findings.push('The page has both viewport metadata and responsive CSS rules.');
  }
  if(testKey==='regression'){
    tests.push('Regression focus: this completed run is stored as a baseline candidate in history.');
    findings.push('A saved session/report was created so a later run can be compared against this result.');
  }
  if(testKey==='compatibility'){
    tests.push('Compatibility focus: HTML structure, viewport support and responsive CSS signals were inspected.');
    if(viewport && media) findings.push('The selected page contains common compatibility-friendly viewport and responsive signals.');
  }
  if(testKey==='performance'){
    tests.push('Performance focus: page structure, asset references and timing-ready evidence were inspected.');
    const scripts=(html.match(/<script\b/gi)||[]).length, styles=(html.match(/<link\b|<style\b/gi)||[]).length;
    findings.push(`Timing-ready scan found ${scripts} script tag(s) and ${styles} stylesheet/style tag(s).`);
    if(scripts>8) warnings.push('Many script/style references were found on the selected page; review load cost with runtime performance tooling.');
  }
  if(testKey==='evidence') findings.push('Application structure, selected HTML entry page and scan findings are included as evidence for this session.');
  if(testKey==='report') findings.push('The application scan has been formatted into a formal report for this session.');
  tests.push(`Checked controls, forms, navigation, accessibility signals, responsive metadata and visible structure.`);
  tests.push(`Selected focus: ${TESTS[testKey].label}.`);
  if(/\.php$/i.test(entry.name))warnings.push("PHP entry page selected; this browser preview does not execute server-side PHP/MySQL logic.");
  const fileDetails=files.slice(0,120).map(f=>({file:f.webkitRelativePath||f.name,type:(f.name.split('.').pop()||'unknown').toLowerCase(),role:/\.html?$/i.test(f.name)?'HTML page':/\.css$/i.test(f.name)?'Stylesheet':/\.(js|mjs)$/i.test(f.name)?'JavaScript':'Project asset'}));
  const report={title:`${TESTS[testKey].label} — Application Report`,description:descriptions[testKey]||`TestFlow checks the uploaded application for ${TESTS[testKey].label.toLowerCase()}.`,testTypeLabel:TESTS[testKey].label,status:warnings.length?"warning":"passed",tests,findings,warnings,fileDetails,metrics:{files:files.length,buttons,inputs,forms,links,images,media}}; Object.assign(report,reportExpectation(testKey,'application',report)); return report;
}

function terminalWrite(id,lines){$(id).textContent=lines.join("\n")}
function reportCard(r){
  return `<article class="report-card"><div class="report-card-head"><div><span class="report-kicker">TEST REPORT</span><h4>${escapeHtml(r.title)}</h4></div><span class="status-badge ${r.status}">${escapeHtml(r.status)}</span></div><div class="report-description"><b>What this test means</b><p>${escapeHtml(r.description||'This report explains what TestFlow checked, what was found and what should be reviewed.')}</p></div><div class="report-columns"><div><b>Checks performed</b><ul class="report-list neutral">${reportList(r.tests,'•')}</ul></div><div><b>What is okay</b><ul class="report-list good">${reportList(r.findings,'✓')}</ul></div><div><b>Needs review</b><ul class="report-list warn-list">${reportList(r.warnings,'!')}</ul></div></div></article>`;
}
function formalReportHtml(report,sessionId){
  const files=report.fileDetails||[];
  return `<div class="formal-report"><div class="formal-cover"><div class="eyebrow">TESTFLOW FORMAL REPORT</div><h2>${escapeHtml(report.title)}</h2><p>${escapeHtml(report.description||'')}</p><div class="formal-meta"><span><b>Subject</b>${escapeHtml(report.subject||'Testing')}</span><span><b>Testing type</b>${escapeHtml(report.testTypeLabel||'Selected test')}</span><span><b>Project</b>${escapeHtml(report.projectName||report.project_name||'Uploaded project')}</span><span><b>Status</b>${escapeHtml(report.status)}</span></div></div><section><h3>1. Test overview</h3><p>${escapeHtml(report.description||'TestFlow analysed the supplied source using the selected testing type.')}</p></section><section><h3>2. Expected result</h3><p>${escapeHtml(report.expected||'The selected test should complete against the supplied source and produce traceable evidence.')}</p></section><section><h3>3. Actual result</h3><p>${escapeHtml(report.actual||'The available TestFlow checks completed and produced the findings shown below.')}</p></section><section><h3>4. Verdict</h3><p><b>${escapeHtml(report.verdict||report.status)}</b></p></section><section><h3>5. Checks performed</h3><ul class="formal-list">${reportList(report.tests,'•')}</ul></section><section><h3>6. What is okay</h3><ul class="report-list good">${reportList(report.findings,'✓')}</ul></section><section><h3>7. Improvements / findings</h3><ul class="report-list warn-list">${reportList(report.warnings,'!')}</ul></section><section><h3>8. Test result metrics</h3><div class="formal-metrics">${Object.entries(report.metrics||{}).map(([k,v])=>`<span><b>${escapeHtml(String(v))}</b>${escapeHtml(k.replace(/_/g,' '))}</span>`).join('')}</div></section><section><h3>9. Files included in this report</h3><ul class="formal-list">${files.length?files.map(f=>`<li>${escapeHtml(f.file)} — ${escapeHtml(f.role||f.type||'source')}${f.lines?` · ${escapeHtml(String(f.lines))} lines`:''}${f.functions!==undefined?` · ${escapeHtml(String(f.functions))} functions · ${escapeHtml(String(f.branches))} branches · ${escapeHtml(String(f.loops))} loops`:''}${f.issues?.length?` · Review: ${escapeHtml(f.issues.join(', '))}`:''}</li>`).join(''):'<li>No file-level details available.</li>'}</ul></section><section><h3>10. Scope note</h3><p>Code Testing and Application Testing are separate subjects in TestFlow. A Code report is generated from uploaded source files; an Application report is generated from an uploaded application ZIP and selected HTML entry page. Server-side PHP/MySQL behaviour is not executed in the browser preview.</p></section><div class="formal-session">Session ID: ${escapeHtml(sessionId||'')}</div></div>`;
}
function showFormalReport(report,sessionId){
  const body=`${formalReportHtml(report,sessionId)}<div class="formal-actions"><button class="primary" id="formalDownload">Download formal report</button><button class="secondary" id="formalClose">Close</button></div>`;
  $('#reportModalBody').innerHTML=body;openModal('#reportModal');
  $('#formalDownload').onclick=()=>downloadFormalReport(report,sessionId);$('#formalClose').onclick=()=>closeModal($('#reportModal'));
}
function renderFocusedResult(result,sessionId,kind){
  currentTestReport={...result,kind,sessionId};reviewSubmitted=false;window.__reportWasDownloaded=false;
  $('#testResultPanel').hidden=false;
  $('#testResultPanel').innerHTML=`<div class="result-head"><div><div class="eyebrow">${escapeHtml(kind==='code'?'CODE TESTING REPORT':'APPLICATION TESTING REPORT')}</div><h3>${escapeHtml(result.title)}</h3><p class="result-sub">${escapeHtml(result.description||'Selected testing type completed. This is a separate subject report.')}</p></div><span class="status-badge ${result.status}">${escapeHtml(result.status)}</span></div><div class="result-grid"><div><b>${result.metrics.files}</b><small>files scanned</small></div><div><b>${result.findings.length}</b><small>positive checks</small></div><div><b>${result.warnings.length}</b><small>review items</small></div><div><b>✓</b><small>test completed</small></div></div><div class="finding-columns"><div><h4>Expected result</h4><p>${escapeHtml(result.expected||'The selected test should complete against the supplied source.')}</p></div><div><h4>Actual result</h4><p>${escapeHtml(result.actual||'The available checks completed and produced the findings below.')}</p></div></div><div class="single-report-grid">${reportCard(result)}</div><div class="result-actions"><button class="secondary" id="viewReportBtn">View formal ${kind==='code'?'Code':'Application'} report</button><button class="secondary" id="downloadReportBtn">Download ${kind==='code'?'Code':'Application'} report</button></div><small>Separate ${escapeHtml(kind==='code'?'Code Testing':'Application Testing')} report · Session ID: ${escapeHtml(sessionId)}</small>`;
  $('#viewReportBtn').onclick=()=>showFormalReport(currentTestReport,sessionId);
  $('#downloadReportBtn').onclick=()=>showFormalReport(currentTestReport,sessionId);
}
function downloadFormalReport(report,sessionId){
  const safe=(v)=>escapeHtml(v);
  const list=(items,cls)=>`<ul class="${cls||''}">${(items?.length?items:['No issue detected by the current checks.']).map(x=>`<li>${safe(x)}</li>`).join('')}</ul>`;
  const files=report.fileDetails||[];
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${safe(report.title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;background:#f3f4ef;color:#253129;margin:0;padding:40px}.report{max-width:900px;margin:auto;background:#fff;padding:44px;border:1px solid #d9ddd5}h1{font-size:30px;margin:8px 0 12px}h2{font-size:17px;border-bottom:1px solid #e1e4de;padding-bottom:8px;margin-top:30px}.eyebrow{font-size:11px;letter-spacing:2px;font-weight:700;color:#668b73}.intro{color:#647068;line-height:1.6}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.meta div{background:#f0f2ed;padding:12px;border-radius:7px;font-size:11px}.meta b{display:block;text-transform:uppercase;margin-bottom:5px}.ok li{color:#4f7259;margin:7px 0}.warn li{color:#896d3e;margin:7px 0}.neutral li{color:#5e6862;margin:7px 0}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.metrics div{background:#f0f2ed;padding:12px;text-align:center;border-radius:7px;font-size:10px}.metrics b{display:block;font-size:19px}.box{background:#f6f7f2;padding:14px;border-radius:8px;line-height:1.6}.footer{margin-top:30px;padding-top:15px;border-top:1px solid #ddd;color:#7b857e;font-size:10px}@media(max-width:700px){body{padding:12px}.report{padding:22px}.meta,.metrics{grid-template-columns:1fr 1fr}}</style></head><body><main class="report"><div class="eyebrow">TESTFLOW — FORMAL ${safe((report.subject||'TEST').toUpperCase())} REPORT</div><h1>${safe(report.title)}</h1><p class="intro">${safe(report.description||'')}</p><div class="meta"><div><b>Subject</b>${safe(report.subject||'Testing')}</div><div><b>Testing type</b>${safe(report.testTypeLabel||'Selected test')}</div><div><b>Project</b>${safe(report.projectName||report.project_name||'Uploaded project')}</div><div><b>Status</b>${safe(report.status)}</div></div><h2>1. Test overview</h2><p class="intro">${safe(report.description||'TestFlow analysed the supplied source using the selected testing type.')}</p><h2>2. Expected result</h2><div class="box">${safe(report.expected||'The selected test should complete against the supplied source.')}</div><h2>3. Actual result</h2><div class="box">${safe(report.actual||'The available checks completed and produced the findings below.')}</div><h2>4. Verdict</h2><div class="box"><b>${safe(report.verdict||report.status)}</b></div><h2>5. Checks performed</h2>${list(report.tests,'neutral')}<h2>6. What is okay</h2>${list(report.findings,'ok')}<h2>7. Improvements / findings</h2>${list(report.warnings,'warn')}<h2>8. Test result metrics</h2><div class="metrics">${Object.entries(report.metrics||{}).map(([k,v])=>`<div><b>${safe(String(v))}</b>${safe(k.replace(/_/g,' '))}</div>`).join('')}</div><h2>9. Files included in this report</h2><ul class="neutral">${files.length?files.map(f=>`<li>${safe(f.file)} — ${safe(f.role||f.type||'source')}${f.lines?` · ${safe(String(f.lines))} lines`:''}${f.functions!==undefined?` · ${safe(String(f.functions))} functions · ${safe(String(f.branches))} branches · ${safe(String(f.loops))} loops`:''}${f.issues?.length?` · Review: ${safe(f.issues.join(', '))}`:''}</li>`).join(''):'<li>No file-level details available.</li>'}</ul><h2>10. Scope note</h2><p class="intro">Code Testing and Application Testing are separate subjects. Code reports use uploaded source files; Application reports use the uploaded application ZIP and selected HTML entry page. Server-side PHP/MySQL behaviour is not executed in the browser preview.</p><div class="footer">Generated by TestFlow · ${safe(new Date().toLocaleString())} · Session ${safe(sessionId||'')}</div></main></body></html>`;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`testflow-${(report.subject||'report').toLowerCase().replace(/\s+/g,'-')}-${Date.now()}.html`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  window.__reportWasDownloaded=true;closeModal($('#reportModal'));$('#reviewTarget').textContent=report.title;$('#reviewStatus').textContent='Report downloaded. Rating and suggestions are now required for this report.';$('#review').scrollIntoView({behavior:'smooth',block:'start'});toast('Formal report downloaded. Please rate this report.');
}

async function saveTestRunReliable({projectName,testType,status,started,completed,result,kind,key}){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    const {data,error}=await supabaseClient.rpc('save_test_run',{
      p_project_name:projectName,
      p_test_type:testType,
      p_status:status,
      p_started_at:started.toISOString(),
      p_completed_at:completed.toISOString(),
      p_result:result,
      p_report_kind:kind,
      p_test_key:key
    });
    if(!error && data?.session_id) return data;
    lastError=error||new Error('History save returned no session id');
    await new Promise(r=>setTimeout(r,300*attempt));
  }
  throw lastError;
}

async function runSelectedTest(){
  if(!currentUser){switchAuthMode('login');openModal('#authModal');return;}
  if(currentTestReport && window.__reportWasDownloaded && !reviewSubmitted){toast('Please rate the downloaded report before starting another test.');$('#review').scrollIntoView({behavior:'smooth',block:'start'});return;}
  const key=$("#testType").value;
  if(!canUse(key)){toast(`This test requires ${requiredPlan(key).toUpperCase()} access.`);return;}
  if(testNeedsCode(key)&&!codeFiles.length){toast('Upload your code in the left Code Testing panel first.');return;}
  if(testNeedsApp(key)&&(!appFiles.length||!appEntryFile)){toast('Upload an application ZIP and select its HTML file first.');return;}
  if((key==='evidence'||key==='report')&&!sourceReady(key)){toast('Upload code or an application ZIP first.');return;}
  const btn=$("#runTestBtn"), started=new Date();btn.disabled=true;
  $("#workspaceStatus").textContent=`Running ${TESTS[key].label}…`;
  terminalWrite('#codeTerminal',[`[START] ${TESTS[key].label}`,`[TIME] ${started.toLocaleTimeString()}`,testNeedsCode(key)?'[INPUT] Code upload selected.':'[INPUT] Code panel not required for this test.','[WAIT] Analyzing…']);
  terminalWrite('#appTerminal',[`[START] ${TESTS[key].label}`,testNeedsApp(key)?`[INPUT] ${appEntryFile?.webkitRelativePath||'Application HTML'} selected.`:'[INPUT] Application panel not required for this test.','[WAIT] Running application checks…']);
  try{
    let result,kind;
    if(testNeedsCode(key)){result=await analyzeCode(codeFiles,key);kind='code';terminalWrite('#codeTerminal',[`[START] ${TESTS[key].label}`,`[FILES] ${codeFiles.length} source file(s)`,...result.tests.map(x=>`[CHECK] ${x}`),`[PASS] Test completed with ${result.findings.length} positive check(s).`,`[REVIEW] ${result.warnings.length} item(s) need review.`,`[DONE] Code Testing Report is ready.`]);}
    else if(testNeedsApp(key)){result=await analyzeApplication(appFiles,appEntryFile,key);kind='application';terminalWrite('#appTerminal',[`[START] ${TESTS[key].label}`,`[PAGE] ${appEntryFile.webkitRelativePath||appEntryFile.name}`,...result.tests.map(x=>`[CHECK] ${x}`),`[PASS] Test completed with ${result.findings.length} positive check(s).`,`[REVIEW] ${result.warnings.length} item(s) need review.`,`[DONE] Application Testing Report is ready.`]);}
    else if(codeFiles.length){result=await analyzeCode(codeFiles,key);kind='code';}
    else{result=await analyzeApplication(appFiles,appEntryFile,key);kind='application';}
    const status=result.status;
    const completed=new Date();
    let sessionId='local-result';
    try{
      const savedRun=await saveTestRunReliable({
        projectName:kind==='code'?(codeFiles[0]?.name||'Code source'):appZipName,
        testType:`${kind==='code'?'Code Testing':'Application Testing'} · ${TESTS[key].label}`,
        status,started,completed,result,kind,key
      });
      sessionId=savedRun.session_id;
      lastReportId=savedRun.report_id||null;
      terminalWrite(kind==='code'?'#codeTerminal':'#appTerminal',[...(kind==='code'?(document.querySelector('#codeTerminal')?.textContent||''):(document.querySelector('#appTerminal')?.textContent||'')).split('\n'),`[HISTORY] Saved session ${sessionId}`,`[HISTORY] Report ${savedRun.report_id?'saved':'session saved; report attachment unavailable'}`,`[DONE] Test and history save completed.`]);
    }catch(saveError){
      console.error('History save failed after retries:',saveError);
      terminalWrite(kind==='code'?'#codeTerminal':'#appTerminal',[`[HISTORY ERROR] ${saveError?.message||'unknown database error'}`,`[HISTORY] The test result was not marked as saved. Fix Supabase SQL/config and run again.`]);
      throw new Error(`Test completed, but history could not be saved: ${saveError?.message||'unknown database error'}`);
    }
    if(kind==='code')terminalWrite('#appTerminal',[`[INFO] ${TESTS[key].label} is a Code Testing type.`,`[READY] Application panel is available for the next application test.`]);
    if(kind==='application')terminalWrite('#codeTerminal',[`[INFO] ${TESTS[key].label} is an Application Testing type.`,`[READY] Code panel is available for the next code test.`]);
    renderFocusedResult({...result,created_at:completed.toISOString()},sessionId,kind);
    if(sessionId!=='local-result') await loadHistory();
    $("#workspaceStatus").textContent=`${TESTS[key].label} completed. Report ready — review is required before download.`;
    toast(`${TESTS[key].label} completed.`);
    $("#testResultPanel").scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){
    console.error(err);terminalWrite('#codeTerminal',[`[ERROR] ${err.message||'Code terminal error'}`]);terminalWrite('#appTerminal',[`[ERROR] ${err.message||'Application terminal error'}`]);$("#workspaceStatus").textContent=`Test failed: ${err.message||'Unknown error'}`;toast(err.message||'Test could not be completed.');
  }finally{btn.disabled=false;updateSelectedTestUI();}
}
$("#runTestBtn").onclick=runSelectedTest;

function reportList(items, marker){return (items&&items.length?items:["No issue detected by the current checks."]).map(x=>`<li><span>${marker}</span>${escapeHtml(x)}</li>`).join('')}


async function getPaymentSettings(){
  const {data,error}=await supabaseClient.from('payment_settings').select('id,admin_email,upi_id,qr_url,premium_amount,pro_amount').eq('id',1).maybeSingle();
  if(error){console.warn('Payment settings load error',error.message);return {id:1,admin_email:'',upi_id:'',qr_url:'',premium_amount:499,pro_amount:999}}
  return data||{id:1,admin_email:'',upi_id:'',qr_url:'',premium_amount:499,pro_amount:999};
}
async function getMyLatestPlanRequest(){
  if(!currentUser)return null;
  let {data,error}=await supabaseClient.from('plan_requests').select('id,requested_plan,requester_email,status,payment_reference,payment_note,payment_proof_path,payment_proof_name,submitted_at,accepted_at,payment_submitted_at,activated_at,rejected_at').eq('user_id',currentUser.id).order('submitted_at',{ascending:false}).limit(1);
  if(error && /payment_proof_(path|name).*does not exist/i.test(error.message||'')){
    const fallback=await supabaseClient.from('plan_requests').select('id,requested_plan,requester_email,status,payment_reference,payment_note,submitted_at,accepted_at,payment_submitted_at,activated_at,rejected_at').eq('user_id',currentUser.id).order('submitted_at',{ascending:false}).limit(1);
    data=fallback.data;
  }
  return data?.[0]||null;
}
function openRequest(plan){
  if(!currentUser){switchAuthMode('login');openModal('#authModal');toast('Log in before requesting a paid plan.');return}
  if(isAdmin()){toast('Admin already has all Free, Premium and Pro access.');return}
  if((currentProfile?.plan||'free')===plan){toast(`Your ${plan.toUpperCase()} plan is already active.`);return}
  $('#requestedPlan').value=plan;$('#requestTitle').textContent=`Request ${plan[0].toUpperCase()+plan.slice(1)}`;$('#requestEmailPreview').textContent=currentUser.email;$('#requestStatus').textContent='';openModal('#requestModal');
}
async function renderUpgradeBox(){
  if(isAdmin()){
    $('#upgradeBox').innerHTML='<div class="admin-access-box"><b>Admin access is active.</b><small>All Free, Premium and Pro capabilities are unlocked. No payment is required.</small></div><button class="secondary full" id="adminOpen">▤ Admin controls</button>';
    setTimeout(()=>$('#adminOpen').onclick=()=>{closeModal($('#accountModal'));openModal('#adminModal');loadAdminRequests();loadAdminStats()},0);return;
  }
  const req=await getMyLatestPlanRequest();const active=currentProfile?.plan||'free';const settings=await getPaymentSettings();
  const premiumAmount=settings?.premium_amount??499;const proAmount=settings?.pro_amount??999;
  let html=`<div class="account-plan-card"><b>Active plan: ${escapeHtml(active.toUpperCase())}</b><small>Premium ₹${escapeHtml(premiumAmount)}/month · Pro ₹${escapeHtml(proAmount)}/month</small></div>`;
  if(req && ['pending','awaiting_payment','payment_submitted'].includes(req.status)){
    const label=req.status==='pending'?'Waiting for admin acceptance':req.status==='awaiting_payment'?'Payment step is open':'Payment submitted — waiting for verification';
    html+=`<div class="request-status-card"><b>${escapeHtml(req.requested_plan.toUpperCase())} request</b><small>${label}</small>`;
    if(req.status==='awaiting_payment'){
      const amount=req.requested_plan==='premium'?premiumAmount:proAmount;
      html+=`<div class="payment-destination"><div class="payment-amount"><span>Amount to pay</span><strong>₹${escapeHtml(amount)}</strong></div><div class="payment-destination-grid"><div><b>Pay to UPI</b><strong>${escapeHtml(settings?.upi_id||'Admin payment UPI not configured yet')}</strong><small>${escapeHtml(settings?.admin_email||'')}</small></div>${settings?.qr_url?`<div class="payment-qr"><b>Scan QR</b><img src="${escapeHtml(settings.qr_url)}" alt="TestFlow admin payment QR"></div>`:'<div class="payment-qr payment-qr-empty"><b>QR not configured</b><small>Admin can add the payment QR in Admin controls.</small></div>'}</div><ol class="payment-steps"><li>Pay exactly the amount shown above to the TestFlow admin UPI.</li><li>After payment, enter the UTR / Transaction ID below.</li><li>Upload the payment screenshot as proof.</li></ol></div><form id="paymentForm" class="inline-form"><label>UTR / Transaction ID<input id="userPaymentReference" required placeholder="Enter UTR or transaction ID"></label><label>Payment screenshot<input id="userPaymentProof" type="file" accept="image/png,image/jpeg,image/webp" required></label><label>Payment note<textarea id="userPaymentNote" placeholder="Optional note"></textarea></label><button class="primary full" id="submitPaymentBtn">Submit payment proof</button></form>`;
    }
    html+='</div>';
  }else if(req?.status==='approved') html+=`<div class="request-status-card"><b>${escapeHtml(req.requested_plan.toUpperCase())} is active.</b><small>Your plan has been activated by the admin.</small></div>`;
  else if(req?.status==='rejected') html+=`<div class="request-status-card"><b>Last request was rejected.</b><small>You can submit a new request when needed.</small></div>`;
  const canRequest=active!=='pro' && (!req || ['approved','rejected'].includes(req.status));
  if(canRequest) html+=`<button class="secondary full" id="accountUpgrade">Request Premium / Pro</button>`;$('#upgradeBox').innerHTML=html;
  setTimeout(()=>{$('#accountUpgrade')?.addEventListener('click',()=>{closeModal($('#accountModal'));openRequest(active==='premium'?'pro':'premium')});$('#paymentForm')?.addEventListener('submit',submitPaymentDetails)},0);
}
$('#accountBtn').onclick=async()=>{$('#accountInfo').innerHTML=accountHtml();await renderUpgradeBox();openModal('#accountModal');};
$$('.plan-btn').forEach(btn=>btn.onclick=()=>{const plan=btn.dataset.plan;if(plan==='free'){if(currentUser)toast('Your Free access is already active.');else{switchAuthMode('signup');openModal('#authModal')}}else openRequest(plan)});
$('#requestForm').onsubmit=async(e)=>{e.preventDefault();const plan=$('#requestedPlan').value;const {error}=await supabaseClient.from('plan_requests').insert({user_id:currentUser.id,requested_plan:plan,requester_email:currentUser.email,status:'pending'});$('#requestStatus').textContent=error?error.message:'Request sent. The admin will review it first. Payment details are requested only after admin acceptance.';if(!error)toast('Plan request sent to admin.');};
async function submitPaymentDetails(e){
  e.preventDefault();
  const req=await getMyLatestPlanRequest();
  if(!req||req.status!=='awaiting_payment'){toast('This request is not ready for payment submission.');return}
  const reference=$('#userPaymentReference').value.trim();const note=$('#userPaymentNote').value.trim();const file=$('#userPaymentProof')?.files?.[0];
  if(!reference||!file){toast('UTR and payment screenshot are required.');return}
  if(file.size>5*1024*1024){toast('Payment screenshot must be 5 MB or smaller.');return}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('Upload a PNG, JPG or WEBP payment screenshot.');return}
  const btn=$('#submitPaymentBtn');if(btn)btn.disabled=true;
  try{
    const path=`${currentUser.id}/${req.id}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const upload=await supabaseClient.storage.from('payment-proofs').upload(path,file,{contentType:file.type,upsert:false});
    if(upload.error)throw upload.error;
    let {error}=await supabaseClient.from('plan_requests').update({payment_reference:reference,payment_note:note,payment_proof_path:path,payment_proof_name:file.name,payment_submitted_at:new Date().toISOString(),status:'payment_submitted'}).eq('id',req.id).eq('user_id',currentUser.id).eq('status','awaiting_payment');
    if(error && /payment_proof_(path|name).*does not exist/i.test(error.message||'')){
      const legacyNote=(note?note+' | ':'')+'Payment proof path: '+path;
      const fallback=await supabaseClient.from('plan_requests').update({payment_reference:reference,payment_note:legacyNote,payment_submitted_at:new Date().toISOString(),status:'payment_submitted'}).eq('id',req.id).eq('user_id',currentUser.id).eq('status','awaiting_payment');
      error=fallback.error;
    }
    if(error){await supabaseClient.storage.from('payment-proofs').remove([path]);throw error}
    toast('Payment proof submitted. Admin verification is pending.');await renderUpgradeBox();
  }catch(err){toast(err.message||'Payment proof could not be submitted.')}finally{if(btn)btn.disabled=false}
}
async function getPaymentProofUrl(path){
  if(!path)return '';
  const {data,error}=await supabaseClient.storage.from('payment-proofs').createSignedUrl(path,3600);
  if(error){console.warn('Payment proof URL error',error.message);return ''}
  return data?.signedUrl||'';
}
async function loadAdminRequests(){
  if(!isAdmin())return;
  let {data,error}=await supabaseClient.from('plan_requests').select('id,user_id,requester_email,requested_plan,payment_reference,payment_note,payment_proof_path,payment_proof_name,status,submitted_at,accepted_at,payment_submitted_at,activated_at,rejected_at').order('submitted_at',{ascending:false});
  let proofColumnsAvailable=true;
  if(error && /payment_proof_(path|name).*does not exist/i.test(error.message||'')){
    proofColumnsAvailable=false;
    const fallback=await supabaseClient.from('plan_requests').select('id,user_id,requester_email,requested_plan,payment_reference,payment_note,status,submitted_at,accepted_at,payment_submitted_at,activated_at,rejected_at').order('submitted_at',{ascending:false});
    data=fallback.data;error=fallback.error;
  }
  if(error){$('#adminRequests').textContent=error.message;return}
  const rows=data||[];const settings=await getPaymentSettings();
  const renderRequest=async(r)=>{
    let action='';
    if(r.status==='pending') action=`<button class="primary" onclick="acceptPlanRequest('${r.id}')">Accept request</button><button class="secondary" onclick="rejectRequest('${r.id}')">Reject</button>`;
    if(r.status==='awaiting_payment') action=`<span class="request-wait">Waiting for user payment</span><button class="secondary" onclick="rejectRequest('${r.id}')">Reject</button>`;
    if(r.status==='payment_submitted') action=`<button class="primary" onclick="activatePlan('${r.id}','${r.user_id}','${r.requested_plan}')">Verify payment & activate</button><button class="secondary" onclick="rejectRequest('${r.id}')">Reject</button>`;
    const fmt=v=>v?new Date(v).toLocaleString():'—';const amount=r.requested_plan==='premium'?(settings.premium_amount??499):(settings.pro_amount??999);
    let proofPath=r.payment_proof_path||'';
    if(!proofPath && r.payment_note){const m=r.payment_note.match(/Payment proof path:\s*([^|]+)/i);if(m)proofPath=m[1].trim()}
    const proofUrl=proofPath?await getPaymentProofUrl(proofPath):'';
    const proof=proofUrl?`<a href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">View screenshot</a>`:(r.payment_proof_name||proofPath?'Proof uploaded — open after storage setup':'Not submitted yet');
    return `<div class="request-row"><strong>${r.requested_plan.toUpperCase()} · ${r.status.replaceAll('_',' ')}</strong><div class="request-details"><span><b>Email</b>${escapeHtml(r.requester_email||'—')}</span><span><b>Amount</b>₹${escapeHtml(amount)}</span><span><b>Requested</b>${fmt(r.submitted_at)}</span><span><b>Accepted</b>${fmt(r.accepted_at)}</span><span><b>Payment submitted</b>${fmt(r.payment_submitted_at)}</span><span><b>Plan active</b>${fmt(r.activated_at)}</span><span><b>Rejected</b>${fmt(r.rejected_at)}</span></div><div class="request-payment"><b>UTR / Transaction ID</b> ${escapeHtml(r.payment_reference||'Not submitted yet')}<br><b>Payment note</b> ${escapeHtml(r.payment_note||'—')}<br><b>Payment proof</b> ${proof}</div><div class="request-actions">${action}</div></div>`;
  };
  const premium=rows.filter(r=>r.requested_plan==='premium');const pro=rows.filter(r=>r.requested_plan==='pro');
  const renderedPremium=await Promise.all(premium.map(renderRequest));const renderedPro=await Promise.all(pro.map(renderRequest));
  $('#adminRequests').innerHTML=`<div class="admin-payment-settings"><div><b>Payment destination</b><small>These details are shown to users after their paid-plan request is accepted.</small></div><form id="adminPaymentSettingsForm" class="inline-form"><label>Admin UPI ID<input id="adminUpiId" required placeholder="example@upi" value="${escapeHtml(settings.upi_id||'')}"></label><label>Admin payment email<input id="adminPaymentEmail" type="email" placeholder="admin@example.com" value="${escapeHtml(settings.admin_email||'')}"></label><div class="admin-payment-grid"><label>Premium amount<input id="adminPremiumAmount" type="number" min="1" value="${escapeHtml(settings.premium_amount??499)}"></label><label>Pro amount<input id="adminProAmount" type="number" min="1" value="${escapeHtml(settings.pro_amount??999)}"></label></div><label>QR image URL<input id="adminQrUrl" type="url" placeholder="https://.../payment-qr.png" value="${escapeHtml(settings.qr_url||'')}"></label><button class="primary" type="submit">Save payment settings</button><small id="adminPaymentSettingsStatus"></small></form></div><section class="admin-request-section"><div class="admin-section-head"><h3>Premium requests</h3><span>${premium.length}</span></div>${renderedPremium.length?renderedPremium.join(''):'<div class="empty">No requests in this plan.</div>'}</section><section class="admin-request-section"><div class="admin-section-head"><h3>Pro requests</h3><span>${pro.length}</span></div>${renderedPro.length?renderedPro.join(''):'<div class="empty">No requests in this plan.</div>'}</section>`;
  $('#adminPaymentSettingsForm').onsubmit=async(e)=>{e.preventDefault();const payload={id:1,admin_email:$('#adminPaymentEmail').value.trim(),upi_id:$('#adminUpiId').value.trim(),qr_url:$('#adminQrUrl').value.trim(),premium_amount:Number($('#adminPremiumAmount').value),pro_amount:Number($('#adminProAmount').value),updated_at:new Date().toISOString()};const result=await supabaseClient.from('payment_settings').upsert(payload,{onConflict:'id'});$('#adminPaymentSettingsStatus').textContent=result.error?`Could not save settings: ${result.error.message}`:'Payment settings saved.';if(!result.error)toast('Payment settings saved.')};
}
window.acceptPlanRequest=async(id)=>{const now=new Date().toISOString();const {error}=await supabaseClient.from('plan_requests').update({status:'awaiting_payment',accepted_at:now,reviewed_by:currentUser.id,reviewed_at:now}).eq('id',id).eq('status','pending');if(error)toast(error.message);else{toast('Request accepted. User can now pay using the configured UPI/QR.');loadAdminRequests();loadAdminStats();}};
window.activatePlan=async(id,userId,plan)=>{const {error}=await supabaseClient.rpc('admin_activate_plan',{p_request_id:id});if(error){toast(error.message);return}toast(`${plan.toUpperCase()} plan activated.`);loadAdminRequests();loadAdminStats();};
window.rejectRequest=async(id)=>{const now=new Date().toISOString();const {error}=await supabaseClient.from('plan_requests').update({status:'rejected',rejected_at:now,reviewed_by:currentUser.id,reviewed_at:now}).eq('id',id).in('status',['pending','awaiting_payment','payment_submitted']);if(error)toast(error.message);else{toast('Request rejected.');loadAdminRequests();loadAdminStats();}};
async function loadAdminStats(){if(!isAdmin())return;const [{count:users},{count:sessions},{data:historyData,error:historyError},{count:pending}]=await Promise.all([supabaseClient.from('profiles').select('id',{count:'exact',head:true}),supabaseClient.from('test_sessions').select('id',{count:'exact',head:true}),supabaseClient.rpc('get_test_history'),supabaseClient.from('plan_requests').select('id',{count:'exact',head:true}).in('status',['pending','payment_submitted'])]);const rows=!historyError&&Array.isArray(historyData)?historyData:[];$('#adminStats').innerHTML=`<div><b>${users??0}</b><small>accounts</small></div><div><b>${sessions??0}</b><small>test sessions</small></div><div><b>${pending??0}</b><small>requests needing admin action</small></div>`;$('#adminUsageReports').innerHTML=historyError?`<div class="empty error-box">Could not load admin testing reports: ${escapeHtml(historyError.message)}</div>`:renderPeriodicReports(rows,true);}

$$('.stars button').forEach(btn=>btn.onclick=()=>{selectedRating=Number(btn.dataset.star);$$('.stars button').forEach(b=>{const active=Number(b.dataset.star)<=selectedRating;b.classList.toggle('active',active);b.textContent=active?'★':'☆'});});
$('#submitReview').onclick=async()=>{if(!currentUser){switchAuthMode('login');openModal('#authModal');return}if(!selectedRating){$('#reviewStatus').textContent='Choose a rating first.';return}if(!currentTestReport){$('#reviewStatus').textContent='Download a report first, then rate that report.';return}if(!window.__reportWasDownloaded){$('#reviewStatus').textContent='Download the report first. Rating is mandatory after download.';return}const payload={user_id:currentUser.id,report_id:lastReportId||null,rating:selectedRating,feedback:$('#reviewText').value.trim()};const {error}=await supabaseClient.from('reviews').insert(payload);if(error){$('#reviewStatus').textContent=error.message;return}reviewSubmitted=true;window.__reportWasDownloaded=false;selectedRating=0;$$('.stars button').forEach(b=>{b.classList.remove('active');b.textContent='☆'});$('#reviewText').value='';$('#reviewStatus').textContent='Review saved for this report. You can start another test.';toast('Thank you. Your report feedback was saved.');};

$("#resetForm").onsubmit=async(e)=>{
  e.preventDefault();
  const {error}=await supabaseClient.auth.updateUser({password:$("#newPassword").value});
  $("#resetStatus").textContent=error?error.message:"Password updated. You can log in with the new password.";
  if(!error)setTimeout(()=>{closeModal($("#resetModal"));history.replaceState({},document.title,location.pathname)},1200);
};

(async()=>{
  const params=new URLSearchParams(location.search);
  if(params.get("mode")==="reset"){await supabaseClient.auth.getSession();openModal("#resetModal");}
  await refreshAuth();
  updateWorkspaceAccess();
  updateTestOptions();
})();
