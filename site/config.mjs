export default {
  title: 'thalk',
  url: 'https://thalk.chuboyu.space',
  author: 'boyu',
  email: 'y@chuboyu.space',
  newsletterFrom: 'thalk <news@thalk.chuboyu.space>',
  // Firebase 2nd-gen function endpoints (asia-east1, project thalk-1c092)
  apiBase: 'https://asia-east1-thalk-1c092.cloudfunctions.net',

  defaultLang: 'en',
  // The expected human-authored language set. A group missing one of these
  // (and not marked `solo: true`) fails scripts/check-i18n.mjs.
  requiredLangs: ['en', 'zh'],
  languages: [
    { code: 'en', label: 'English', htmlLang: 'en', locale: 'en-GB', hreflang: 'en' },
    { code: 'zh', label: '繁體中文', htmlLang: 'zh-Hant', locale: 'zh-Hant-TW', hreflang: 'zh-Hant' }
  ]
};
