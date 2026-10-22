export interface MenuActionCallbacks {
  onNavigate: (route: string) => void;
  onMenuAction: (action: string) => void;
  onCheckAllKeys?: () => void;
  onQuit?: () => void;
}

export interface MenuLabels {
  appAbout: string;
  settings: string;
  services: string;
  hide: string;
  hideOthers: string;
  unhide: string;
  quit: string;
  fileMenu: string;
  newKey: string;
  importKeys: string;
  exportWorking: string;
  createBackup: string;
  restoreBackup: string;
  closeWindow: string;
  editMenu: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  viewMenu: string;
  dashboard: string;
  workingKeys: string;
  allKeys: string;
  failedKeys: string;
  providers: string;
  models: string;
  compare: string;
  apiTester: string;
  chatPlayground: string;
  diagnostics: string;
  history: string;
  toggleSidebar: string;
  commandPalette: string;
  reload: string;
  toggleDevTools: string;
  resetZoom: string;
  zoomIn: string;
  zoomOut: string;
  togglefullscreen: string;
  toolsMenu: string;
  testAllKeys: string;
  retestFailed: string;
  generateConfig: string;
  windowMenu: string;
  minimize: string;
  zoom: string;
  front: string;
  helpMenu: string;
  keyboardShortcuts: string;
  securityStorageInfo: string;
}

const EN_MENU: MenuLabels = {
  appAbout: 'About AI API Key Lab',
  settings: 'Settings…',
  services: 'Services',
  hide: 'Hide AI API Key Lab',
  hideOthers: 'Hide Others',
  unhide: 'Show All',
  quit: 'Quit AI API Key Lab',
  fileMenu: 'File',
  newKey: 'New API Key…',
  importKeys: 'Import Keys / Backup…',
  exportWorking: 'Export Working Keys…',
  createBackup: 'Create Encrypted Backup…',
  restoreBackup: 'Restore Backup…',
  closeWindow: 'Close Window',
  editMenu: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  viewMenu: 'View',
  dashboard: 'Dashboard',
  workingKeys: 'Working Keys',
  allKeys: 'All Keys',
  failedKeys: 'Failed Keys',
  providers: 'Providers',
  models: 'Models',
  compare: 'Compare',
  apiTester: 'API Tester',
  chatPlayground: 'Chat Playground',
  diagnostics: 'Diagnostics',
  history: 'History',
  toggleSidebar: 'Toggle Sidebar',
  commandPalette: 'Command Palette…',
  reload: 'Reload',
  toggleDevTools: 'Toggle Developer Tools',
  resetZoom: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  togglefullscreen: 'Toggle Full Screen',
  toolsMenu: 'Tools',
  testAllKeys: 'Test All Keys',
  retestFailed: 'Re-test Failed Keys',
  generateConfig: 'Generate Config Snippet…',
  windowMenu: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  front: 'Bring All to Front',
  helpMenu: 'Help',
  keyboardShortcuts: 'Keyboard Shortcuts',
  securityStorageInfo: 'Security & Storage Info',
};

const AR_MENU: MenuLabels = {
  appAbout: 'حول AI API Key Lab',
  settings: 'الإعدادات…',
  services: 'الخدمات',
  hide: 'إخفاء AI API Key Lab',
  hideOthers: 'إخفاء الآخرين',
  unhide: 'إظهار الكل',
  quit: 'إنهاء AI API Key Lab',
  fileMenu: 'ملف',
  newKey: 'مفتاح API جديد…',
  importKeys: 'استيراد مفاتيح / نسخة احتياطية…',
  exportWorking: 'تصدير المفاتيح العاملة…',
  createBackup: 'إنشاء نسخة احتياطية مشفرة…',
  restoreBackup: 'استعادة نسخة احتياطية…',
  closeWindow: 'إغلاق النافذة',
  editMenu: 'تحرير',
  undo: 'تراجع',
  redo: 'إعادة',
  cut: 'قص',
  copy: 'نسخ',
  paste: 'لصق',
  selectAll: 'تحديد الكل',
  viewMenu: 'عرض',
  dashboard: 'لوحة التحكم',
  workingKeys: 'المفاتيح العاملة',
  allKeys: 'كل المفاتيح',
  failedKeys: 'المفاتيح الفاشلة',
  providers: 'المزودون',
  models: 'النماذج',
  compare: 'المقارنة',
  apiTester: 'مختبر API',
  chatPlayground: 'ساحة المحادثة',
  diagnostics: 'التشخيصات',
  history: 'السجل',
  toggleSidebar: 'طي/فتح الشريط الجانبي',
  commandPalette: 'لوحة الأوامر…',
  reload: 'إعادة تحميل',
  toggleDevTools: 'أدوات المطور',
  resetZoom: 'الحجم الفعلي',
  zoomIn: 'تكبير',
  zoomOut: 'تصغير',
  togglefullscreen: 'ملء الشاشة',
  toolsMenu: 'أدوات',
  testAllKeys: 'فحص كل المفاتيح',
  retestFailed: 'إعادة فحص المفاتيح الفاشلة',
  generateConfig: 'توليد كود الإعداد…',
  windowMenu: 'نافذة',
  minimize: 'تصغير للـ Dock',
  zoom: 'تكبير/تصغير',
  front: 'إحضار الكل للمقدمة',
  helpMenu: 'مساعدة',
  keyboardShortcuts: 'اختصارات لوحة المفاتيح',
  securityStorageInfo: 'معلومات الأمان والتخزين',
};

/**
 * Builds the native macOS application menu template (bilingual EN/AR support) per §9.
 * Includes full Edit role items (`undo`, `redo`, `cut`, `copy`, `paste`, `selectAll`)
 * so Cmd+C / Cmd+V / Cmd+X / Cmd+A / Cmd+Z work natively in all inputs.
 */
export function buildMacApplicationMenuTemplate(
  lang: 'en' | 'ar',
  callbacks: MenuActionCallbacks,
  isDev = false
): Record<string, unknown>[] {
  const L = lang === 'ar' ? AR_MENU : EN_MENU;

  const viewSubmenu: Record<string, unknown>[] = [
    { label: L.dashboard, accelerator: 'CmdOrCtrl+1', click: () => callbacks.onNavigate('/dashboard') },
    { label: L.workingKeys, accelerator: 'CmdOrCtrl+2', click: () => callbacks.onNavigate('/keys/working') },
    { label: L.allKeys, accelerator: 'CmdOrCtrl+3', click: () => callbacks.onNavigate('/keys') },
    { label: L.failedKeys, accelerator: 'CmdOrCtrl+4', click: () => callbacks.onNavigate('/keys/failed') },
    { label: L.providers, accelerator: 'CmdOrCtrl+5', click: () => callbacks.onNavigate('/providers') },
    { label: L.models, accelerator: 'CmdOrCtrl+6', click: () => callbacks.onNavigate('/models') },
    { label: L.compare, accelerator: 'CmdOrCtrl+7', click: () => callbacks.onNavigate('/compare') },
    { label: L.apiTester, accelerator: 'CmdOrCtrl+8', click: () => callbacks.onNavigate('/tester') },
    { label: L.chatPlayground, accelerator: 'CmdOrCtrl+9', click: () => callbacks.onNavigate('/chat') },
    { label: L.diagnostics, click: () => callbacks.onNavigate('/diagnostics') },
    { label: L.history, click: () => callbacks.onNavigate('/history') },
    { type: 'separator' },
    { label: L.toggleSidebar, accelerator: 'CmdOrCtrl+B', click: () => callbacks.onMenuAction('toggle-sidebar') },
    { label: L.commandPalette, accelerator: 'CmdOrCtrl+K', click: () => callbacks.onMenuAction('command-palette') },
    { type: 'separator' },
    { label: L.resetZoom, role: 'resetZoom' },
    { label: L.zoomIn, role: 'zoomIn' },
    { label: L.zoomOut, role: 'zoomOut' },
    { type: 'separator' },
    { label: L.togglefullscreen, role: 'togglefullscreen' },
  ];

  if (isDev) {
    viewSubmenu.push(
      { type: 'separator' },
      { label: L.reload, role: 'reload' },
      { label: L.toggleDevTools, role: 'toggleDevTools' }
    );
  }

  return [
    {
      label: 'AI API Key Lab',
      submenu: [
        { label: L.appAbout, click: () => callbacks.onMenuAction('open-about') },
        { type: 'separator' },
        { label: L.settings, accelerator: 'CmdOrCtrl+,', click: () => callbacks.onNavigate('/settings') },
        { type: 'separator' },
        { label: L.services, role: 'services' },
        { type: 'separator' },
        { label: L.hide, role: 'hide' },
        { label: L.hideOthers, role: 'hideOthers' },
        { label: L.unhide, role: 'unhide' },
        { type: 'separator' },
        { label: L.quit, role: 'quit' },
      ],
    },
    {
      label: L.fileMenu,
      submenu: [
        { label: L.newKey, accelerator: 'CmdOrCtrl+N', click: () => callbacks.onMenuAction('new-key') },
        { label: L.importKeys, accelerator: 'CmdOrCtrl+I', click: () => callbacks.onNavigate('/settings/backup') },
        { label: L.exportWorking, accelerator: 'CmdOrCtrl+Shift+E', click: () => callbacks.onNavigate('/settings/backup') },
        { type: 'separator' },
        { label: L.createBackup, click: () => callbacks.onNavigate('/settings/backup') },
        { label: L.restoreBackup, click: () => callbacks.onNavigate('/settings/backup') },
        { type: 'separator' },
        { label: L.closeWindow, accelerator: 'CmdOrCtrl+W', role: 'close' },
      ],
    },
    {
      label: L.editMenu,
      submenu: [
        { label: L.undo, role: 'undo' },
        { label: L.redo, role: 'redo' },
        { type: 'separator' },
        { label: L.cut, role: 'cut' },
        { label: L.copy, role: 'copy' },
        { label: L.paste, role: 'paste' },
        { label: L.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: L.viewMenu,
      submenu: viewSubmenu,
    },
    {
      label: L.toolsMenu,
      submenu: [
        { label: L.testAllKeys, accelerator: 'CmdOrCtrl+Shift+T', click: () => callbacks.onMenuAction('test-all-keys') },
        { label: L.retestFailed, accelerator: 'CmdOrCtrl+Shift+R', click: () => callbacks.onMenuAction('retest-failed-keys') },
        { type: 'separator' },
        { label: L.generateConfig, click: () => callbacks.onNavigate('/keys/working') },
      ],
    },
    {
      label: L.windowMenu,
      submenu: [
        { label: L.minimize, role: 'minimize' },
        { label: L.zoom, role: 'zoom' },
        { type: 'separator' },
        { label: L.front, role: 'front' },
      ],
    },
    {
      label: L.helpMenu,
      submenu: [
        { label: L.keyboardShortcuts, accelerator: 'CmdOrCtrl+/', click: () => callbacks.onMenuAction('open-shortcuts') },
        { label: L.securityStorageInfo, click: () => callbacks.onNavigate('/settings') },
      ],
    },
  ];
}
