import type { Platform } from './types';
import { money } from './currency';

/**
 * All user-facing strings live here — Hebrew is the primary language of the
 * product, not a translation layer. An en.ts twin can be added later.
 */
export const t = {
  appName: 'VGPT.IL',
  tagline: 'השוואת מחירי משחקים — דיגיטלי, פיזי ובין אזורים',
  searchTab: 'חיפוש',
  wishlistTab: 'רשימת מעקב',
  settingsTab: 'הגדרות',
  // Sale-alert notifications
  notifTitle: 'התראות מבצעים',
  notifEmpty: 'אין התראות עדיין. כל המשחקים ברשימת המעקב נבדקים אוטומטית — ברגע שמחיר יירד, ההתראה תופיע כאן.',
  notifClear: 'נקה הכל',
  notifEnableBrowser: '🔔 אפשר התראות גם כשהחלון סגור',
  notifSettingsToggle: '⚙️ מתי להתריע',
  notifJumpHint: 'פתחו את המשחק ברשימת המעקב',
  notifUnreadBadge: (n: number) => `${n} התראות חדשות`,
  // The shared "when to notify" rule — edited from the bell and from the tracking list
  notifRuleTitle: 'מתי להתריע',
  notifRuleIntro:
    'הכלל הזה חל על כל המשחקים ברשימת המעקב. לכל משחק אפשר לקבוע כלל משלו (או להשתיק אותו) מתוך הפאנל שנפתח בלחיצה על שם המשחק.',
  notifAnyDropLabel: 'על כל ירידת מחיר',
  notifAnyDropHint: 'התראה בכל פעם שהמחיר נמוך מהבדיקה הקודמת, גם אם מעט.',
  notifPctLabel: 'כשיש הנחה של לפחות',
  notifPriceLabel: 'כשהמחיר יורד ל־',
  notifScopeLabel: 'על איזה מחיר להתריע',
  notifOff: 'כבוי',
  notifSaved: 'נשמר ✓',
  // Which price an alert watches
  scopeNames: {
    auto: 'המחיר הראשי במעקב',
    official: 'החנות הרשמית (לפי האזור המועדף)',
    physical: 'דיסק',
    cdkey: 'מוכרי מפתחות',
    any: 'הזול מכולם',
  } as Record<string, string>,
  scopeHint:
    '"המחיר הראשי" הוא בדיוק המחיר שמופיע בעמודת המחירים: החנות הרשמית באזור שבחרתם, ואם לא בחרתם — הזול ביותר.',
  // Per-game override (inside the expanded tracking panel)
  alertTitle: 'התראות למשחק זה',
  alertModeLabel: 'התראות',
  alertModeGlobal: 'לפי הכלל הכללי',
  alertModeCustom: 'כלל משלו',
  alertModeOff: 'כבוי (לא להתריע)',
  alertScopeUseGlobal: (name: string) => `כמו בכלל הכללי (${name})`,
  alertPctLabel: 'כשיש הנחה של',
  alertPriceLabel: 'או כשהמחיר יורד ל־',
  alertNote:
    'נבדק עם כל עדכון מחיר, ומתריע רק כשהמחיר חוצה את הסף מחדש — כדי שמשחק שנשאר במבצע לא יציק בכל בדיקה.',
  alertGlobalSummary: (rule: string) => `הכלל הכללי כרגע: ${rule}`,
  alertOffNote: 'המשחק הזה מושתק — לא יישלחו עליו התראות.',
  alertRowCustom: 'כלל התראה משלו',
  alertRowOff: 'התראות כבויות',
  // A rule written out in words ("על כל ירידת מחיר · הנחה של 20%+")
  ruleSummary: (parts: string[]) => (parts.length ? parts.join(' · ') : 'אין התראות פעילות'),
  ruleAnyDrop: 'כל ירידת מחיר',
  rulePct: (n: number) => `הנחה של ${n}% ומעלה`,
  rulePrice: (amount: string) => `מחיר עד ${amount}`,
  // Tracking-list toolbar
  notifSettingsButton: '🔔 הגדרות התראות',
  // The popup that announces a fresh drop
  toastDismiss: 'סגור',
  // Display currency
  currencyTitle: 'מטבע תצוגה',
  currencyHint: 'כל המחירים בכלי יוצגו במטבע הזה. המחירים נאספים ונשמרים בשקלים ומומרים לתצוגה לפי שער יציג.',
  currencySettingsNote:
    'מטבע התצוגה עבר לכפתור ₪ / $ / € שבראש העמוד — אפשר להחליף אותו מכל מסך, והמחירים מתעדכנים מיד. המחירים תמיד נאספים ונשמרים בשקלים ומומרים לתצוגה לפי שער יציג.',
  deltaNoiseHint: 'ללא שינוי מהותי — הפרש זעיר שנובע משער החליפין, לא משינוי מחיר בחנות',
  // "Is this a good price?" — judged against the game's own recorded history
  verdictRecord: 'הזול ביותר שנרשם',
  verdictEvidence: (checks: number, days: number) =>
    days >= 1 ? `לפי ${checks} בדיקות על פני ${days} ימים` : `לפי ${checks} בדיקות`,
  /** Which price the verdict judged — without this it can look like it contradicts a cheaper line. */
  verdictScope: { official: 'חנות רשמית', any: 'הזול מכל המקורות' } as Record<string, string>,
  /**
   * Time since a check, in natural Hebrew. Hebrew has a dual form: two days is
   * "יומיים", not "2 ימים" — getting that wrong is the tell of a translated UI.
   */
  timeAgo: (iso: string): string => {
    const then = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    if (!Number.isFinite(then)) return '—';
    const days = Math.floor((Date.now() - then) / 86_400_000);
    if (days <= 0) return 'היום';
    if (days === 1) return 'אתמול';
    if (days === 2) return 'שלשום';
    if (days < 7) return `לפני ${days} ימים`;
    const weeks = Math.round(days / 7);
    if (days < 30) return weeks === 2 ? 'לפני שבועיים' : weeks === 1 ? 'לפני שבוע' : `לפני ${weeks} שבועות`;
    const months = Math.round(days / 30);
    return months === 2 ? 'לפני חודשיים' : months === 1 ? 'לפני חודש' : `לפני ${months} חודשים`;
  },
  verdictCheapestSince: (since: string) => `הזול ביותר מזה ${since}`,
  verdictAboveLow: (pct: number, low: string) => `${pct}% מעל השיא (${low})`,
  verdictLowEver: (low: string) => `שיא כל הזמנים: ${low}`,
  verdictSince: (days: number) =>
    days >= 60 ? `${Math.round(days / 30)} חודשים` : days >= 14 ? `${Math.round(days / 7)} שבועות` : `${days} ימים`,
  verdictHint: 'מחושב מהמחירים שנרשמו למשחק הזה לאורך זמן, לא מהאחוזים שהחנות מפרסמת',
  /** When the drop happened. No source מפרסם מתי מבצע נגמר, so we say what we do know. */
  verdictDropped: (days: number) =>
    days === 0 ? 'ירד היום' : days === 1 ? 'ירד אתמול' : days === 2 ? 'ירד שלשום' : `ירד לפני ${days} ימים`,
  verdictDroppedHint: 'מתי המחיר ירד, לפי ההיסטוריה שנאספה. אף מקור לא מפרסם מתי המבצע מסתיים.',
  // Server-unreachable state (never imply the data itself is gone)
  serverDownTitle: 'אין חיבור לשרת של הכלי',
  serverDownBody:
    'הנתונים שלכם שמורים ובטוחים — רק השרת המקומי לא עונה כרגע. ודאו שהוא פועל (npm run dev) ונסו שוב.',
  serverDownRetry: 'נסו שוב',
  // Render-crash fallback (a component threw mid-render; the tracked data in the
  // server DB is never touched by a display error).
  errorBoundaryTitle: 'משהו השתבש בתצוגה',
  errorBoundaryBody:
    'חלק מהמסך נתקל בתקלה, אבל הנתונים שלכם — רשימת המעקב והיסטוריית המחירים — שמורים במקום. אפשר לרענן ולהמשיך.',
  errorBoundaryReload: 'רענון הדף',
  currencyNames: { ILS: '₪ שקל (ILS)', USD: '$ דולר (USD)', EUR: '€ אירו (EUR)' } as Record<string, string>,
  // BYOK API-key setup
  keysTitle: 'מפתחות API — מקורות מחיר נוספים',
  keysIntro:
    'הכלי עובד מצוין גם בלי המפתחות האלה. הם רק מוסיפים מקורות מחיר לעותקים דיגיטליים למחשב (מוכרי מפתחות וספקים חיצוניים). המפתח הוא אישי — הוא נשמר במחשב שלכם בלבד, ואינו נשלח לשום מקום מלבד השירות עצמו. אם הכלי יופץ בעתיד, כל משתמש ישתמש במפתח שלו כדי שלא ניתקל בחסימות או במגבלת בקשות.',
  keysGgBlurb: 'GG.deals — המחיר הזול ביותר אצל מוכרי מפתחות (G2A, Kinguin, Eneba, Gamivo…).',
  keysItadBlurb: 'IsThereAnyDeal — עשרות חנויות דיגיטליות ומוכרי מפתחות למחשב במקום אחד.',
  keyConfigured: 'מוגדר ✓',
  keyNotConfigured: 'לא הוגדר',
  keySource: (s: string) =>
    s === 'settings' ? 'הוזן כאן' : s === 'env' ? 'משתנה סביבה' : s === 'file' ? 'קובץ מקומי' : '',
  keyPlaceholder: 'הדביקו כאן מפתח API…',
  keySave: 'שמור מפתח',
  keyRemove: 'הסר',
  keyGetOne: 'קבלת מפתח חינם',
  searchPlaceholder: (example: string) => `חפשו משחק… אפשר גם עם פלטפורמה, למשל: ${example}`,
  searchHint: 'כתבו שם פלטפורמה בחיפוש (PS5, אקסבוקס, סוויץ׳, מחשב) כדי לסנן אליה בלבד',
  searchButton: 'חפש',
  searching: 'מחפש…',
  noResults: 'לא נמצאו תוצאות. נסו שם באנגלית — כך המשחקים רשומים בחנויות.',
  noSourcesForPlatform: 'מקורות המחירים לפלטפורמה הזו עוד בדרך — בקרוב. בינתיים אפשר לחפש מחירים למחשב (PC).',
  comingSoonPlatform: 'בקרוב',
  offersTitle: 'מי מוכר ובכמה',
  addToWishlist: 'הוסף למעקב',
  inWishlist: 'במעקב ✓',
  toStore: 'לחנות',
  bestPrice: 'המחיר הטוב ביותר',
  filterAll: 'הכל',
  filterDigital: 'דיגיטלי בלבד',
  filterPhysical: 'דיסק בלבד',
  filterLocal: 'חנויות בישראל',
  filterAbroad: 'משלוח מחו״ל',
  physicalBadge: 'דיסק',
  digitalBadge: 'דיגיטלי',
  localBadge: 'ישראל',
  abroadBadge: 'חו״ל',
  regionColumn: 'אזור',
  storeColumn: 'חנות',
  priceColumn: 'מחיר בש״ח',
  priceColHeader: (symbol: string) => `מחיר (${symbol})`,
  origPriceColumn: 'מחיר מקורי',
  savingsColumn: 'הנחה',
  wishlistEmpty: 'רשימת המעקב ריקה. חפשו משחק והוסיפו אותו כדי לעקוב אחרי המחיר לאורך זמן.',
  refreshPrices: 'בדוק מחירים עכשיו',
  refreshing: 'בודק…',
  lastChecked: 'נבדק לאחרונה',
  neverChecked: 'טרם נבדק',
  remove: 'הסר',
  tickerTitle: 'מבצעים על משחקים מוכרים',
  tickerDealHint: 'לחצו כדי להשוות מחירים למשחק הזה בכל החנויות והאזורים',
  offersLoadError: 'המקור לא זמין כרגע. נסו שוב עוד רגע.',
  noOffersYet: 'לא נמצאו מחירים למשחק הזה כרגע. ייתכן שהוא לא נמכר בנפרד (למשל כלול במנוי) או שאזל מהחנויות.',
  offersFilteredEmpty: 'אין הצעות שמתאימות לסינון הנוכחי.',
  regionBoardTitle: 'השוואת מחירים בין אזורים',
  regionBoardNote: 'המחיר הרשמי של המשחק בחנות הדיגיטלית בכל אזור, מומר לשקלים לפי שער יציג. רבים בישראל קונים דרך חשבון באזור זול יותר.',
  editionLabel: 'מהדורה',
  editionStandard: 'רגילה',
  regionColumnName: 'אזור',
  nativePriceColumn: 'מחיר מקומי',
  pinnedRegions: 'אזורים מועדפים',
  otherRegions: 'שאר האזורים',
  allRegions: 'כל האזורים',
  cheapestVsIsrael: (pct: number) => `זול ב-${pct}% מהמחיר בישראל`,
  vsIsraelLabel: 'לעומת ישראל',
  platformSwitchLabel: 'פלטפורמה',
  modePhysical: 'עותק פיזי (דיסק)',
  modeDigital: 'עותק דיגיטלי',
  digitalRegionsLabel: 'השוואת מחירים בין אזורים',
  digitalStoresLabel: 'השוואת עלויות בין ספקים חיצוניים',
  digitalToggleHint: 'לחצו כדי להחליף בין החנות הרשמית של הפלטפורמה (לפי אזור) לבין ספקים חיצוניים',
  physicalEmpty: 'לא נמצאו מוכרים של עותק פיזי (דיסק) למשחק הזה.',
  digitalStoresEmpty:
    'אין ספקים חיצוניים זמינים למשחק הזה. לרכישה דיגיטלית ישירה, עברו להשוואת המחירים בין האזורים.',
  digitalRegionsEmpty: 'אין השוואת אזורים זמינה למשחק הזה (זמין בעיקר למשחקי קונסולה).',
  digitalStoresNote:
    'מחירים אצל ספקים חיצוניים ומוכרי מפתחות (GMG, Humble, Fanatical, ובשורת "מוכרי מפתחות" גם G2A/Kinguin/Eneba דרך GG.deals). שימו לב: מוכרי מפתחות הם שוק משני — בדקו מוניטין ואזור-נעילה לפני רכישה.',
  preferredRegionLabel: 'האזור המועדף שלי',
  preferredPinNote: (name: string) => `${name} מוצמד לראש הרשימה. שאר האזורים מוצגים לפי המחיר הזול ביותר.`,
  vsPreferredLabel: (name: string) => `לעומת ${name}`,
  // Price-history tracking (opt-in, local)
  historyTitle: 'היסטוריית מחירים',
  trackPromptTitle: 'עקבו אחר המחיר לאורך זמן',
  trackPromptBody:
    'נתחיל לתעד את המחיר הזול ביותר למשחק הזה ונציג גרף לאורך זמן. הנתונים נשמרים במחשב שלכם בלבד — אנחנו לא שומרים כלום בענן, ולכן מעקב מתחיל רק אחרי אישור שלכם ורק למשחקים שתבחרו.',
  trackStart: 'התחל לעקוב אחר המחיר',
  tracking: 'מתעד…',
  trackingActive: 'עוקבים אחרי המשחק הזה ✓',
  addPoint: 'הוסף נקודת מחיר עכשיו',
  addingPoint: 'בודק…',
  graphNoData: 'אין עדיין נתונים. חזרו אחרי בדיקת מחיר.',
  graphOnePoint: (price: string) => `נקודה ראשונה נרשמה: ${price}. הוסיפו עוד נקודות לאורך זמן כדי לראות מגמה.`,
  graphLowest: 'הזול ביותר עד כה',
  exportButton: 'ייצוא נתוני מעקב',
  importButton: 'ייבוא',
  detailBack: '‹ חזרה לרשימת המעקב',
  loadingDetails: 'טוען מחירים ופרטים…',
  currentOffersTitle: 'הצעות נוכחיות',
  preferredCol: 'אזור מועדף',
  pricesCol: 'מחירים',
  bestPriceFallback: (name: string) =>
    `המשחק לא נמכר באזור המועדף — מוצג המחיר הזול ביותר (${name})`,
  kindDigital: 'דיגיטלי בחנות הרשמית של הפלטפורמה (לפי אזור)',
  kindDisc: 'המחיר הזול ביותר לעותק פיזי (דיסק)',
  kindKeyshop: 'המחיר הזול ביותר אצל מוכרי מפתחות / ספקים חיצוניים',
  kindDigitalShort: 'חנות רשמית',
  kindDiscShort: 'דיסק',
  kindKeyshopShort: 'מוכרי מפתחות',
  regionScopeHint:
    'האזור המועדף משפיע רק על מחיר החנות הרשמית. מחירי דיסק ומוכרי מפתחות אינם תלויים באזור.',
  // Auto-capture interval (how often a price point is recorded on the graph)
  captureGlobalLabel: 'עדכון מחירים אוטומטי לרשימת המעקב:',
  captureDaysUnit: 'ימים',
  captureGameLabel: 'תדירות צילום למשחק זה',
  captureUseGlobal: (n: number) => `ברירת מחדל (${n} ימים)`,
  captureEvery: (n: number) => `כל ${n} ימים`,
  captureHint: 'כמה זמן עובר עד שנרשמת נקודת מחיר חדשה בגרף. אפשר לשנות לכל משחק בנפרד.',
  genreLabel: 'ז׳אנר',
  noDescription: 'אין תיאור זמין למשחק הזה (זמין בעיקר למשחקים עם גרסת Steam).',
  hideDescription: 'הסתר תיאור',
  showDescription: 'הצג תיאור',
  editSettings: 'עריכת עמוד',
  doneEditing: 'סיום',
  hideAllDescriptions: 'הסתר תיאורים בכל המשחקים',
  preferredRegionGameLabel:
    'בחירת אזור משפיעה רק על מחיר החנות הרשמית של הפלטפורמה — לא על מחירי דיסק או מוכרי מפתחות.',
  exportGraphImage: 'הורד גרף כתמונה',
  seriesCheapest: 'הזול ביותר',
  seriesPreferred: 'האזור המועדף',
  seriesLegendNote: 'הגרף מציג את המחיר לאורך זמן. אפשר לבחור אזור מועדף כדי לראות גם קו נפרד עבורו.',
  graphLegendHint: 'לחיצה מציגה/מסתירה את הקו',
  graphAllHidden: 'כל הקווים מוסתרים — לחצו על שם במקרא כדי להציג אותו שוב.',
  graphShowAll: 'הצג הכל',
  graphHideAll: 'הסתר הכל',
  // The button says what pressing it will DO, and changes with its state.
  graphShowStores: 'הצג מוכרים בודדים',
  graphHideStores: 'הסתר מוכרים בודדים',
  graphShowStoresHint: 'מוסיף קו נפרד לכל מוכר (חנויות דיסקים ומוכרי מפתחות) — בנוסף לקווי הסיכום, לא במקומם',
  graphHint: 'כל קו הוא מקור מחיר: חנות רשמית לפי אזור, דיסק ומוכרי מפתחות. לחצו על שם במקרא כדי להסתיר/להציג, הפעילו "כל חנות בנפרד" כדי לראות גם קו לכל חנות, ורחפו על הגרף כדי לראות את כל המחירים בתאריך מסוים.',
  graphCapturedNow: 'נרשמה נקודת מחיר עדכנית ✓',
  importDone: (games: number, points: number) => `יובאו ${games} משחקים ו-${points} נקודות מחיר.`,
  importError: 'הקובץ אינו תקין. ודאו שזהו קובץ ייצוא של הכלי.',
  // Source availability (honest visibility when a store is down / rate-limited)
  sourcesUnavailable: 'חלק מהמקורות לא נבדקו בפעם הזו — ייתכן שחסרות הצעות:',
  sourceReasonError: 'לא זמין כרגע',
  sourceReasonRateLimited: 'ננוח מהחנות ונבדוק מאוחר יותר',
  sourcesRetryHint: 'נסו שוב עוד רגע — זו בעיה זמנית של המקור, לא של המשחק.',
  officialBadge: 'רשמי',
  launcherLabel: 'פלטפורמה',
  forRegionNote: (name: string) => `מוצג עבור האזור המועדף: ${name}. מחירים אצל ספקים חיצוניים עשויים להשתנות לפי אזור.`,
} as const;

export const platformNames: Record<Platform, string> = {
  pc: 'מחשב',
  ps5: 'PS5',
  ps4: 'PS4',
  'xbox-series': 'Xbox Series',
  'xbox-one': 'Xbox One',
  switch: 'Switch',
};

/**
 * Example searches for the search-bar placeholder — a different game and a
 * different platform style (English/Hebrew) every load.
 */
export const searchExamples = [
  'FIFA 2020 PS4',
  'Elden Ring PC',
  'God of War Ragnarok PS5',
  'Zelda Tears of the Kingdom סוויץ׳',
  'Halo Infinite Xbox Series X',
  'Mario Kart 8 נינטנדו',
  'Cyberpunk 2077 מחשב',
  'Spider-Man 2 פלייסטיישן 5',
  'Forza Horizon 5 אקסבוקס',
  'Hogwarts Legacy PS5',
  'Red Dead Redemption 2 Xbox One',
  'Baldur\'s Gate 3 סטים',
];

// `nis` now formats in the user's chosen display currency (still named nis for
// call-site brevity; ILS is the default and the stored unit).
export const nis = (n: number) => money(n);
