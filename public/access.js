/* Shared demo password: Site Bridge is invitation-only. The password is asked as soon as the
 * page opens (nothing shows behind it), and it unlocks scanning and live demos. Asked once, then remembered in this browser. Exposes window.sbKey() and
 * window.sbPay = { openDemo, beforeScan, refreshNote } (the names app.js already calls). */
(function () {
  var STORE = 'sb:key';
  var required = null; // null until /api/status answers
  var status = fetch('/api/status').then(function (r) { return r.json(); })
    .then(function (s) { required = Boolean(s.password); }).catch(function () { required = true; });

  function read() { try { return localStorage.getItem(STORE) || ''; } catch (e) { return ''; } }
  function save(v) { try { if (v) localStorage.setItem(STORE, v); else localStorage.removeItem(STORE); } catch (e) { /* blocked */ } }
  window.sbKey = read;

  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  var dlg = el('<dialog class="lx-auth lx-gate" aria-labelledby="lx-key-title">' +
    '<form method="dialog" class="lx-auth-x"><button aria-label="Close">×</button></form>' +
    '<div class="lx-eyebrow lx-eyebrow-left"><i></i>Demo access</div>' +
    '<h2 id="lx-key-title">Enter the demo password</h2>' +
    '<p class="lx-auth-sub">Site Bridge is open by invitation. Enter the password you were given to continue.</p>' +
    '<form class="lx-auth-form"><input type="password" required autocomplete="current-password" placeholder="Demo password" aria-label="Demo password">' +
    '<button type="submit" class="lx-btn lx-btn-dark">Continue</button></form>' +
    '<p class="lx-auth-msg" role="status" aria-live="polite"></p></dialog>');
  document.body.appendChild(dlg);
  var form = dlg.querySelector('.lx-auth-form'), input = form.querySelector('input'), btn = form.querySelector('button'), msg = dlg.querySelector('.lx-auth-msg');
  var waiting = null; // resolves the pending ask() with true (unlocked) or false (closed)
  var closeBtn = dlg.querySelector('.lx-auth-x');
  function locked() { return document.documentElement.classList.contains('sb-locked'); }
  // While the page is locked the dialog cannot be dismissed (no close button, Escape does nothing)
  dlg.addEventListener('cancel', function (e) { if (locked()) e.preventDefault(); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var pw = input.value;
    if (!pw) return;
    btn.disabled = true; msg.className = 'lx-auth-msg'; msg.textContent = 'Checking…';
    var r = await fetch('/api/access/check', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sb-key': pw }, body: '{}' }).catch(function () { return null; });
    var d = r ? await r.json().catch(function () { return {}; }) : {};
    btn.disabled = false;
    if (!r || !r.ok) { msg.className = 'lx-auth-msg err'; msg.textContent = (r && r.status === 401) ? 'That password is not right. Please try again.' : (d.error || 'Could not check the password. Please try again.'); input.select(); return; }
    save(pw);
    document.documentElement.classList.remove('sb-locked');
    document.dispatchEvent(new Event('sb:unlocked'));
    msg.className = 'lx-auth-msg ok'; msg.textContent = 'Unlocked.';
    var w = waiting; waiting = null;
    setTimeout(function () { dlg.close(); input.value = ''; msg.textContent = ''; if (w) w(true); }, 300);
  });
  dlg.addEventListener('close', function () { if (waiting) { var w = waiting; waiting = null; w(false); } });

  /** Ask for the password. Resolves true once unlocked, false if the visitor closes the dialog. */
  function ask(note) {
    msg.className = note ? 'lx-auth-msg err' : 'lx-auth-msg'; msg.textContent = note || '';
    input.value = '';
    closeBtn.hidden = locked();
    if (!dlg.open) dlg.showModal();
    input.focus();
    return new Promise(function (resolve) { waiting = resolve; });
  }

  /** True when the visitor may go ahead (no password needed, or one is saved). */
  async function unlocked() {
    await status;
    if (!required || read()) return true;
    return ask();
  }

  // Without 'noopener' in the features, window.open returns the tab (with it, it always returns null)
  function go(url) { var w = window.open(url, '_blank'); if (w) { try { w.opener = null; } catch (e) { /* cross-origin */ } } else location.href = url; }

  async function openDemo(siteId, url) {
    if (!(await unlocked())) return;
    var r = await fetch('/api/demo/start/' + encodeURIComponent(siteId), { method: 'POST', headers: { 'content-type': 'application/json', 'x-sb-key': read() }, body: '{}' }).catch(function () { return null; });
    var d = r ? await r.json().catch(function () { return {}; }) : {};
    if (r && r.ok) { go(url + (d.pass ? '#sbpass=' + encodeURIComponent(d.pass) : '')); return; }
    if (r && r.status === 401) { save(''); if (await ask('The saved password no longer works. Please enter the current one.')) openDemo(siteId, url); return; }
    alert(d.error || 'Could not open the demo right now.');
  }

  /** Before a scan: make sure the password is in hand. Returns true if the scan may start now. */
  async function beforeScan() { return unlocked(); }

  /** Called by app.js when the server turned a scan down for a wrong or missing password. */
  async function rejected(retry) { save(''); if (await ask('Please enter the demo password to scan a site.')) retry(); }

  // On page load: ask straight away, unless no password is set or the saved one still works
  status.then(async function () {
    var root = document.documentElement;
    if (!required) { root.classList.remove('sb-locked'); return; }
    var saved = read();
    if (saved) {
      var r = await fetch('/api/access/check', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sb-key': saved }, body: '{}' }).catch(function () { return null; });
      if (r && r.ok) { root.classList.remove('sb-locked'); return; }
      if (r && r.status === 401) save('');
      else { root.classList.remove('sb-locked'); return; } // network trouble: don't lock out someone who already unlocked
    }
    root.classList.add('sb-locked');
    ask(saved ? 'The password has changed. Please enter the current one.' : '');
  });

  window.sbPay = { openDemo: openDemo, beforeScan: beforeScan, refreshNote: function () {}, rejected: rejected };
})();
