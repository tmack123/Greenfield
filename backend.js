// ============================================================
// GreenField backend layer — Firebase (Auth + Firestore) + Cloudinary
// Falls back to on-device storage when config.js has no Firebase keys.
// ============================================================
var GF = {
  online: false, connecting: false, auth: null, db: null,
  user: null, profile: null, isAdmin: false,
  listings: [], listingsLoaded: false,
  soil: [], announcements: [], userCount: null,
  unsubSoil: null, pendingName: '', lastAnnTs: 0
};

function gfConfigured() {
  var c = window.GF_CONFIG;
  return !!(c && c.firebase && c.firebase.apiKey && c.firebase.projectId);
}
function cloudinaryConfigured() {
  var c = window.GF_CONFIG;
  return !!(c && c.cloudinary && c.cloudinary.cloudName && c.cloudinary.uploadPreset);
}
function loadScript(src) {
  return new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

// Only allow images we created (Cloudinary or inline data) to be rendered
function safeImg(url) {
  url = String(url || '');
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  if (/^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_\-\/.,%]+$/.test(url)) return url;
  return '';
}
function safeIcon(icon) {
  var s = String(icon || '🌾');
  return s.length <= 4 ? sanitize(s) : '🌾';
}

async function initBackend() {
  updateAcctBtn();
  if (!gfConfigured()) { renderModeBanner(); return; }
  GF.connecting = true;
  try {
    var b = 'https://www.gstatic.com/firebasejs/10.12.2/';
    await loadScript(b + 'firebase-app-compat.js');
    await Promise.all([loadScript(b + 'firebase-auth-compat.js'), loadScript(b + 'firebase-firestore-compat.js')]);
    firebase.initializeApp(window.GF_CONFIG.firebase);
    GF.auth = firebase.auth();
    GF.db = firebase.firestore();
    try { await GF.db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* multiple tabs or unsupported */ }
    GF.online = true;
    listenListings();
    listenAnnouncements();
    GF.auth.onAuthStateChanged(onAuthChanged);
    GF.auth.getRedirectResult().catch(function (e) { if (e && e.code) showToast(authErrMsg(e), 'error'); });
  } catch (e) {
    console.error(e);
    showToast('Could not reach the GreenField server. Using this device only.', 'error');
  }
  GF.connecting = false;
  loadProducts();
  refreshViews();
  renderModeBanner();
}

function refreshViews() {
  updateHomeStats();
  updateNotifBadge();
  if (currentPage === 'home') { renderHomeRecentMarket(); renderHomeRecentSoil(); }
  if (currentPage === 'market') renderProducts();
  if (currentPage === 'soil') renderSoilHistory();
  if (currentPage === 'notif') renderNotifications();
  if (currentPage === 'profile') renderProfile();
  if (currentPage === 'admin') renderAdmin();
}

function renderModeBanner() {
  var old = document.getElementById('mode-banner-market');
  if (old) old.remove();
  if (GF.online || GF.connecting) return;
  var bar = document.querySelector('#page-market .market-search-bar');
  if (!bar) return;
  var d = document.createElement('div');
  d.id = 'mode-banner-market'; d.className = 'mode-banner';
  d.innerHTML = '📴 <strong>Demo mode:</strong> the online server is not connected yet, so listings you post are saved on this device only. Sample listings are shown for demonstration.';
  bar.parentNode.insertBefore(d, bar);
}

// ---------------- LISTINGS ----------------
function listenListings() {
  GF.db.collection('listings').orderBy('dateAdded', 'desc').limit(300).onSnapshot(function (snap) {
    GF.listings = snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
    GF.listingsLoaded = true;
    loadProducts();
    refreshViews();
  }, function (err) {
    console.error(err);
    GF.listingsLoaded = true;
    showToast('Could not load listings: ' + (err.code || err.message), 'error');
    refreshViews();
  });
}

function compressImage(dataUrl, maxDim, quality) {
  return new Promise(function (res) {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height, scale = Math.min(1, maxDim / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = function () { res(dataUrl); };
    img.src = dataUrl;
  });
}

async function uploadListingImage(dataUrl) {
  if (!dataUrl) return null;
  var small = await compressImage(dataUrl, 1000, 0.75);
  if (cloudinaryConfigured()) {
    var c = window.GF_CONFIG.cloudinary;
    var fd = new FormData();
    fd.append('file', small);
    fd.append('upload_preset', c.uploadPreset);
    fd.append('folder', 'greenfield');
    var r = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(c.cloudName) + '/image/upload', { method: 'POST', body: fd });
    var j = await r.json();
    if (!r.ok || !j.secure_url) throw new Error((j.error && j.error.message) || 'Image upload failed');
    return j.secure_url;
  }
  // No Cloudinary: store a small inline copy (Firestore docs max out at 1 MB)
  var tiny = await compressImage(dataUrl, 640, 0.6);
  if (tiny.length > 600000) tiny = await compressImage(dataUrl, 480, 0.5);
  return tiny;
}

async function createListingOnline(p) {
  p.image = await uploadListingImage(p.image);
  p.ownerId = GF.user.uid;
  delete p.id;
  await GF.db.collection('listings').add(p);
  // Remember contact details on the profile for next time
  var upd = {};
  if (GF.profile && !GF.profile.phone && p.phone) upd.phone = p.phone;
  if (GF.profile && !GF.profile.location && p.location) upd.location = p.location;
  if (Object.keys(upd).length) { GF.db.collection('users').doc(GF.user.uid).set(upd, { merge: true }); Object.assign(GF.profile, upd); }
}

function setListingAvailability(id, avail) {
  GF.db.collection('listings').doc(id).update({ availability: avail })
    .then(function () { showToast(avail === 'Sold' ? 'Marked as sold' : 'Marked as available', 'success'); })
    .catch(function (e) { showToast('Could not update: ' + (e.code || e.message), 'error'); });
}

// Two-tap confirm instead of blocking browser dialogs
function confirmTap(btn, label, action) {
  if (btn.dataset.armed === '1') { btn.disabled = true; action(); return; }
  btn.dataset.armed = '1';
  var orig = btn.textContent;
  btn.textContent = label;
  setTimeout(function () { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = orig; } }, 3000);
}

function deleteListing(btn, id) {
  confirmTap(btn, 'Tap again', function () {
    if (!GF.online) {
      var user = lsGet('greenfield_user_products', []).filter(function (x) { return x.id !== id; });
      lsSet('greenfield_user_products', user); loadProducts(); refreshViews(); showToast('Listing deleted', 'info'); return;
    }
    GF.db.collection('listings').doc(id).delete()
      .then(function () { showToast('Listing deleted', 'info'); })
      .catch(function (e) { btn.disabled = false; showToast('Could not delete: ' + (e.code || e.message), 'error'); });
  });
}

// ---------------- SOIL HISTORY ----------------
function getSoilHistory() {
  return (GF.online && GF.user) ? GF.soil : lsGet('greenfield_soil_history', []);
}
function saveSoilEntry(entry) {
  if (GF.online && GF.user) {
    GF.soil.unshift(entry);
    return GF.db.collection('users').doc(GF.user.uid).collection('soil').doc(String(entry.id)).set(entry)
      .catch(function (e) { showToast('Saved offline — will sync when connected', 'info'); });
  }
  var h = lsGet('greenfield_soil_history', []);
  h.unshift(entry);
  lsSet('greenfield_soil_history', h.slice(0, 20));
  return Promise.resolve();
}
function deleteSoilEntry(id) {
  if (GF.online && GF.user) {
    GF.soil = GF.soil.filter(function (h) { return h.id !== id; });
    return GF.db.collection('users').doc(GF.user.uid).collection('soil').doc(String(id)).delete();
  }
  lsSet('greenfield_soil_history', lsGet('greenfield_soil_history', []).filter(function (h) { return h.id !== id; }));
  return Promise.resolve();
}
function listenSoil(uid) {
  if (GF.unsubSoil) { GF.unsubSoil(); GF.unsubSoil = null; }
  GF.unsubSoil = GF.db.collection('users').doc(uid).collection('soil').orderBy('id', 'desc').limit(50)
    .onSnapshot(function (snap) {
      GF.soil = snap.docs.map(function (d) { return d.data(); });
      refreshViews();
    }, function (e) { console.error(e); });
}
async function migrateLocalSoil(uid) {
  var local = lsGet('greenfield_soil_history', []);
  if (!local.length) return;
  var batch = GF.db.batch();
  local.forEach(function (h) { batch.set(GF.db.collection('users').doc(uid).collection('soil').doc(String(h.id)), h); });
  try { await batch.commit(); lsSet('greenfield_soil_history', []); showToast(local.length + ' saved analysis(es) moved to your account', 'success'); }
  catch (e) { console.error(e); }
}

// ---------------- ANNOUNCEMENTS ----------------
var ANN_ICONS = { system: '📢', weather: '🌧', soil: '🧪', market: '🛒' };
function listenAnnouncements() {
  var first = true;
  GF.db.collection('announcements').orderBy('timestamp', 'desc').limit(30).onSnapshot(function (snap) {
    GF.announcements = snap.docs.map(function (d) {
      var x = d.data();
      return { id: 'a_' + d.id, docId: d.id, type: x.type || 'system', icon: ANN_ICONS[x.type] || '📢', title: x.title, body: x.body, timestamp: x.timestamp, announcement: true };
    });
    var newest = GF.announcements[0];
    if (!first && newest && newest.timestamp > GF.lastAnnTs) showToast('📢 ' + newest.title, 'info');
    if (newest) GF.lastAnnTs = Math.max(GF.lastAnnTs, newest.timestamp);
    first = false;
    refreshViews();
  }, function (e) { console.error(e); });
}
function allNotifications() {
  var hidden = new Set(lsGet('greenfield_hidden_ann', []));
  return GF.announcements.filter(function (a) { return !hidden.has(a.id); })
    .concat(notifications)
    .sort(function (a, b) { return b.timestamp - a.timestamp; });
}
function hideReadAnnouncements() {
  var hidden = lsGet('greenfield_hidden_ann', []);
  GF.announcements.forEach(function (a) { if (readNotifs.has(a.id) && hidden.indexOf(a.id) < 0) hidden.push(a.id); });
  lsSet('greenfield_hidden_ann', hidden.slice(-200));
}
function postAnnouncement() {
  if (!GF.isAdmin) return;
  var t = document.getElementById('ann-title').value.trim();
  var b = document.getElementById('ann-body').value.trim();
  var type = document.getElementById('ann-type').value;
  if (t.length < 3 || b.length < 3) { showToast('Add a title and a message', 'error'); return; }
  var btn = document.getElementById('ann-submit');
  btn.disabled = true;
  GF.db.collection('announcements').add({ title: t, body: b, type: type, timestamp: Date.now(), by: GF.user.uid })
    .then(function () {
      document.getElementById('ann-title').value = ''; document.getElementById('ann-body').value = '';
      showToast('Announcement sent', 'success');
    })
    .catch(function (e) { showToast('Could not send: ' + (e.code || e.message), 'error'); })
    .finally(function () { btn.disabled = false; });
}
function deleteAnnouncement(btn, docId) {
  confirmTap(btn, 'Tap again', function () {
    GF.db.collection('announcements').doc(docId).delete()
      .then(function () { showToast('Announcement removed', 'info'); })
      .catch(function (e) { btn.disabled = false; showToast('Could not delete: ' + (e.code || e.message), 'error'); });
  });
}

// ---------------- AUTH ----------------
var authMode = 'in';
function authErrMsg(e) {
  var m = {
    'auth/invalid-email': 'That email address is not valid.',
    'auth/user-not-found': 'No account with that email. Create one instead.',
    'auth/wrong-password': 'Wrong password. Try again or reset it.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-login-credentials': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account already exists with that email. Sign in instead.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
    'auth/network-request-failed': 'No internet connection.',
    'auth/popup-closed-by-user': 'Sign-in window was closed.',
    'auth/unauthorized-domain': 'This website address is not authorised in Firebase yet (Authentication → Settings → Authorised domains).',
    'auth/operation-not-allowed': 'This sign-in method is not turned on in Firebase yet.'
  };
  return m[e.code] || (e.message || 'Something went wrong');
}
function onAccountClick() {
  if (GF.online && !GF.user) { openAuth(); return; }
  showPage('profile');
}
function openAuth(reason) {
  if (!GF.online) { showToast(GF.connecting ? 'Still connecting… try again in a moment' : 'Accounts need the online server (see Account page)', 'info'); if (!GF.connecting) showPage('profile'); return; }
  var r = document.getElementById('auth-reason');
  if (reason) { r.textContent = reason; r.style.display = 'block'; } else r.style.display = 'none';
  document.getElementById('auth-error').classList.remove('show');
  setAuthMode('in');
  openModal('auth-modal');
}
function requireAuth(reason) {
  if (!GF.online) return true;   // demo mode: no accounts
  if (GF.user) return true;
  openAuth(reason);
  return false;
}
function setAuthMode(m) {
  authMode = m;
  document.getElementById('auth-tab-in').classList.toggle('active', m === 'in');
  document.getElementById('auth-tab-up').classList.toggle('active', m === 'up');
  document.getElementById('auth-name-group').style.display = m === 'up' ? '' : 'none';
  document.getElementById('auth-submit').textContent = m === 'up' ? 'Create account' : 'Sign in';
  document.getElementById('auth-forgot').style.display = m === 'up' ? 'none' : '';
  document.getElementById('auth-pass').setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
  document.getElementById('auth-error').classList.remove('show');
}
function showAuthError(msg) {
  var e = document.getElementById('auth-error'); e.textContent = msg; e.classList.add('show');
}
function signInGoogle() {
  var provider = new firebase.auth.GoogleAuthProvider();
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (standalone) { GF.auth.signInWithRedirect(provider); return; }
  GF.auth.signInWithPopup(provider).then(function () {
    closeModal('auth-modal');
  }).catch(function (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') GF.auth.signInWithRedirect(provider);
    else if (e.code !== 'auth/cancelled-popup-request') showAuthError(authErrMsg(e));
  });
}
function submitEmailAuth() {
  var email = document.getElementById('auth-email').value.trim();
  var pass = document.getElementById('auth-pass').value;
  var name = document.getElementById('auth-name').value.trim();
  if (!email || !pass) { showAuthError('Enter your email and password.'); return; }
  if (authMode === 'up' && name.length < 2) { showAuthError('Enter your name or farm name.'); return; }
  var btn = document.getElementById('auth-submit');
  btn.disabled = true;
  var p;
  if (authMode === 'up') {
    GF.pendingName = name;
    p = GF.auth.createUserWithEmailAndPassword(email, pass).then(function (cred) {
      return cred.user.updateProfile({ displayName: name });
    });
  } else {
    p = GF.auth.signInWithEmailAndPassword(email, pass);
  }
  p.then(function () {
    closeModal('auth-modal');
    document.getElementById('auth-pass').value = '';
  }).catch(function (e) { showAuthError(authErrMsg(e)); })
    .finally(function () { btn.disabled = false; });
}
function forgotPassword() {
  var email = document.getElementById('auth-email').value.trim();
  if (!email) { showAuthError('Type your email above first.'); return; }
  GF.auth.sendPasswordResetEmail(email)
    .then(function () { showToast('Password reset email sent', 'success'); })
    .catch(function (e) { showAuthError(authErrMsg(e)); });
}
function signOutUser() {
  GF.auth.signOut().then(function () { showToast('Signed out', 'info'); showPage('home'); });
}

async function onAuthChanged(user) {
  GF.user = user; GF.profile = null; GF.isAdmin = false; GF.soil = [];
  if (GF.unsubSoil) { GF.unsubSoil(); GF.unsubSoil = null; }
  if (user) {
    var ref = GF.db.collection('users').doc(user.uid);
    try {
      var doc = await ref.get();
      if (doc.exists) GF.profile = doc.data();
      else {
        GF.profile = {
          name: GF.pendingName || user.displayName || (user.email || '').split('@')[0],
          email: user.email || '', phone: '', location: '', createdAt: Date.now()
        };
        await ref.set(GF.profile);
      }
    } catch (e) { console.error(e); GF.profile = { name: user.displayName || user.email, email: user.email || '', phone: '', location: '' }; }
    GF.pendingName = '';
    try { GF.isAdmin = (await GF.db.collection('admins').doc(user.uid).get()).exists; } catch (e) { GF.isAdmin = false; }
    listenSoil(user.uid);
    migrateLocalSoil(user.uid);
    showToast('Welcome, ' + (GF.profile.name || 'farmer') + '!', 'success');
  }
  updateAcctBtn();
  refreshViews();
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
}
function updateAcctBtn() {
  var adm = document.getElementById('nav-admin-item');
  if (adm) adm.hidden = !GF.isAdmin;
  var b = document.getElementById('acct-btn');
  if (!b) return;
  if (GF.user) {
    b.classList.add('signed-in');
    var photo = GF.user.photoURL && /^https:\/\//.test(GF.user.photoURL) ? GF.user.photoURL : '';
    b.innerHTML = photo ? '<img src="' + sanitize(photo) + '" alt="" referrerpolicy="no-referrer">' : sanitize(initials(GF.profile && GF.profile.name));
    b.title = 'Your account';
  } else {
    b.classList.remove('signed-in');
    b.textContent = '👤';
    b.title = GF.online ? 'Sign in' : 'Account';
  }
}

// ---------------- PROFILE PAGE ----------------
function listingRow(p, actions) {
  var img = safeImg(p.image);
  return '<div class="row-item">'
    + '<div class="ri-thumb">' + (img ? '<img src="' + img + '" alt="">' : '<span>' + safeIcon(p.icon) + '</span>') + '</div>'
    + '<div class="ri-main"><div class="ri-title">' + sanitize(p.name) + (p.availability === 'Sold' ? ' <span class="badge badge-danger">Sold</span>' : '') + '</div>'
    + '<div class="ri-meta">₦' + Number(p.price).toLocaleString() + ' · ' + sanitize(p.seller || '') + ' · ' + timeAgo(p.dateAdded) + '</div></div>'
    + '<div class="ri-actions">' + actions + '</div></div>';
}
function renderProfile() {
  var el = document.getElementById('profile-content');
  if (!el) return;
  if (!GF.online) {
    el.innerHTML = '<div class="card"><div class="card-title"><span class="icon">📴</span>Demo mode</div>'
      + '<p style="font-size:.88rem;color:var(--fg2);line-height:1.55">' + (GF.connecting ? 'Connecting to the GreenField server…' :
        'GreenField is running without its online server, so everything you save stays on this device and accounts are turned off. '
        + 'Once the Firebase keys are added to <code>config.js</code>, sign-in, the shared marketplace, cloud-saved soil history and the admin panel switch on automatically.') + '</p></div>'
      + localListingsCard();
    return;
  }
  if (!GF.user) {
    el.innerHTML = '<div class="card" style="text-align:center"><div style="font-size:2.5rem;margin-bottom:8px">🌱</div>'
      + '<div style="font-weight:700;margin-bottom:6px">Sign in to GreenField</div>'
      + '<p style="font-size:.85rem;color:var(--fg3);margin-bottom:16px">Post listings, save your soil analyses to your account and get announcements.</p>'
      + '<button class="btn btn-primary" onclick="openAuth()">Sign in or create account</button></div>';
    return;
  }
  var pr = GF.profile || {};
  var photo = GF.user.photoURL && /^https:\/\//.test(GF.user.photoURL) ? GF.user.photoURL : '';
  var mine = GF.listings.filter(function (p) { return p.ownerId === GF.user.uid; });
  var html = '<div class="card"><div class="profile-head">'
    + '<div class="profile-avatar">' + (photo ? '<img src="' + sanitize(photo) + '" alt="" referrerpolicy="no-referrer">' : sanitize(initials(pr.name))) + '</div>'
    + '<div><div style="font-weight:800;font-size:1.05rem">' + sanitize(pr.name || 'Farmer') + '</div>'
    + '<div style="font-size:.8rem;color:var(--fg3)">' + sanitize(GF.user.email || '') + '</div>'
    + (GF.isAdmin ? '<span class="badge badge-info" style="margin-top:4px">Admin</span>' : '') + '</div></div></div>'
    + '<div class="card"><div class="card-title"><span class="icon">✏️</span>Profile details</div>'
    + '<div class="form-group"><label class="form-label" for="pf-name">Name / farm name</label><input class="form-input" id="pf-name" maxlength="60" value="' + sanitize(pr.name || '') + '"></div>'
    + '<div class="form-group"><label class="form-label" for="pf-phone">Phone / WhatsApp</label><input class="form-input" id="pf-phone" type="tel" maxlength="20" placeholder="08012345678" value="' + sanitize(pr.phone || '') + '"></div>'
    + '<div class="form-group"><label class="form-label" for="pf-loc">Location</label><input class="form-input" id="pf-loc" maxlength="60" placeholder="E.g. Abeokuta, Ogun State" value="' + sanitize(pr.location || '') + '"></div>'
    + '<div class="form-hint" style="margin:-8px 0 12px">Used to pre-fill your marketplace listings.</div>'
    + '<button class="btn btn-primary btn-full" id="pf-save" onclick="saveProfile()">💾 Save profile</button></div>'
    + '<div class="card"><div class="card-title"><span class="icon">🛒</span>My listings (' + mine.length + ')</div>'
    + (mine.length ? mine.map(function (p) {
        var sold = p.availability === 'Sold';
        return listingRow(p, '<button class="btn btn-secondary btn-sm" onclick="setListingAvailability(\'' + p.id + '\',\'' + (sold ? 'Available' : 'Sold') + '\')">' + (sold ? '↩ Relist' : '✓ Sold') + '</button>'
          + '<button class="btn btn-danger btn-sm" onclick="deleteListing(this,\'' + p.id + '\')">🗑</button>');
      }).join('') : '<div style="font-size:.85rem;color:var(--fg3)">You have not posted anything yet. <button class="link-btn" onclick="openPostModal()">Post a product →</button></div>')
    + '</div>';
  if (GF.isAdmin) {
    html += '<div class="card"><div class="card-title"><span class="icon">🛡</span>Admin</div><button class="btn btn-primary btn-full" onclick="showPage(\'admin\')">Open admin panel</button></div>';
  } else {
    html += '<details class="card" style="font-size:.8rem;color:var(--fg3)"><summary style="cursor:pointer;font-weight:600">Admin setup</summary>'
      + '<p style="margin-top:8px;line-height:1.5">To make this account an admin, open Firebase Console → Firestore → start a collection named <strong>admins</strong>, and add a document whose ID is your user ID below (any field, e.g. role = admin). Then sign out and back in.</p>'
      + '<span class="mono">' + sanitize(GF.user.uid) + '</span></details>';
  }
  html += '<button class="btn btn-secondary btn-full" style="margin-top:12px" onclick="signOutUser()">↪ Sign out</button>';
  el.innerHTML = html;
}
function localListingsCard() {
  var mine = lsGet('greenfield_user_products', []);
  return '<div class="card"><div class="card-title"><span class="icon">🛒</span>Listings on this device (' + mine.length + ')</div>'
    + (mine.length ? mine.map(function (p) { return listingRow(p, '<button class="btn btn-danger btn-sm" onclick="deleteListing(this,\'' + p.id + '\')">🗑</button>'); }).join('')
      : '<div style="font-size:.85rem;color:var(--fg3)">None yet.</div>') + '</div>';
}
function saveProfile() {
  var upd = {
    name: document.getElementById('pf-name').value.trim().slice(0, 60),
    phone: document.getElementById('pf-phone').value.trim().slice(0, 20),
    location: document.getElementById('pf-loc').value.trim().slice(0, 60)
  };
  if (upd.name.length < 2) { showToast('Enter your name', 'error'); return; }
  var btn = document.getElementById('pf-save'); btn.disabled = true;
  GF.db.collection('users').doc(GF.user.uid).set(upd, { merge: true })
    .then(function () { Object.assign(GF.profile, upd); updateAcctBtn(); showToast('Profile saved', 'success'); renderProfile(); })
    .catch(function (e) { btn.disabled = false; showToast('Could not save: ' + (e.code || e.message), 'error'); });
}

// ---------------- ADMIN PAGE ----------------
function renderAdmin() {
  if (!GF.isAdmin) {
    document.getElementById('admin-listing-list').innerHTML = '';
    document.getElementById('admin-ann-list').innerHTML = '<div style="font-size:.85rem;color:var(--fg3)">You need admin access to use this page.</div>';
    return;
  }
  document.getElementById('adm-stat-listings').textContent = GF.listings.length;
  document.getElementById('adm-stat-ann').textContent = GF.announcements.length;
  if (GF.userCount === null) {
    GF.userCount = '…';
    GF.db.collection('users').get().then(function (s) { GF.userCount = s.size; document.getElementById('adm-stat-users').textContent = s.size; })
      .catch(function () { GF.userCount = '–'; document.getElementById('adm-stat-users').textContent = '–'; });
  }
  document.getElementById('adm-stat-users').textContent = GF.userCount;
  document.getElementById('admin-ann-list').innerHTML = GF.announcements.length ? GF.announcements.map(function (a) {
    return '<div class="row-item"><div class="ri-thumb">' + a.icon + '</div><div class="ri-main"><div class="ri-title">' + sanitize(a.title) + '</div>'
      + '<div class="ri-meta">' + timeAgo(a.timestamp) + ' · ' + sanitize(String(a.body).slice(0, 80)) + '</div></div>'
      + '<div class="ri-actions"><button class="btn btn-danger btn-sm" onclick="deleteAnnouncement(this,\'' + a.docId + '\')">🗑</button></div></div>';
  }).join('') : '<div style="font-size:.85rem;color:var(--fg3)">No announcements yet.</div>';
  var q = (document.getElementById('admin-listing-search').value || '').toLowerCase().trim();
  var list = GF.listings.filter(function (p) {
    return !q || (p.name + ' ' + p.seller + ' ' + p.location + ' ' + p.phone).toLowerCase().indexOf(q) >= 0;
  });
  document.getElementById('admin-listing-list').innerHTML = list.length ? list.map(function (p) {
    return listingRow(p, '<button class="btn btn-secondary btn-sm" onclick="viewProduct(\'' + p.id + '\')">View</button>'
      + '<button class="btn btn-danger btn-sm" onclick="deleteListing(this,\'' + p.id + '\')">🗑 Remove</button>');
  }).join('') : '<div style="font-size:.85rem;color:var(--fg3)">No listings found.</div>';
}

document.addEventListener('DOMContentLoaded', function () {
  initBackend();
  document.getElementById('auth-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitEmailAuth(); });
});
