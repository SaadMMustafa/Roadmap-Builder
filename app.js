import { firebaseConfig, ownerEmail } from './firebase-config.js';

// إصدار طبقة التطبيق — بيُعرض في شارة الإصدار مع نسخة المحرّر
const APP_VERSION = '1.1.0';
const FIREBASE_VERSION = '10.14.1';

/**
 * تخزين محلي (localStorage) للمخططات.
 * الفكرة: التطبيق يفضل شغّال بالكامل من غير أي حساب أو سيرفر، والسحابة مجرد إضافة فوقه.
 */
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
    if (this.getActiveId() === id) localStorage.removeItem(this.activeKey);
  }

  /** ملف JSON قابل للمشاركة/النسخ الاحتياطي لكل المخططات المحلية */
  exportAll() {
    return {
      format: 'roadmap-builder-backup',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      diagrams: this.getIndex().map(item => this.get(item.id)).filter(Boolean)
    };
  }

  /** استيراد ملف نسخة احتياطية — بيرجّع عدد المخططات اللي اتضافت فعلًا */
  importAll(payload) {
    const diagrams = payload && Array.isArray(payload.diagrams) ? payload.diagrams : [];
    let imported = 0;
    diagrams.forEach(record => {
      if (!record || !record.state) return;
      const wantedId = record.id && !this.get(record.id) ? record.id : this.createId();
      const previous = this.get(wantedId) || {};
      localStorage.setItem(this.keyFor(wantedId), JSON.stringify({
        ...record,
        id: wantedId,
        source: 'local',
        createdAt: previous.createdAt || record.createdAt || new Date().toISOString()
      }));
      const index = this.getIndex().filter(item => item.id !== wantedId);
      index.unshift({
        id: wantedId,
        title: record.title || 'خريطة مستوردة',
        updatedAt: record.updatedAt || new Date().toISOString(),
        source: 'local'
      });
      this.saveIndex(index);
      imported++;
    });
    return imported;
  }

  keyFor(id) {
    return 'roadmap-builder:diagram:' + id;
  }
}

/** الهوية الكاملة لخريطة بالنسبة للسحابة — بتُحفظ مع كل تعديل عشان مايحصلش فقدان للحالة */
function defaultCloudMeta() {
  return { visibility: 'private', shareToken: null, shareMode: 'view' };
}

/** تحويل أي سجل خريطة (محلي أو سحابي) إلى هوية سحابية متسقة */
function cloudMetaFrom(record) {
  return {
    visibility: record && record.visibility === 'public' ? 'public' : 'private',
    shareToken: (record && record.shareToken) || null,
    shareMode: (record && record.shareMode) || 'view'
  };
}

/**
 * طبقة Firebase (اختيارية بالكامل).
 * مهم: الدور بيتقرا من السيرفر وميتكتبش تاني مع كل تسجيل دخول — القواعد هي اللي بتحمي القيمة.
 */
class FirebaseBackend {
  constructor(config) {
    this.config = config;
    this.enabled = Boolean(config && config.apiKey && config.projectId && config.appId);
    this.ready = false;
    this.user = null;
    this.role = null;
  }

  async init(onUserChanged) {
    if (!this.enabled) return false;
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

    // لازم نلتقط نتيجة أي تسجيل دخول عن طريق التحويل (Redirect) قبل ما نستنى أول حالة مصادقة،
    // لأن لو حصل fallback من popup لredirect، المستخدم بيرجع للصفحة من جديد وده أول حاجة لازم تتفحص.
    try {
      await authModule.getRedirectResult(this.auth);
    } catch (err) {
      console.error('redirect result error', err);
    }

    await new Promise(resolve => {
      const unsubscribe = authModule.onAuthStateChanged(this.auth, user => {
        this.user = user;
        onUserChanged(user);
        unsubscribe();
        resolve(user);
      });
    });
    authModule.onAuthStateChanged(this.auth, user => {
      this.user = user;
      onUserChanged(user);
    });
    this.ready = true;
    return true;
  }

  // popup أولًا (أسرع وأوضح للمستخدم)، ولو المتصفح حجبها فعلًا نرجع لـ redirect.
  // إلغاء المستخدم بنفسه مش خطأ بيئة، فبنرجّعه كخطأ عشان نقول له إنه ألغى.
  async signInWithGoogle() {
    const provider = new this.authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const credential = await this.authApi.signInWithPopup(this.auth, provider);
      await this.ensureUserProfile(credential.user);
      return credential;
    } catch (err) {
      const fallbackCodes = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment'
      ];
      if (err && fallbackCodes.includes(err.code)) {
        await this.authApi.signInWithRedirect(this.auth, provider);
        return null; // الصفحة هتعمل reload بعد التحويل، والنتيجة هتتلقط في init() عبر getRedirectResult
      }
      throw err;
    }
  }

  async signOut() {
    return this.authApi.signOut(this.auth);
  }

  async ensureUserProfile(user) {
    if (!user) return null;
    const { doc, getDoc, setDoc, serverTimestamp } = this.dbApi;
    const ref = doc(this.db, 'users', user.uid);
    const isOwner = Boolean(ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase());
    let role = isOwner ? 'owner' : 'editor';

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        // البروفايل موجود: بنحترم الدور المحفوظ على السيرفر ومش بنعيد كتابته
        const existing = snap.data();
        if (existing && existing.role) role = existing.role;
      } else {
        await setDoc(ref, {
          email: user.email || '',
          role,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.warn('user profile read failed, falling back to local role', err);
    }
    this.role = role;
    return role;
  }

  async saveDiagram(record) {
    if (!this.user) throw new Error('sign-in-required');
    const { doc, setDoc, serverTimestamp } = this.dbApi;
    const meta = cloudMetaFrom(record);
    const payload = {
      ownerId: this.user.uid,
      ownerEmail: this.user.email || '',
      title: record.title || 'خريطة جديدة',
      documentJson: record.state,
      visibility: meta.visibility,
      shareMode: meta.shareMode,
      updatedAt: serverTimestamp()
      // تاريخ الإنشاء مايتكتبش هنا أبدًا: مع { merge: true } القيمة الأصلية بتفضل زي ما هي.
      // إعادة إرسالها كانت بتعمل مشكلتين: serverTimestamp بيتحسب من جديد فأول إنشاء بيتحرك،
      // وأي قيمة محوّلة (نص ISO) مش هتساوي الـ Timestamp المحفوظ فيرفضه Firestore فيفشل الحفظ كله.
    };
    if (meta.shareToken) payload.shareToken = meta.shareToken;
    await setDoc(doc(this.db, 'diagrams', record.id), payload, { merge: true });
    return payload;
  }

  async listDiagrams() {
    if (!this.user) return [];
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
    if (!this.user) return;
    const { doc, deleteDoc } = this.dbApi;
    await deleteDoc(doc(this.db, 'diagrams', id));
  }

  /** نشر رابط مشاركة: بيحفظ الحالة الحالية + هوية عامة، وبيرجّع مفتاح الرابط */
  async publishShare(record) {
    const shareKey = record.shareToken || cryptoRandomToken();
    await this.saveDiagram({ ...record, visibility: 'public', shareMode: 'view', shareToken: shareKey });
    return shareKey;
  }

  /** إيقاف المشاركة: المخطط بيرجع خاص والمفتاح بيتشال */
  async unpublishShare(record) {
    await this.saveDiagram({ ...record, visibility: 'private', shareMode: 'view', shareToken: null });
  }

  async getSharedDiagram(shareKey) {
    const { collection, query, where, getDocs } = this.dbApi;
    const q = query(
      collection(this.db, 'diagrams'),
      where('shareToken', '==', shareKey),
      where('visibility', '==', 'public')
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
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
    this.cloudDisabled = false;
    this.saveTimer = null;
    // هوية الخريطة الحالية بالنسبة للسحابة: لو منسية، أي حفظ تلقائي بيكسر رابط المشاركة
    this.currentMeta = defaultCloudMeta();
    this.isShareLink = new URLSearchParams(window.location.search).has('share');
    this.els = this.collectElements();
  }

  async start() {
    if (!this.editor) {
      this.setStatus('تعذر تحميل المحرّر');
      return;
    }

    this.bindUi();
    await this.initFirebase();
    const openedShare = await this.tryOpenSharedUrl();
    if (!openedShare && this.backend.user) this.loadLocalActive();
    this.bindAutosave();
    this.applyVersion();
  }

  applyVersion() {
    const version = (this.editor && this.editor.version) || APP_VERSION;
    document.title = `باني المخططات — Roadmap Builder v${version}`;
    if (this.els.backendStatus && !this.els.backendStatus.textContent) this.els.backendStatus.textContent = 'محلي';
  }

  collectElements() {
    const ids = [
      'backendStatus', 'diagramTitle', 'saveDiagramBtn', 'newDiagramBtn', 'dashboardBtn',
      'shareDiagramBtn', 'userBox', 'signOutBtn', 'dashboardModal', 'closeDashboardBtn',
      'diagramList', 'shareBanner', 'stage', 'googleSignInBtn', 'loginStatus',
      'accountIconBtn', 'accountDrawer', 'accountDrawerBackdrop', 'closeAccountDrawerBtn', 'accountEmail',
      'loginGate', 'gateGoogleSignInBtn', 'gateLoginStatus', 'gateLocalBtn',
      'exportLocalBtn', 'importLocalBtn', 'importLocalInput'
    ];
    return Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  }

  bindUi() {
    this.els.saveDiagramBtn.addEventListener('click', () => this.saveNow(true));
    this.els.newDiagramBtn.addEventListener('click', () => this.newDiagram());
    this.els.dashboardBtn.addEventListener('click', () => this.openDashboard());
    this.els.closeDashboardBtn.addEventListener('click', () => this.closeDashboard());
    this.els.shareDiagramBtn.addEventListener('click', () => this.shareCurrentDiagram());
    this.els.googleSignInBtn.addEventListener('click', () => this.signInWithGoogle());
    this.els.gateGoogleSignInBtn.addEventListener('click', () => this.signInWithGoogle());
    this.els.signOutBtn.addEventListener('click', () => this.signOut());
    this.els.diagramTitle.addEventListener('change', () => this.saveNow(false));
    this.els.accountIconBtn.addEventListener('click', () => this.openAccountDrawer());
    this.els.closeAccountDrawerBtn.addEventListener('click', () => this.closeAccountDrawer());
    this.els.accountDrawerBackdrop.addEventListener('click', () => this.closeAccountDrawer());

    // المتابعة محليًا: التطبيق كامل من غير حساب — مفيدة للتجربة أو لو Firebase متعطّل
    if (this.els.gateLocalBtn) this.els.gateLocalBtn.addEventListener('click', () => this.continueLocally());

    // نسخة احتياطية محلية (JSON) — تشتغل من غير أي سيرفر
    if (this.els.exportLocalBtn) this.els.exportLocalBtn.addEventListener('click', () => this.exportLocalBackup());
    if (this.els.importLocalBtn && this.els.importLocalInput) {
      this.els.importLocalBtn.addEventListener('click', () => this.els.importLocalInput.click());
      this.els.importLocalInput.addEventListener('change', event => this.importLocalBackup(event));
    }

    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!this.els.dashboardModal.classList.contains('hidden')) this.closeDashboard();
      this.closeAccountDrawer();
    });
  }

  openAccountDrawer() {
    // نقفل قائمة العقد أولًا لو مفتوحة عشان الاثنين مايتصادموش بصريًا (بيسحبوا من نفس الجانب)
    document.body.classList.remove('nodes-list-open');
    const nodesListBackdrop = document.getElementById('nodesListBackdrop');
    if (nodesListBackdrop) nodesListBackdrop.classList.add('hidden');
    this.refreshAccountDrawer();
    document.body.classList.add('account-drawer-open');
    this.els.accountDrawerBackdrop.classList.remove('hidden');
  }

  closeAccountDrawer() {
    document.body.classList.remove('account-drawer-open');
    this.els.accountDrawerBackdrop.classList.add('hidden');
  }

  refreshAccountDrawer() {
    const user = this.backend.user;
    const roleLabel = this.backend.role === 'owner' ? 'مالك' : 'محرّر';
    if (this.els.accountEmail) {
      this.els.accountEmail.textContent = user ? `${user.email} (${roleLabel})` : '';
    }
    if (this.els.gateLocalBtn) {
      const showLocal = this.backend.enabled && !user && !this.isShareLink && !this.cloudDisabled;
      this.els.gateLocalBtn.style.display = showLocal ? '' : 'none';
    }
  }

  bindAutosave() {
    // المحرّر بيطلّق roadmap:changed على كل تغيير ذو معنى — بما فيها التراجع/الإعادة
    window.addEventListener('roadmap:changed', () => {
      if (this.readonly) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(false), 450);
    });
  }

  async initFirebase() {
    if (!this.backend.enabled) {
      this.setStatus('محلي فقط — أضف إعدادات Firebase للتفعيل السحابي');
      return;
    }
    if (window.location.protocol === 'file:') {
      // تسجيل الدخول بـ Firebase مستحيل يشتغل وأنت فاتح الملف مباشرة (file://)
      const msg = 'تسجيل الدخول لا يعمل مع فتح الملف مباشرة (file://). شغّل المشروع من سيرفر محلي (npm start). التطبيق شغّال محليًا في الحالتين.';
      this.setStatus('محلي فقط — الصفحة مفتوحة من ملف');
      if (window.RoadmapUI) window.RoadmapUI.toast(msg, 'error');
      this.showLocalOption(msg);
      return;
    }
    try {
      this.setStatus('جاري اتصال Firebase...');
      await this.backend.init(user => {
        this.applyAuthState(user);
      });
    } catch (err) {
      console.error(err);
      const detail = err && (err.code || err.message) ? ` (${err.code || err.message})` : '';
      const msg = `تعذر الاتصال بـ Firebase${detail}. راجع إعدادات المشروع والدومين المصرّح. تقدر تكمل محليًا من الزر تحت.`;
      this.setStatus('محلي فقط — تعذر الاتصال بالسحابة');
      this.showLocalOption(msg);
      if (window.RoadmapUI) window.RoadmapUI.toast('تعذر الاتصال بـ Firebase — التطبيق شغّال محليًا.', 'error');
    }
  }

  /** بدل ما نقفل التطبيق على المستخدم لما السحابة تفشل، بنعرض له خيار واضح يكمل محليًا */
  showLocalOption(message) {
    if (this.isShareLink) return;
    this.els.loginStatus.textContent = message || '';
    this.els.gateLoginStatus.textContent = message || '';
    this.els.loginGate.classList.remove('hidden');
    this.refreshAccountDrawer();
  }

  continueLocally() {
    this.cloudDisabled = true;
    this.unlockApp();
    this.setStatus('محلي فقط (بدون سحابة)');
    if (this.els.gateLocalBtn) this.els.gateLocalBtn.style.display = 'none';
    if (!this.local.get(this.currentId)) this.loadLocalActive();
    if (window.RoadmapUI) window.RoadmapUI.toast('وضع محلي: كل حاجة بتتحفظ في المتصفح.', 'success');
  }

  loadLocalActive() {
    const activeId = this.local.getActiveId();
    if (!activeId) return;
    const record = this.local.get(activeId);
    if (record && record.state) {
      this.currentId = record.id;
      this.currentSource = record.source || 'local';
      this.currentMeta = cloudMetaFrom(record);
      this.els.diagramTitle.value = record.title || 'خريطة جديدة';
      this.editor.loadState(record.state);
      this.setStatus('تم تحميل آخر خريطة محلية');
    }
  }

  async tryOpenSharedUrl() {
    const params = new URLSearchParams(window.location.search);
    const shareKey = params.get('share');
    if (!shareKey) return false;
    if (!this.backend.enabled || !this.backend.ready) {
      this.setStatus('رابط المشاركة يحتاج Firebase مفعّل');
      return false;
    }
    const shared = await this.backend.getSharedDiagram(shareKey);
    if (!shared || !shared.documentJson) {
      this.setStatus('رابط المشاركة غير موجود أو غير متاح');
      if (window.RoadmapUI) window.RoadmapUI.toast('رابط المشاركة غير صالح أو اتوقف.', 'error');
      return false;
    }
    this.currentId = shared.id;
    this.currentSource = 'share';
    this.currentMeta = cloudMetaFrom({ ...shared, shareToken: shared.shareToken || shareKey });
    this.readonly = shared.shareMode !== 'edit';
    this.els.diagramTitle.value = shared.title || 'خريطة مشتركة';
    this.editor.loadState(shared.documentJson);
    this.unlockApp();
    if (this.readonly) this.enableReadonlyMode();
    this.setStatus('تم فتح رابط المشاركة');
    return true;
  }

  /**
   * وضع العرض فقط: نقفل التعديل من المؤشر وبالكيبورد،
   * لكن منعتمدش على preventDefault لكل ضغطة Ctrl — كده Ctrl+F وCtrl+P والنسخ يفضلوا شغالين.
   */
  enableReadonlyMode() {
    document.body.classList.add('share-readonly');
    this.els.shareBanner.classList.remove('hidden');
    window.addEventListener('keydown', event => {
      const mod = event.ctrlKey || event.metaKey;
      const editingKey = event.key === 'Delete' || event.key === 'Backspace'
        || (mod && ['z', 'Z', 'y', 'Y', 'v', 'V', 'x', 'X'].includes(event.key));
      if (editingKey) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    this.els.stage.addEventListener('pointerdown', event => {
      // منع تعديل العناصر نفسها فقط — مع إبقاء تحريك اللوحة بالزر الأيمن شغالًا
      // (تحريك الكاميرا مابيغيّرش المحتوى، وده سلوك مفيد لزائر رابط المشاركة)
      const target = event.target;
      const onElement = target && target.closest && target.closest('.node,.port,.edge-hit,.edge-handle');
      if (onElement && event.button !== 2) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  getCurrentRecord() {
    const meta = this.currentMeta || defaultCloudMeta();
    return {
      id: this.currentId,
      title: this.els.diagramTitle.value.trim() || 'خريطة جديدة',
      state: this.editor.getState(),
      source: this.currentSource,
      visibility: meta.visibility,
      shareToken: meta.shareToken,
      shareMode: meta.shareMode
    };
  }

  async saveNow(showToast) {
    if (this.readonly) return;
    const record = this.getCurrentRecord();
    this.local.upsert({ ...record, source: 'local' });

    if (this.backend.user) {
      try {
        await this.backend.saveDiagram(record);
        this.currentSource = 'cloud';
        this.local.upsert({ ...record, source: 'cloud' });
        this.setStatus(showToast ? 'تم الحفظ محليًا وسحابيًا' : `سحابي: ${this.backend.user.email}`);
      } catch (err) {
        console.error(err);
        this.setStatus('تم الحفظ محليًا فقط (تعذر الوصول للسحابة)');
        if (showToast && window.RoadmapUI) window.RoadmapUI.toast('تعذر الحفظ السحابي — النسخة المحلية سليمة.', 'error');
      }
    } else {
      this.setStatus(showToast ? 'تم الحفظ محليًا' : this.els.backendStatus.textContent);
    }
  }

  newDiagram() {
    if (this.readonly) return;
    this.currentId = this.local.createId();
    this.currentSource = 'local';
    this.currentMeta = defaultCloudMeta();
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
    if (this.backend.user) {
      try {
        cloudItems = await this.backend.listDiagrams();
      } catch (err) {
        console.error(err);
        this.setStatus('تعذر تحميل القائمة السحابية');
      }
    }
    const merged = mergeRecords(localItems, cloudItems);
    this.els.diagramList.innerHTML = '';
    if (merged.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'diagram-card';
      empty.innerHTML = '<strong>لا توجد خرائط محفوظة بعد</strong><span>اضغط حفظ بعد تعديل الخريطة الحالية.</span>';
      this.els.diagramList.appendChild(empty);
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
    const flags = [item.source === 'cloud' ? 'سحابي' : 'محلي'];
    if (item.visibility === 'public') flags.push('مشترك برابط');
    meta.textContent = `${flags.join(' - ')} - ${formatDate(item.updatedAt)}`;
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
    // خريطة سحابية بس؟ نسمح بنسخة محلية كاملة تشتغل من غير إنترنت/حساب
    if (item.source === 'cloud' && !this.local.get(item.id)) {
      const keep = document.createElement('button');
      keep.className = 'btn-ghost';
      keep.textContent = 'نسخة محلية';
      keep.addEventListener('click', () => this.copyCloudToLocal(item));
      row.appendChild(keep);
    }
    card.append(title, meta, row);
    return card;
  }

  async copyCloudToLocal(item) {
    const record = await this.backend.getDiagram(item.id);
    if (!record || !record.documentJson) {
      if (window.RoadmapUI) window.RoadmapUI.toast('تعذر قراءة الخريطة من السحابة.', 'error');
      return;
    }
    this.local.upsert({
      id: item.id,
      title: record.title || item.title,
      state: record.documentJson,
      source: 'local',
      visibility: record.visibility,
      shareToken: record.shareToken,
      shareMode: record.shareMode
    });
    if (window.RoadmapUI) window.RoadmapUI.toast('تم إنشاء نسخة محلية.', 'success');
    await this.renderDiagramList();
  }

  async openDiagram(item) {
    let record = null;
    if (item.source === 'cloud' && this.backend.user) {
      record = await this.backend.getDiagram(item.id);
      if (record) record.state = record.documentJson;
    } else {
      record = this.local.get(item.id);
    }
    if (!record || !record.state) {
      this.setStatus('تعذر فتح الخريطة');
      return;
    }
    this.currentId = item.id;
    this.currentSource = item.source;
    this.currentMeta = cloudMetaFrom(record);
    this.els.diagramTitle.value = record.title || item.title || 'خريطة جديدة';
    this.editor.loadState(record.state);
    this.local.setActiveId(item.id);
    this.closeDashboard();
    this.setStatus('تم فتح الخريطة');
  }

  async deleteDiagram(item) {
    const ok = await window.RoadmapUI.confirm('حذف هذه الخريطة؟ لا يمكن التراجع عن هذه الخطوة.');
    if (!ok) return;
    if (item.source === 'cloud' && this.backend.user) await this.backend.deleteDiagram(item.id);
    this.local.delete(item.id);
    await this.renderDiagramList();
  }

  async shareCurrentDiagram() {
    if (!this.backend.enabled) {
      window.RoadmapUI.toast('أضف إعدادات Firebase أولًا لتفعيل روابط المشاركة الحية.', 'error');
      return;
    }
    if (!this.backend.user) {
      window.RoadmapUI.toast('سجّل الدخول أولًا قبل إنشاء رابط مشاركة.', 'error');
      return;
    }
    // الحالة الحالية لازم تتحفظ مع المشاركة، وإلا أول حفظ تلقائي بيكسر الرابط
    const record = { ...this.getCurrentRecord(), visibility: 'public' };
    try {
      const shareKey = await this.backend.publishShare(record);
      this.currentMeta = { visibility: 'public', shareToken: shareKey, shareMode: 'view' };
      this.local.upsert({ ...record, shareToken: shareKey, source: 'cloud' });
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('share', shareKey);
      this.setStatus('تم إنشاء رابط المشاركة');
      await window.RoadmapUI.showLink('رابط مشاركة الخريطة', url.toString());
    } catch (err) {
      console.error(err);
      window.RoadmapUI.toast('تعذر إنشاء رابط المشاركة. راجع اتصال الإنترنت وصلاحيات Firebase.', 'error');
    }
  }

  async signInWithGoogle() {
    try {
      this.els.googleSignInBtn.disabled = true;
      this.els.gateGoogleSignInBtn.disabled = true;
      this.els.loginStatus.textContent = 'جاري فتح Google...';
      this.els.gateLoginStatus.textContent = 'جاري فتح Google...';
      const credential = await this.backend.signInWithGoogle();
      if (!credential) return; // تم التحويل لصفحة جوجل (fallback)
      this.cloudDisabled = false;
      await this.saveNow(false);
    } catch (err) {
      console.error(err);
      const cancelled = err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request');
      const detail = err && (err.code || err.message) ? ` (${err.code || err.message})` : '';
      const message = cancelled
        ? 'تم إلغاء تسجيل الدخول.'
        : `تعذر تسجيل الدخول بجوجل${detail}. راجع تفعيل Google provider والدومين المصرّح في Firebase.`;
      this.els.loginStatus.textContent = message;
      this.els.gateLoginStatus.textContent = message;
    } finally {
      this.els.googleSignInBtn.disabled = false;
      this.els.gateGoogleSignInBtn.disabled = false;
    }
  }

  async signOut() {
    await this.backend.signOut();
    this.lockApp('تم تسجيل الخروج. ادخل بحساب Google للمتابعة، أو كمّل محليًا.');
    this.closeAccountDrawer();
  }

  applyAuthState(user) {
    const isSignedIn = Boolean(user);
    this.els.userBox.classList.toggle('hidden', !isSignedIn);
    if (user) {
      this.backend.ensureUserProfile(user)
        .then(role => { this.backend.role = role; this.refreshAccountDrawer(); })
        .catch(console.error);
      this.unlockApp();
      this.setStatus(`سحابي: ${user.email}`);
      if (this.currentSource !== 'share') this.loadLocalActive();
    } else if (this.cloudDisabled) {
      this.unlockApp();
      this.setStatus('محلي فقط (بدون سحابة)');
    } else {
      this.lockApp('سجّل الدخول بحساب Google عشان تحفظ في السحابة، أو كمّل محليًا.');
      if (this.currentSource !== 'share') this.setStatus('غير مسجّل الدخول');
    }
  }

  // تسجيل الدخول مطلوب لاستخدام السحابة، لكن التطبيق نفسه شغّال محليًا بالكامل.
  lockApp(message) {
    document.body.classList.remove('account-signed-in');
    this.els.loginStatus.textContent = message || '';
    this.els.gateLoginStatus.textContent = message || '';
    if (this.backend.enabled && !this.isShareLink && !this.cloudDisabled) {
      this.els.loginGate.classList.remove('hidden');
    }
    this.refreshAccountDrawer();
  }

  unlockApp() {
    document.body.classList.add('account-signed-in');
    this.els.loginStatus.textContent = '';
    this.els.gateLoginStatus.textContent = '';
    this.els.loginGate.classList.add('hidden');
    this.refreshAccountDrawer();
  }

  exportLocalBackup() {
    const payload = this.local.exportAll();
    if (!payload.diagrams.length) {
      window.RoadmapUI.toast('مفيش خرائط محلية للتصدير لسه.', 'error');
      return;
    }
    downloadJson(`roadmap-builder-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
    window.RoadmapUI.toast('تم تنزيل النسخة الاحتياطية.', 'success');
  }

  async importLocalBackup(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const count = this.local.importAll(payload);
      if (!count) {
        window.RoadmapUI.toast('الملف مفيهوش خريطة واحدة صالحة.', 'error');
        return;
      }
      window.RoadmapUI.toast(`تم استيراد ${count} خريطة محليًا.`, 'success');
      await this.renderDiagramList();
    } catch (err) {
      console.error(err);
      window.RoadmapUI.toast('الملف مش JSON صالح.', 'error');
    }
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
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function formatDate(value) {
  const millis = toMillis(value);
  if (!millis) return 'غير معروف';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(millis));
}

function mergeRecords(localItems, cloudItems) {
  const map = new Map();
  localItems.forEach(item => map.set(item.id, item));
  cloudItems.forEach(item => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function startApp() {
  const app = new RoadmapApp();
  // بنطلّع نسخة على window عشان الاختبار الآلي وأي أداة تشخيص تقدر تتحقق من الحالة
  window.__roadmapApp = app;
  app.start().catch(err => {
    console.error(err);
    const status = document.getElementById('backendStatus');
    if (status) status.textContent = 'حدث خطأ في طبقة التطبيق';
  });
  return app;
}

// jsdom بيطلّق DOMContentLoaded قبل ما الموديول يشتغل، فبنغطي الحالتين
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

export { APP_VERSION, LocalDiagramStore, FirebaseBackend, RoadmapApp, mergeRecords, formatDate, toMillis };
