/* Scholarship Monitoring System
 * Supabase-backed browser application.
 * Only the public publishable key belongs here. NEVER put a service_role or sb_secret_ key in this file.
 */
const SUPABASE_URL = "https://lqdzurkkiuvrdgrgfrpv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Pk50WM4KENJhxz3wOkIf_A_tKsZ4KDc";
const ACADEMIC_YEAR = "2026-2027";
const SEMESTER = "1";
const DEADLINE = "2026-11-06T17:00:00+08:00";

const app = document.getElementById("app");
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("PASTE_");
const db = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = { session: null, profile: null, assignment: null, programs: [], scholars: [], submissions: [], history: [], page: "dashboard", selectedSubmission: null, message: "" };

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = value => value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }) : "—";
const num2 = value => Number(value ?? 0).toFixed(2);
const isStaff = () => state.profile?.role === "staff";
const setMessage = (message, type = "success") => { state.message = { text: message, type }; };
const messageHtml = () => state.message ? `<div class="notice ${state.message.type === "error" ? "error" : "success"}">${esc(state.message.text)}</div>` : "";

function showConfigError() {
  app.innerHTML = `<main class="login-page"><section class="login-brand"><div class="brand-mark">S</div><h1>Scholarship Monitoring<br>and Academic Compliance</h1></section><section class="login-panel"><div class="login-card"><h2>Connection not ready</h2><p class="muted">The Supabase library did not load or the URL/key at the top of app.js is missing. Check your internet connection and the two values at the top of app.js.</p></div></section></main>`;
}

function loginView() {
  app.innerHTML = `<main class="login-page"><section class="login-brand"><div class="brand-mark">S</div><h1>Scholarship Monitoring<br>and Academic Compliance</h1><p>Submit semester academic summaries, verify grade evidence, review policy compliance, and record scholarship renewal decisions.</p><p class="small">Academic Year ${ACADEMIC_YEAR}, Semester ${SEMESTER}</p></section><section class="login-panel"><form class="login-card" id="login-form"><h2>Welcome back</h2><p class="muted">Sign in using your registered account.</p>${messageHtml()}<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required placeholder="you@example.com"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password"></div><button class="btn full" type="submit">Sign in</button><p class="footer-note">Access is controlled by Supabase Authentication and database Row Level Security.</p></form></section></main>`;
  document.getElementById("login-form").addEventListener("submit", signIn);
}

async function signIn(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true; button.textContent = "Signing in…";
  const { data, error } = await db.auth.signInWithPassword({ email: form.get("email").trim(), password: form.get("password") });
  if (error) { setMessage(error.message, "error"); loginView(); return; }
  state.session = data.session;
  state.message = "";
  try { await loadUserContext(); } catch (e) { setMessage(e.message, "error"); loginView(); }
}

async function loadUserContext() {
  const user = state.session?.user;
  if (!user) return loginView();
  const { data: profile, error } = await db.from("profiles").select("id, role, student_id, full_name").eq("id", user.id).maybeSingle();
  if (error || !profile) {
    await db.auth.signOut();
    state.session = null;
    setMessage("Your account has no staff/scholar profile yet. Ask the Scholarship Staff to configure your profile.", "error");
    return loginView();
  }
  state.profile = profile;
  await loadData();
  state.page = "dashboard";
  render();
}

async function loadData() {
  const [programResult, assignmentResult, submissionResult] = await Promise.all([
    db.from("scholarship_programs").select("*").order("name"),
    isStaff()
      ? db.from("scholar_assignments").select("scholar_id, profile_id, program_id, full_name").order("scholar_id")
      : db.from("scholar_assignments").select("scholar_id, profile_id, program_id, full_name").eq("profile_id", state.session.user.id).maybeSingle(),
    isStaff()
      ? db.from("semester_submissions").select("*").order("submitted_at", { ascending: false })
      : db.from("semester_submissions").select("*").eq("scholar_id", state.profile.student_id || "").order("submitted_at", { ascending: false })
  ]);
  for (const result of [programResult, assignmentResult, submissionResult]) if (result.error) throw result.error;
  state.programs = programResult.data || [];
  state.scholars = isStaff() ? (assignmentResult.data || []) : [];
  state.assignment = isStaff() ? null : assignmentResult.data;
  state.submissions = submissionResult.data || [];
  if (!isStaff() && !state.assignment) throw new Error("Your scholar assignment is not set up. Contact Scholarship Staff.");
  const ids = state.submissions.map(row => row.id);
  if (ids.length) {
    const { data: history, error } = await db.from("decision_history").select("*").in("submission_id", ids).order("created_at", { ascending: false });
    if (error) throw error;
    state.history = history || [];
  } else state.history = [];
}

function programFor(scholarId) {
  const scholar = state.scholars.find(item => item.scholar_id === scholarId) || (state.assignment?.scholar_id === scholarId ? state.assignment : null);
  return state.programs.find(item => item.id === scholar?.program_id);
}
function scholarInfo(scholarId) {
  return state.scholars.find(item => item.scholar_id === scholarId) || (state.assignment?.scholar_id === scholarId ? state.assignment : null) || { scholar_id: scholarId, full_name: scholarId };
}

function evaluate(record) {
  if (record.verification_status !== "Verified") return { result: "Blocked", reasons: ["Missing or unverified evidence prevents final evaluation."] };
  const program = programFor(record.scholar_id);
  if (!program) return { result: "Blocked", reasons: ["No scholarship policy is assigned to this scholar."] };
  const reasons = [];
  if (Number(record.gwa) > Number(program.max_gwa)) reasons.push(`GWA ${num2(record.gwa)} exceeds the ${program.name} maximum of ${num2(program.max_gwa)}.`);
  if (Number(record.enrolled_units) < Number(program.min_units)) reasons.push(`Enrolled units ${record.enrolled_units} is below the required ${program.min_units}.`);
  if (Number(record.failed_count) > Number(program.failed_allowed)) reasons.push(`Failed subjects ${record.failed_count} exceeds the allowed ${program.failed_allowed}.`);
  if (Number(record.incomplete_count) > Number(program.incomplete_allowed)) reasons.push(`Incomplete grades ${record.incomplete_count} exceeds the allowed ${program.incomplete_allowed}.`);
  if (Number(record.dropped_count) > Number(program.dropped_allowed)) reasons.push(`Dropped subjects ${record.dropped_count} exceeds the allowed ${program.dropped_allowed}.`);
  if (new Date(record.submitted_at).getTime() > new Date(DEADLINE).getTime()) reasons.push("Submission was after the 2026-11-06 17:00 Asia/Manila deadline.");
  return { result: reasons.length ? "With Deficiency" : "Compliant", reasons };
}

function badge(value) {
  const cls = ({ Pending: "pending", Verified: "verified", Returned: "returned", Compliant: "compliant", "With Deficiency": "deficiency", Blocked: "blocked", Approved: "approved", Held: "held" })[value] || "blocked";
  return `<span class="badge ${cls}">${esc(value || "Not evaluated")}</span>`;
}
function pageHeader(title, description, action = "") { return `<div class="page-heading"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${action}</div>`; }

function shell(content) {
  const who = isStaff() ? "Scholarship Staff" : `${state.profile.full_name} (${state.profile.student_id})`;
  app.innerHTML = `<div class="shell"><header class="topbar"><h1>Scholarship Monitoring System</h1><div class="topbar-right"><span class="user-pill">${esc(who)}</span><button class="btn gold small-btn" id="logout">Log out</button></div></header><div class="layout"><aside class="sidebar"><div class="side-label">WORKSPACE</div><button class="nav-btn ${state.page === "dashboard" ? "active" : ""}" data-page="dashboard">Dashboard</button>${isStaff() ? `<button class="nav-btn ${state.page === "scholars" ? "active" : ""}" data-page="scholars">Scholar Management</button>` : `<button class="nav-btn ${state.page === "submit" ? "active" : ""}" data-page="submit">Submit Grades</button>`}</aside><main class="main">${messageHtml()}${content}<p class="footer-note">Official grades remain with the Registrar. This application records academic summaries and scholarship compliance only.</p></main></div></div>`;
  document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => { state.page = button.dataset.page; state.message = ""; render(); }));
  document.getElementById("logout").addEventListener("click", async () => {
    await db.auth.signOut();
    Object.assign(state, { session: null, profile: null, assignment: null, submissions: [], scholars: [], history: [], message: "" });
    loginView();
  });
}

function dashboardView() {
  const records = state.submissions;
  const pending = records.filter(r => r.verification_status === "Pending").length;
  const compliant = records.filter(r => evaluate(r).result === "Compliant").length;
  const deficient = records.filter(r => evaluate(r).result === "With Deficiency").length;
  const total = isStaff() ? state.scholars.length : 1;
  const rows = records.map(record => {
    const scholar = scholarInfo(record.scholar_id); const result = evaluate(record).result;
    return `<tr data-row data-search="${esc(`${scholar.scholar_id} ${scholar.full_name}`.toLowerCase())}" data-program="${esc(scholar.program_id || "")}" data-compliance="${esc(result)}"><td><b>${esc(scholar.scholar_id)}</b><br><span class="muted">${esc(scholar.full_name)}</span></td><td>${esc(programFor(record.scholar_id)?.name || "Unassigned")}</td><td>${num2(record.gwa)}</td><td>${badge(record.verification_status)}</td><td>${badge(result)}</td><td>${badge(record.renewal_decision)}</td>${isStaff() ? `<td><button class="btn secondary small-btn" data-review="${record.id}">Review</button></td>` : ""}</tr>`;
  }).join("");
  shell(`${pageHeader(`Academic Year ${ACADEMIC_YEAR}, Semester ${SEMESTER}`, isStaff() ? "Monitor submissions, verification, and academic compliance." : "View your submitted academic summary and its current status.")}
    <section class="stats"><div class="card stat"><strong>${total}</strong><small>Total assigned scholars</small></div><div class="card stat"><strong>${pending}</strong><small>Pending verification</small></div><div class="card stat"><strong>${compliant}</strong><small>Compliant</small></div><div class="card stat"><strong>${deficient}</strong><small>With deficiency</small></div></section>
    <section class="card"><h3 class="section-title">${isStaff() ? "Semester submissions" : "My submission"}</h3>${isStaff() ? `<div class="toolbar"><div><label for="search">Search scholar</label><input id="search" placeholder="Student ID or name"></div><div><label for="program-filter">Program</label><select id="program-filter"><option value="">All programs</option>${state.programs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></div><div><label for="compliance-filter">Compliance</label><select id="compliance-filter"><option value="">All statuses</option><option>Compliant</option><option>With Deficiency</option><option>Blocked</option></select></div></div>` : ""}${records.length ? `<div class="table-wrap"><table><thead><tr><th>Scholar</th><th>Program</th><th>GWA</th><th>Verification</th><th>Compliance</th><th>Renewal</th>${isStaff() ? "<th>Action</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">No semester submissions found yet.</div>`}</section>`);
  document.querySelectorAll("[data-review]").forEach(button => button.addEventListener("click", () => { state.selectedSubmission = button.dataset.review; state.page = "review"; state.message = ""; render(); }));
  ["search", "program-filter", "compliance-filter"].forEach(id => document.getElementById(id)?.addEventListener("input", filterRows));
}
function filterRows() {
  const q = (document.getElementById("search")?.value || "").toLowerCase();
  const p = document.getElementById("program-filter")?.value || "";
  const c = document.getElementById("compliance-filter")?.value || "";
  document.querySelectorAll("[data-row]").forEach(row => row.hidden = !(row.dataset.search.includes(q) && (!p || row.dataset.program === p) && (!c || row.dataset.compliance === c)));
}

function gradeFields(record = {}) {
  return `<div class="form-grid"><div class="field"><label>GWA (1.00–5.00)</label><input name="gwa" type="number" min="1" max="5" step="0.01" required value="${record.gwa ?? ""}"></div><div class="field"><label>Enrolled units</label><input name="units" type="number" min="0" step="1" required value="${record.enrolled_units ?? ""}"></div><div class="field"><label>Grade document reference</label><input name="evidence" maxlength="250" required value="${esc(record.evidence_reference || "")}" placeholder="e.g. Registrar document reference"></div><div class="field"><label>Failed subjects</label><input name="failed" type="number" min="0" step="1" required value="${record.failed_count ?? 0}"></div><div class="field"><label>Incomplete grades</label><input name="incomplete" type="number" min="0" step="1" required value="${record.incomplete_count ?? 0}"></div><div class="field"><label>Dropped subjects</label><input name="dropped" type="number" min="0" step="1" required value="${record.dropped_count ?? 0}"></div></div>`;
}
function validateGradeForm(form) {
  const f = new FormData(form);
  const gwa = Number(f.get("gwa")), units = Number(f.get("units")), failed = Number(f.get("failed")), incomplete = Number(f.get("incomplete")), dropped = Number(f.get("dropped"));
  const evidence = String(f.get("evidence") || "").trim();
  if (!Number.isFinite(gwa) || gwa < 1 || gwa > 5) throw Error("GWA must be from 1.00 through 5.00.");
  if (![units, failed, incomplete, dropped].every(n => Number.isInteger(n) && n >= 0)) throw Error("Units and counts must be nonnegative integers.");
  if (!evidence) throw Error("Grade document reference is required.");
  return { gwa, enrolled_units: units, failed_count: failed, incomplete_count: incomplete, dropped_count: dropped, evidence_reference: evidence, academic_year: ACADEMIC_YEAR, semester: SEMESTER };
}
async function submitGrades(event) {
  event.preventDefault();
  try {
    const values = validateGradeForm(event.currentTarget);
    const { error } = await db.from("semester_submissions").insert({ ...values, scholar_id: state.assignment.scholar_id });
    if (error) throw error;
    setMessage("Academic summary submitted. It is now Pending verification.");
    await refreshAndRender("dashboard");
  } catch (e) { setMessage(e.message, "error"); render(); }
}
async function correctGrades(event) {
  event.preventDefault();
  try {
    const values = validateGradeForm(event.currentTarget), id = event.currentTarget.dataset.id;
    const { error } = await db.from("semester_submissions").update({ ...values, verification_status: "Pending", verification_reason: null, compliance_result: null, deficiency_reasons: [], renewal_decision: "Held", renewal_note: null }).eq("id", id).eq("verification_status", "Returned");
    if (error) throw error;
    setMessage("Correction submitted. Status is Pending verification.");
    await refreshAndRender("dashboard");
  } catch (e) { setMessage(e.message, "error"); render(); }
}
function submitView() {
  const existing = state.submissions.find(r => r.academic_year === ACADEMIC_YEAR && r.semester === SEMESTER);
  let body;
  if (!existing) body = `<form id="grade-form"><div class="notice">Submit your academic summary for ${ACADEMIC_YEAR}, Semester ${SEMESTER}. The deadline is November 6, 2026 at 5:00 PM (Asia/Manila).</div>${gradeFields()}<div class="form-actions"><button class="btn" type="submit">Submit academic summary</button></div></form>`;
  else if (existing.verification_status === "Returned") body = `<div class="notice error">Returned by staff: ${esc(existing.verification_reason || "Please review and correct your submission.")}</div><form id="correction-form" data-id="${existing.id}">${gradeFields(existing)}<div class="form-actions"><button class="btn" type="submit">Correct and resubmit</button></div></form>`;
  else body = `<div class="detail-grid"><div class="detail-item"><small>Submission status</small>${badge(existing.verification_status)}</div><div class="detail-item"><small>Compliance</small>${badge(evaluate(existing).result)}</div><div class="detail-item"><small>Renewal decision</small>${badge(existing.renewal_decision)}</div></div><p class="muted">Your submission has already been recorded for this academic year and semester. Duplicate submissions are not allowed.</p>`;
  shell(`${pageHeader("Submit semester grades", "Provide your academic summary and grade document reference.")}<section class="card"><h3 class="section-title">Academic summary</h3>${body}</section>`);
  document.getElementById("grade-form")?.addEventListener("submit", submitGrades);
  document.getElementById("correction-form")?.addEventListener("submit", correctGrades);
}

function scholarsView() {
  shell(`${pageHeader("Scholar management", "Connect existing authenticated Scholar accounts to their student IDs and scholarship policies.")}<section class="card"><h3 class="section-title">Assign a Scholar account</h3><div class="notice">Create the scholar's login first in Supabase Authentication → Users. Then copy that user's UUID and enter it below. Do not enter passwords here.</div><form id="assignment-form"><div class="form-grid"><div class="field"><label>Supabase Auth User UUID</label><input name="profile_id" required placeholder="UUID from Authentication → Users"></div><div class="field"><label>Student ID</label><input name="student_id" required maxlength="40" placeholder="e.g. B01"></div><div class="field"><label>Full name</label><input name="full_name" required maxlength="120"></div><div class="field"><label>Scholarship program</label><select name="program_id" required>${state.programs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></div></div><button class="btn" type="submit">Save scholar assignment</button></form></section><section class="card"><h3 class="section-title">Assigned scholars</h3>${state.scholars.length ? `<div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Full name</th><th>Program</th><th>Auth profile</th></tr></thead><tbody>${state.scholars.map(s => `<tr><td><b>${esc(s.scholar_id)}</b></td><td>${esc(s.full_name)}</td><td>${esc(state.programs.find(p => p.id === s.program_id)?.name || s.program_id)}</td><td><span class="small muted">${esc(s.profile_id)}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No scholar assignments yet.</div>`}</section>`);
  document.getElementById("assignment-form").addEventListener("submit", saveAssignment);
}
async function saveAssignment(event) {
  event.preventDefault();
  try {
    const f = new FormData(event.currentTarget);
    const profileId = String(f.get("profile_id")).trim(), studentId = String(f.get("student_id")).trim().toUpperCase(), fullName = String(f.get("full_name")).trim(), programId = String(f.get("program_id"));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) throw Error("Enter a valid Supabase Auth user UUID.");
    if (!/^[A-Z0-9-]+$/.test(studentId)) throw Error("Student ID may contain only letters, numbers, and hyphens.");
    const { error: profileError } = await db.from("profiles").upsert({ id: profileId, role: "scholar", student_id: studentId, full_name: fullName }, { onConflict: "id" });
    if (profileError) throw profileError;
    const { error } = await db.from("scholar_assignments").upsert({ scholar_id: studentId, profile_id: profileId, program_id: programId, full_name: fullName }, { onConflict: "scholar_id" });
    if (error) throw error;
    setMessage(`Scholar ${studentId} assigned successfully.`);
    await refreshAndRender("scholars");
  } catch (e) { setMessage(e.message, "error"); render(); }
}

function reviewView() {
  const record = state.submissions.find(r => r.id === state.selectedSubmission);
  if (!record) { state.page = "dashboard"; return dashboardView(); }
  const scholar = scholarInfo(record.scholar_id);
  const program = programFor(record.scholar_id);
  const result = evaluate(record);
  const history = state.history.filter(h => h.submission_id === record.id);
  const historyMarkup = history.length
    ? history.map(h => `<div class="history-item"><b>${esc(h.action)}</b> · ${fmtDate(h.created_at)}<br>${esc(h.note || "")}</div>`).join("")
    : `<div class="empty">No history entries yet.</div>`;

  shell(`
    ${pageHeader(`${scholar.scholar_id} · ${scholar.full_name}`, "Review evidence, evaluate policy compliance, and record renewal authority.", `<button class="btn secondary" id="back">Back to dashboard</button>`)}
    <section class="card"><h3 class="section-title">Submitted academic summary</h3><div class="detail-grid">
      <div class="detail-item"><small>Scholarship program</small><strong>${esc(program?.name || "Unassigned")}</strong></div>
      <div class="detail-item"><small>GWA</small><strong>${num2(record.gwa)}</strong></div>
      <div class="detail-item"><small>Enrolled units</small><strong>${record.enrolled_units}</strong></div>
      <div class="detail-item"><small>Failed / Incomplete / Dropped</small><strong>${record.failed_count} / ${record.incomplete_count} / ${record.dropped_count}</strong></div>
      <div class="detail-item"><small>Evidence reference</small><strong>${esc(record.evidence_reference)}</strong></div>
      <div class="detail-item"><small>Submitted</small><strong>${fmtDate(record.submitted_at)}</strong></div>
    </div></section>
    <section class="card"><h3 class="section-title">1. Evidence verification</h3>
      <p>Current status: ${badge(record.verification_status)}</p>
      <div class="field"><label for="verification-reason">Verification / return reason</label><textarea id="verification-reason" rows="3" placeholder="Required when returning evidence">${esc(record.verification_reason || "")}</textarea></div>
      <div class="form-actions"><button class="btn success" id="verify" ${record.verification_status === "Verified" ? "disabled" : ""}>Mark verified</button><button class="btn danger" id="return">Return for correction</button></div>
    </section>
    <section class="card"><h3 class="section-title">2. Academic compliance</h3>
      <p>Evaluation: ${badge(result.result)} &nbsp; Saved: ${badge(record.compliance_result)}</p>
      ${result.reasons.length ? `<ul class="reason-list">${result.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="muted">All policy checks pass.</p>`}
      <div class="form-actions"><button class="btn" id="evaluate" ${record.verification_status !== "Verified" ? "disabled" : ""}>Save compliance evaluation</button></div>
    </section>
    <section class="card"><h3 class="section-title">3. Renewal decision</h3>
      <p>Current decision: ${badge(record.renewal_decision)}</p>
      <div class="field"><label for="renewal-note">Decision note</label><textarea id="renewal-note" rows="3">${esc(record.renewal_note || "")}</textarea></div>
      <div class="form-actions"><button class="btn success" id="approve" ${result.result !== "Compliant" || record.compliance_result !== "Compliant" || record.verification_status !== "Verified" ? "disabled" : ""}>Approve renewal</button><button class="btn secondary" id="hold">Hold renewal</button></div>
      <p class="small muted">Approval is available only after evidence is verified and the compliance evaluation is saved as Compliant. A deficient record may be held, not approved.</p>
    </section>
    <section class="card"><h3 class="section-title">Decision history</h3>${historyMarkup}</section>`);

  document.getElementById("back").addEventListener("click", () => { state.page = "dashboard"; state.message = ""; render(); });
  document.getElementById("verify").addEventListener("click", () => updateSubmission({ verification_status: "Verified", verification_reason: document.getElementById("verification-reason").value.trim() || null }));
  document.getElementById("return").addEventListener("click", () => {
    const reason = document.getElementById("verification-reason").value.trim();
    if (!reason) return alert("Please enter a reason before returning the submission.");
    updateSubmission({ verification_status: "Returned", verification_reason: reason, compliance_result: null, deficiency_reasons: [], renewal_decision: "Held" });
  });
  document.getElementById("evaluate").addEventListener("click", () => {
    const evaluation = evaluate(record);
    if (evaluation.result === "Blocked") return alert("Evaluation is blocked until evidence is verified and a policy is assigned.");
    updateSubmission({ compliance_result: evaluation.result, deficiency_reasons: evaluation.reasons });
  });
  document.getElementById("approve").addEventListener("click", () => {
    if (result.result !== "Compliant") return alert("Only a Compliant record can be approved.");
    updateSubmission({ renewal_decision: "Approved", renewal_note: document.getElementById("renewal-note").value.trim() || null });
  });
  document.getElementById("hold").addEventListener("click", () => updateSubmission({ renewal_decision: "Held", renewal_note: document.getElementById("renewal-note").value.trim() || null }));
}

async function updateSubmission(changes) {
  try {
    const { error } = await db.from("semester_submissions").update(changes).eq("id", state.selectedSubmission);
    if (error) throw error;
    setMessage("Submission updated successfully. The change was recorded in history.");
    await refreshAndRender("review");
  } catch (e) { setMessage(e.message, "error"); render(); }
}
async function refreshAndRender(page) { await loadData(); state.page = page; render(); }

function render() {
  try {
    if (!state.session) return loginView();
    if (state.page === "dashboard") return dashboardView();
    if (state.page === "submit") return submitView();
    if (state.page === "scholars") return scholarsView();
    if (state.page === "review") return reviewView();
    state.page = "dashboard"; return dashboardView();
  } catch (e) {
    app.innerHTML = `<main class="login-panel"><div class="login-card"><h2>Unable to load page</h2><div class="notice error">${esc(e.message)}</div><button class="btn" onclick="location.reload()">Reload</button></div></main>`;
  }
}

async function init() {
  if (!db) return showConfigError();
  const { data: { session }, error } = await db.auth.getSession();
  if (error) { setMessage(error.message, "error"); return loginView(); }
  state.session = session;
  if (session) { try { await loadUserContext(); } catch (e) { setMessage(e.message, "error"); loginView(); } }
  else loginView();
  db.auth.onAuthStateChange((event, sessionNow) => {
    if (event === "SIGNED_OUT") { state.session = null; state.profile = null; loginView(); }
  });
}
init();
