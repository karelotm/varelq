// Shell strings in English and French. t(key, fallback) looks up the active language, then English, then the fallback.
// setLang(lang) persists the choice, updates <html lang> and dispatches window event 'varelq:lang' ({detail:{lang}}).

const KEY = 'varelq.lang';
export const LANGS = [{ id: 'en', label: 'English' }, { id: 'fr', label: 'Français' }];

const DICT = {
  en: {
    'group.workspace': 'Workspace', 'group.records': 'Records', 'group.intelligence': 'Intelligence',
    'nav.overview': 'Overview', 'nav.investigations': 'Investigations', 'nav.chat': 'Ask VARELQ',
    'nav.documents': 'Documents', 'nav.suppliers': 'Suppliers', 'nav.receiving': 'Receiving',
    'nav.reliability': 'Agent reliability', 'nav.lab': 'Guard lab', 'nav.history': 'Execution history',
    'nav.organization': 'Organization', 'nav.settings': 'Settings', 'nav.cases': 'Case',
    'org.local': 'Local workspace', 'org.switch': 'Switch organization', 'org.new': 'New organization',
    'org.name': 'Organization name', 'org.create': 'Create', 'org.cancel': 'Cancel',
    'org.caption': 'Organizations are local profiles on this server.', 'org.settings': 'Organization settings',
    'org.created': 'Organization created', 'org.switched': 'Switched to',
    'user.local': 'Local session', 'user.menu': 'Account menu', 'user.settings': 'Settings', 'user.usage': 'Usage',
    'user.language': 'Language', 'user.help': 'Get help', 'user.logout': 'Log out',
    'user.nologout': 'Nothing to log out of locally', 'user.operator': 'Local operator',
    'bell.label': 'Notifications', 'bell.unread': 'unread', 'bell.markall': 'Mark all read', 'bell.empty': 'Nothing needs your attention.',
    'bell.pending': 'Case pending review', 'bell.failed': 'Run failed', 'bell.report': 'Reliability report ready',
    'bell.unsafe': 'Unsafe actions in lab batch', 'bell.fallback': 'Fallback model used', 'bell.ocrfb': 'OCR fell back to hosted',
    'bell.unavailable': 'Some sources could not be read.', 'bell.caption': 'Derived from runs, lab batches and usage on this server.',
    'settings.title': 'Settings', 'settings.search': 'Search settings', 'settings.none': 'No settings match.',
    'settings.close': 'Close settings', 'settings.general': 'General', 'settings.organization': 'Organization',
    'settings.usage': 'Usage', 'settings.gpu': 'GPU and OCR', 'settings.privacy': 'Data and privacy',
    'settings.group.account': 'Account', 'settings.group.preferences': 'Preferences', 'settings.group.workspace': 'Workspace', 'settings.group.system': 'System',
    'settings.failed': 'This section failed to load.',
    'palette.placeholder': 'Search pages and actions', 'palette.settings': 'Settings',
    'theme.toggle': 'Theme',
    'nav.collapse': 'Collapse sidebar', 'nav.expand': 'Expand sidebar',
    'view.notLoaded': 'View not loaded.', 'view.openOverview': 'Open overview', 'view.unavailable': 'Unavailable',
    'settings.unavailable': 'Settings are unavailable.',
    'palette.search': 'Search', 'palette.unavailable': 'Search is unavailable.', 'palette.ask': 'Ask VARELQ',
    'palette.batches': 'Lab batches', 'palette.documents': 'Document runs', 'palette.empty': 'Type to search.',
    'palette.findings': 'Reliability findings', 'palette.loading': 'Loading records…', 'palette.move': 'move', 'palette.open': 'open',
    'palette.pages': 'Pages', 'palette.partial': 'Some records could not be loaded', 'palette.results': 'Results',
    'palette.searchAll': 'Search pages, invoices, suppliers, findings…', 'palette.title': 'Search',
  },
  fr: {
    'group.workspace': 'Espace de travail', 'group.records': 'Registres', 'group.intelligence': 'Analyse',
    'nav.overview': "Vue d'ensemble", 'nav.investigations': 'Enquêtes', 'nav.chat': 'Demander à VARELQ',
    'nav.documents': 'Documents', 'nav.suppliers': 'Fournisseurs', 'nav.receiving': 'Réceptions',
    'nav.reliability': 'Fiabilité des agents', 'nav.lab': 'Labo des garde-fous', 'nav.history': "Historique d'exécution",
    'nav.organization': 'Organisation', 'nav.settings': 'Paramètres', 'nav.cases': 'Dossier',
    'org.local': 'Espace local', 'org.switch': "Changer d'organisation", 'org.new': 'Nouvelle organisation',
    'org.name': "Nom de l'organisation", 'org.create': 'Créer', 'org.cancel': 'Annuler',
    'org.caption': 'Les organisations sont des profils locaux sur ce serveur.', 'org.settings': "Paramètres de l'organisation",
    'org.created': 'Organisation créée', 'org.switched': 'Organisation active :',
    'user.local': 'Session locale', 'user.menu': 'Menu du compte', 'user.settings': 'Paramètres', 'user.usage': 'Utilisation',
    'user.language': 'Langue', 'user.help': "Obtenir de l'aide", 'user.logout': 'Se déconnecter',
    'user.nologout': 'Aucune session à fermer en local', 'user.operator': 'Opérateur local',
    'bell.label': 'Notifications', 'bell.unread': 'non lues', 'bell.markall': 'Tout marquer comme lu', 'bell.empty': 'Rien ne demande votre attention.',
    'bell.pending': 'Dossier en attente de revue', 'bell.failed': "Échec de l'exécution", 'bell.report': 'Rapport de fiabilité prêt',
    'bell.unsafe': 'Actions dangereuses dans un lot du labo', 'bell.fallback': 'Modèle de secours utilisé', 'bell.ocrfb': "L'OCR est passé à l'hébergé",
    'bell.unavailable': 'Certaines sources sont illisibles.', 'bell.caption': 'Issu des exécutions, lots du labo et de l’utilisation de ce serveur.',
    'settings.title': 'Paramètres', 'settings.search': 'Rechercher un paramètre', 'settings.none': 'Aucun paramètre ne correspond.',
    'settings.close': 'Fermer les paramètres', 'settings.general': 'Général', 'settings.organization': 'Organisation',
    'settings.usage': 'Utilisation', 'settings.gpu': 'GPU et OCR', 'settings.privacy': 'Données et confidentialité',
    'settings.group.account': 'Compte', 'settings.group.preferences': 'Préférences', 'settings.group.workspace': 'Espace de travail', 'settings.group.system': 'Système',
    'settings.failed': "Cette section n'a pas pu être chargée.",
    'palette.placeholder': 'Rechercher des pages et des actions', 'palette.settings': 'Paramètres',
    'theme.toggle': 'Thème',
    'nav.collapse': 'Réduire la barre latérale', 'nav.expand': 'Déplier la barre latérale',
    'view.notLoaded': 'Vue non chargée.', 'view.openOverview': "Ouvrir la vue d'ensemble", 'view.unavailable': 'Indisponible',
    'settings.unavailable': 'Les paramètres sont indisponibles.',
    'palette.search': 'Rechercher', 'palette.unavailable': 'La recherche est indisponible.', 'palette.ask': 'Demander à VARELQ',
    'palette.batches': 'Lots du labo', 'palette.documents': 'Analyses de documents', 'palette.empty': 'Tapez pour rechercher.',
    'palette.findings': 'Constats de fiabilité', 'palette.loading': 'Chargement des enregistrements…', 'palette.move': 'naviguer', 'palette.open': 'ouvrir',
    'palette.pages': 'Pages', 'palette.partial': "Certains enregistrements n'ont pas pu être chargés", 'palette.results': 'Résultats',
    'palette.searchAll': 'Rechercher pages, factures, fournisseurs, constats…', 'palette.title': 'Rechercher',
  },
};

function readLang() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && DICT[v]) return v;
  } catch { /* storage unavailable */ }
  return 'en';
}

let current = readLang();
try { document.documentElement.lang = current; } catch { /* no document */ }

export function getLang() { return current; }

export function setLang(lang) {
  if (!DICT[lang] || lang === current) return;
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* still applies for this session */ }
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent('varelq:lang', { detail: { lang } }));
}

export function t(key, fallback) {
  const d = DICT[current];
  if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
  if (Object.prototype.hasOwnProperty.call(DICT.en, key)) return DICT.en[key];
  return fallback !== undefined ? fallback : key;
}
