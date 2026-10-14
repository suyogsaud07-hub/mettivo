// src/lib/translations.ts

export const translations = {
  en: {
    // Navigation
    discover: 'Discover',
    people: 'People',
    notifications: 'Notifications',
    moments: 'Moments',
    games: 'Games',
    profile: 'Profile',
    // Landing Page
    welcome: 'Mettivo',
    subtitle: 'Meet your kind of people.',
    description: 'An intimate space to find meaningful connections wrapped in luxury.',
    get_started: 'Get started →',
    get_app: 'Get the app',
    footer_text: 'Someone on Mettivo might give you butterflies.',
    // Settings
    settings: 'Settings',
    edit_profile: 'Edit Profile',
    change_avatar: 'Change Avatar',
    language: 'Language',
    sign_out: 'Sign Out',
    // Add more keys here as you translate more pages
  },
  ne: {
    // Navigation
    discover: 'पत्ता लगाउनुहोस्',
    people: 'मानिसहरू',
    notifications: 'सूचनाहरू',
    moments: 'क्षणहरू',
    games: 'खेलहरू',
    profile: 'प्रोफाइल',
    // Landing Page
    welcome: 'मेटिभो',
    subtitle: 'तपाईंको प्रकारका मानिसहरूलाई भेट्नुहोस्।',
    description: 'विलासितामा लिप्त अर्थपूर्ण जडानहरू फेला पार्ने एक घनिष्ठ स्थान।',
    get_started: 'सुरु गर्नुहोस् →',
    get_app: 'एप प्राप्त गर्नुहोस्',
    footer_text: 'मेटिभोमा कसैले तपाईंलाई पुतली दिन सक्छ।',
    // Settings
    settings: 'सेटिङहरू',
    edit_profile: 'प्रोफाइल सम्पादन गर्नुहोस्',
    change_avatar: 'अवतार परिवर्तन गर्नुहोस्',
    language: 'भाषा',
    sign_out: 'साइन आउट गर्नुहोस्',
  },
  es: {
    // Navigation
    discover: 'Descubrir',
    people: 'Gente',
    notifications: 'Notificaciones',
    moments: 'Momentos',
    games: 'Juegos',
    profile: 'Perfil',
    // Landing Page
    welcome: 'Mettivo',
    subtitle: 'Conoce a tu tipo de gente.',
    description: 'Un espacio íntimo para encontrar conexiones significativas envueltas en lujo.',
    get_started: 'Empezar →',
    get_app: 'Obtener la aplicación',
    footer_text: 'Alguien en Mettivo podría darte mariposas.',
    // Settings
    settings: 'Ajustes',
    edit_profile: 'Editar perfil',
    change_avatar: 'Cambiar avatar',
    language: 'Idioma',
    sign_out: 'Cerrar sesión',
  },
  hi: {
    // Navigation
    discover: 'खोजें',
    people: 'लोग',
    notifications: 'सूचनाएं',
    moments: 'पल',
    games: 'खेल',
    profile: 'प्रोफ़ाइल',
    // Landing Page
    welcome: 'मेट्टिवो',
    subtitle: 'अपने जैसे लोगों से मिलें।',
    description: 'विलासिता में लिपटे सार्थक संबंध खोजने के लिए एक अंतरंग स्थान।',
    get_started: 'शुरू करें →',
    get_app: 'ऐप प्राप्त करें',
    footer_text: 'मेट्टिवो पर कोई आपको तितलियाँ दे सकता है।',
    // Settings
    settings: 'सेटिंग्स',
    edit_profile: 'प्रोफ़ाइल संपादित करें',
    change_avatar: 'अवतार बदलें',
    language: 'भाषा',
    sign_out: 'साइन आउट',
  },
  fr: {
    // Navigation
    discover: 'Découvrir',
    people: 'Gens',
    notifications: 'Notifications',
    moments: 'Moments',
    games: 'Jeux',
    profile: 'Profil',
    // Landing Page
    welcome: 'Mettivo',
    subtitle: 'Rencontrez votre genre de personnes.',
    description: 'Un espace intime pour trouver des connexions significatives enveloppées de luxe.',
    get_started: 'Commencer →',
    get_app: 'Obtenir l\'application',
    footer_text: 'Quelqu\'un sur Mettivo pourrait vous donner des papillons.',
    // Settings
    settings: 'Paramètres',
    edit_profile: 'Modifier le profil',
    change_avatar: 'Changer d\'avatar',
    language: 'Langue',
    sign_out: 'Se déconnecter',
  }
};

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations['en'];