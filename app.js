import { firebaseConfig, ownerEmail } from './firebase-config.js';

const FIREBASE_VERSION = '10.14.1';

class LocalDiagramStore {
  constructor() {
    this.indexKey = 'roadmap-builder:index';
    this.activeKey = 'roadmap-builder:active-id';
  }

  createId() {
    return 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  getActiveId() {
    return localStorage.getItem(this.activeKey);
  }

  setActiveId(id) {
    localStorage.setItem(this.activeKey, id);
  }

  getIndex() {
    try {
      return JSON.parse(localStorage.getItem(this.indexKey) || '[]');
    } catch {
      return [];
    }
  }

  saveIndex(items) {
    localStorage.setItem(this.indexKey, JSON.stringify(items));
  }

  get(id) {
    try {
      return JSON.parse(localStorage.getItem(this.keyFor(id)) || 'null');
    } catch {
      return null;
    }
  }

  upsert(record) {
    const now = new Date().toISOString();
    const previous = this.get(record.id) || {};
    const next = {
      ...previous,
      ...record,
      updatedAt: now,
      createdAt: previous.createdAt || now
    };
    localStorage.setItem(this.keyFor(record.id), JSON.stringify(next));
    const index = this.getIndex().filter(item => item.id !== record.id);
    index.unshift({
      id: next.id,
      title: next.title,
      updatedAt: next.updatedAt,
      source: next.source || 'local'
    });
    this.saveIndex(index);
    this.setActiveId(next.id);
    return next;
  }

  delete(id) {
    localStorage.removeItem(this.keyFor(id));
    this.saveIndex(this.getIndex().filter(item => item.id !== id));
    if(this.getActiveId() === id) localStorage.removeItem(this.activeKey);
  }

  keyFor(id) {
    return 'roadmap-builder:diagram:' + id;
  }
}

class FirebaseBackend {
  constructor(config) {
    this.config = config;
    this.enabled = Boolean(config && config.apiKey && config.projectId && config.appId);
    this.ready = false;
    this.user = null;
  }

  async init(onUserChanged) {
    if(!this.enabled) return false;
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);

    this.authApi = authModule;
    this.dbApi = firestoreModule;
    this.app = initializeApp(this.config);
    this.auth = authModule.getAuth(this.app);
    this.db = firestoreModule.getFirestore(this.app);
    authModule.onAuthStateChanged(this.auth, user => {
      this.user = user;
      onUserChanged(user);
    });
    this.ready = true;
    return true;
  }

  async signIn(email, password) {
    return this.authApi.signInWithEmailAndPassword(this.auth, email, password);
  }

  async signUp(email, password) {
    const credential = await this.authApi.createUserWithEmailAndPassword(this.auth, email, password);
    await this.ensureUserProfile(credential.user);
    return credential;
  }

  async signOut() {
    return this.authApi.signOut(this.auth);
  }

  async ensureUserProfile(user) {
    if(!user) return;
    const { doc, setDoc, serverTimestamp } = this.dbApi;
    const role = ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase() ? 'owner' : 'editor';
    await setDoc(doc(this.db, 'users', user.uid), {
      email: user.email,
      role,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
  }

  async saveDiagram(record) {
    if(!this.user) throw new Error('sign-in-required');
    const { doc, setDoc, serverTimestamp } = this.dbApi;
    const payload = {
      ownerId: this.user.uid,
      ownerEmail: this.user.email || '',
      title: record.title || 'خريطة جديدة',
      documentJson: record.state,
      visibility: record.visibility || 'private',
      shareToken: record.shareToken || null,
      shareMode: record.shareMode || 'view',
      updatedAt: serverTimestamp(),
      createdAt: record.createdAt || serverTimestamp()
    };
    await setDoc(doc(this.db, 'diagrams', record.id), payload, { merge: true });
    return payload;
  }

  async listDiagrams() {
    if(!this.user) return [];
    const { collection, query, where, getDocs } = this.dbApi;
    const q = query(collection(this.db, 'diagrams'), where('ownerId', '==', this.user.uid));
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => ({
      id: docSnap.id,
      source: 'cloud',
      ...docSnap.data()
    })).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
  }

  async getDiagram(id) {
    const { doc, getDoc } = this.dbApi;
    const snap = await getDoc(doc(this.db, 'diagrams', id));
    return snap.exists() ? { id: snap.id, source: 'cloud', ...snap.data() } : null;
  }

  async deleteDiagram(id) {
    if(!this.user) return;
    const { doc, deleteDoc } = this.dbApi;
    await deleteDoc(doc(this.db, 'diagrams', id));
  }

  async publishShare(record) {
    const token = record.shareToken || cryptoRandomToken();
    await this.saveDiagram({
      ...record,
      visibility: 'public',
      shareToken: token,
      shareMode: 'view'
    });
    return token;
  }

  async getSharedDiagram(token) {
    const { collection, query, where, getDocs } = this.dbApi;
    const q = query(
      collection(this.db, 'diagrams'),
      where('shareToken', '==', token),
      where('visibility', '==', 'public')
    );
    const snap = await getDocs(q);
    if(snap.empty) return null;
    const first = snap.docs[0];
    return { id: first.id, source: 'share', ...first.data() };
  }
}

class RoadmapApp {
  constructor() {
    this.editor = window.RoadmapBuilder;
    this.local = new LocalDiagramStore();
    this.backend = new FirebaseBackend(firebaseConfig);
    this.currentId = this.local.getActiveId() || this.local.createId();
    this.currentSource = 'local';
    this.readonly = false;
    this.saveTimer = null;
    this.els = this.collectElements();
  }

  async start() {
    if(!this.editor) {
      this.setStatus('تعذر تحميل المحرر');
      return;
    }

    this.bindUi();
    this.loadLocalActive();
    await this.initFirebase();
    await this.tryOpenSharedUrl();
    this.bindAutosave();
  }

  collectElements() {
    const ids = [
      'backendStatus', 'diagramTitle', 'saveDiagramBtn', 'newDiagramBtn', 'dashboardBtn',
      'shareDiagramBtn', 'authBox', 'userBox', 'authEmail', 'authPassword', 'signInBtn',
      'signUpBtn', 'signOutBtn', 'dashboardModal', 'closeDashboardBtn', 'diagramList',
      'shareBanner', 'stage'
    ];
    return Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  }

  bindUi() {
    this.els.saveDiagramBtn.addEventListener('click', () => this.saveNow(true));
    this.els.newDiagramBtn.addEventListener('click', () => this.newDiagram());
    this.els.dashboardBtn.addEventListener('click', () => this.openDashboard());
    this.els.closeDashboardBtn.addEventListener('click', () => this.closeDashboard());
    this.els.shareDiagramBtn.addEventListener('click', () => this.shareCurrentDiagram());
    this.els.signInBtn.addEventListener('click', () => this.signIn());
    this.els.signUpBtn.addEventListener('click', () => this.signUp());
    this.els.signOutBtn.addEventListener('click', () => this.signOut());
    this.els.diagramTitle.addEventListener('change', () => this.saveNow(false));
  }

  bindAutosave() {
    window.addEventListener('roadmap:changed', () => {
      if(this.readonly) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(false), 450);
    });
  }

  async initFirebase() {
    if(!this.backend.enabled) {
      this.setStatus('محلي - أضف Firebase للتسجيل والمشاركة');
      this.toggleAuth(false);
      return;
    }
    try {
      this.setStatus('جاري اتصال Firebase...');
      await this.backend.init(user => {
        this.toggleAuth(Boolean(user), user);
        this.setStatus(user ? `سحابي: ${user.email}` : 'Firebase جاهز - سجّل الدخول');
      });
    } catch(err) {
      console.error(err);
      this.setStatus('تعذر تفعيل Firebase - يعمل محليًا');
    }
  }

  loadLocalActive() {
    const activeId = this.local.getActiveId();
    if(!activeId) return;
    const record = this.local.get(activeId);
    if(record && record.state) {
      this.currentId = record.id;
      this.currentSource = record.source || 'local';
      this.els.diagramTitle.value = record.title || 'خريطة جديدة';
      this.editor.loadState(record.state);
      this.setStatus('تم تحميل آخر خريطة محلية');
    }
  }

  async tryOpenSharedUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('share');
    if(!token) return;
    if(!this.backend.enabled || !this.backend.ready) {
      this.setStatus('رابط المشاركة يحتاج Firebase مفعّل');
      return;
    }
    const shared = await this.backend.getSharedDiagram(token);
    if(!shared || !shared.documentJson) {
      this.setStatus('رابط المشاركة غير موجود أو غير متاح');
      return;
    }
    this.currentId = shared.id;
    this.currentSource = 'share';
    this.readonly = shared.shareMode !== 'edit';
    this.els.diagramTitle.value = shared.title || 'خريطة مشتركة';
    this.editor.loadState(shared.documentJson);
    if(this.readonly) this.enableReadonlyMode();
    this.setStatus('تم فتح رابط المشاركة');
  }

  enableReadonlyMode() {
    document.body.classList.add('share-readonly');
    this.els.shareBanner.classList.remove('hidden');
    window.addEventListener('keydown', event => {
      if(event.key === 'Delete' || event.key === 'Backspace' || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    this.els.stage.addEventListener('pointerdown', event => {
      const target = event.target;
      if(target && target.closest && target.closest('.node,.port,.edge-hit,.edge-handle')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  getCurrentRecord() {
    return {
      id: this.currentId,
      title: this.els.diagramTitle.value.trim() || 'خريطة جديدة',
      state: this.editor.getState(),
      source: this.currentSource
    };
  }

  async saveNow(showToast) {
    if(this.readonly) return;
    const record = this.getCurrentRecord();
    this.local.upsert({ ...record, source: 'local' });
    if(this.backend.user) {
      await this.backend.saveDiagram(record);
      this.currentSource = 'cloud';
      this.local.upsert({ ...record, source: 'cloud' });
      this.setStatus(showToast ? 'تم الحفظ محليًا وسحابيًا' : `سحابي: ${this.backend.user.email}`);
    } else {
      this.setStatus(showToast ? 'تم الحفظ محليًا' : this.els.backendStatus.textContent);
    }
  }

  newDiagram() {
    if(this.readonly) return;
    this.currentId = this.local.createId();
    this.currentSource = 'local';
    this.els.diagramTitle.value = 'خريطة جديدة';
    this.editor.newDocument();
    this.saveNow(false);
    this.setStatus('خريطة جديدة');
  }

  async openDashboard() {
    this.els.dashboardModal.classList.remove('hidden');
    await this.renderDiagramList();
  }

  closeDashboard() {
    this.els.dashboardModal.classList.add('hidden');
  }

  async renderDiagramList() {
    const localItems = this.local.getIndex().map(item => ({
      ...item,
      source: item.source || 'local',
      title: item.title || 'خريطة بدون اسم'
    }));
    let cloudItems = [];
    if(this.backend.user) cloudItems = await this.backend.listDiagrams();
    const merged = mergeRecords(localItems, cloudItems);
    this.els.diagramList.innerHTML = '';
    if(merged.length === 0) {
      this.els.diagramList.innerHTML = '<div class="diagram-card"><strong>لا توجد خرائط محفوظة بعد</strong><span>اضغط حفظ بعد تعديل الخريطة الحالية.</span></div>';
      return;
    }
    merged.forEach(item => this.els.diagramList.appendChild(this.createDiagramCard(item)));
  }

  createDiagramCard(item) {
    const card = document.createElement('div');
    card.className = 'diagram-card';
    const title = document.createElement('strong');
    title.textContent = item.title || 'خريطة بدون اسم';
    const meta = document.createElement('span');
    meta.textContent = `${item.source === 'cloud' ? 'سحابي' : 'محلي'} - ${formatDate(item.updatedAt)}`;
    const row = document.createElement('div');
    row.className = 'row';
    const open = document.createElement('button');
    open.className = 'btn-primary';
    open.textContent = 'فتح';
    open.addEventListener('click', () => this.openDiagram(item));
    const del = document.createElement('button');
    del.className = 'btn-danger';
    del.textContent = 'حذف';
    del.addEventListener('click', () => this.deleteDiagram(item));
    row.append(open, del);
    card.append(title, meta, row);
    return card;
  }

  async openDiagram(item) {
    let record = null;
    if(item.source === 'cloud' && this.backend.user) {
      record = await this.backend.getDiagram(item.id);
      if(record) record.state = record.documentJson;
    } else {
      record = this.local.get(item.id);
    }
    if(!record || !record.state) {
      this.setStatus('تعذر فتح الخريطة');
      return;
    }
    this.currentId = item.id;
    this.currentSource = item.source;
    this.els.diagramTitle.value = record.title || item.title || 'خريطة جديدة';
    this.editor.loadState(record.state);
    this.local.setActiveId(item.id);
    this.closeDashboard();
    this.setStatus('تم فتح الخريطة');
  }

  async deleteDiagram(item) {
    const ok = window.confirm('حذف هذه الخريطة؟');
    if(!ok) return;
    if(item.source === 'cloud' && this.backend.user) await this.backend.deleteDiagram(item.id);
    this.local.delete(item.id);
    await this.renderDiagramList();
  }

  async shareCurrentDiagram() {
    if(!this.backend.enabled) {
      alert('أضف إعدادات Firebase أولًا لتفعيل روابط المشاركة الحية.');
      return;
    }
    if(!this.backend.user) {
      alert('سجّل الدخول أولًا قبل إنشاء رابط مشاركة.');
      return;
    }
    const record = this.getCurrentRecord();
    const token = await this.backend.publishShare(record);
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('share', token);
    await copyText(url.toString());
    this.setStatus('تم نسخ رابط المشاركة');
    alert('تم إنشاء ونسخ رابط المشاركة:\n' + url.toString());
  }

  async signIn() {
    const { email, password } = this.readCredentials();
    if(!email || !password) return alert('اكتب البريد وكلمة المرور.');
    await this.backend.signIn(email, password);
    await this.saveNow(false);
  }

  async signUp() {
    const { email, password } = this.readCredentials();
    if(!email || !password) return alert('اكتب البريد وكلمة المرور.');
    await this.backend.signUp(email, password);
    await this.saveNow(false);
  }

  async signOut() {
    await this.backend.signOut();
  }

  readCredentials() {
    return {
      email: this.els.authEmail.value.trim(),
      password: this.els.authPassword.value
    };
  }

  toggleAuth(isSignedIn, user) {
    this.els.authBox.classList.toggle('hidden', isSignedIn || !this.backend.enabled);
    this.els.userBox.classList.toggle('hidden', !isSignedIn);
    if(user) this.backend.ensureUserProfile(user).catch(console.error);
  }

  setStatus(text) {
    this.els.backendStatus.textContent = text;
  }
}

function cryptoRandomToken() {
  const values = new Uint8Array(18);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

function toMillis(value) {
  if(!value) return 0;
  if(typeof value.toMillis === 'function') return value.toMillis();
  if(typeof value === 'string') return Date.parse(value) || 0;
  if(value.seconds) return value.seconds * 1000;
  return 0;
}

function formatDate(value) {
  const millis = toMillis(value);
  if(!millis) return 'غير معروف';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(millis));
}

function mergeRecords(localItems, cloudItems) {
  const map = new Map();
  localItems.forEach(item => map.set(item.id, item));
  cloudItems.forEach(item => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('انسخ الرابط:', text);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new RoadmapApp();
  app.start().catch(err => {
    console.error(err);
    const status = document.getElementById('backendStatus');
    if(status) status.textContent = 'حدث خطأ في طبقة التطبيق';
  });
});
