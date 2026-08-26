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
  // General preferences (settings page)
  generalTitle: 'העדפות כלליות',
  defaultCountryLabel: 'מדינה מועדפת כברירת מחדל',
  defaultCountryNote:
    'האזור שנבחר כאן נצמד לראש כל השוואת מחירים ומשמש כבסיס לחיסכון. אפשר גם לשנות אותו תוך כדי צפייה במשחק.',
  openAnimLabel: 'אנימציית פתיחת כרטיס לתוך הלוח',
  openAnimNote:
    'בלחיצה על משחק, כרטיס המשחק "נכנס" אל תוך לוח המחירים בתנועה קצרה. אפשר לכבות אם מעדיפים פתיחה מיידית.',
  animOn: 'מופעל',
  animOff: 'כבוי',
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
  // Departure-board price reveal (prototype): click a card → it flips open into a board.
  depFull: 'לדף המלא',
  depClose: 'סגירה',
  depLoading: 'טוען מחירים…',
  depError: 'לא הצלחנו לטעון מחירים כרגע. אפשר לנסות שוב.',
  depEmpty: 'אין מחירים להצגה למשחק הזה כרגע.',
  depDisc: 'דיסק',
  depKey: 'מפתח',
  depDirect: 'ישיר',
  depColStore: 'מקור',
  depColRegion: 'אזור',
  depColPrice: 'מחיר',
  depColDelta: 'חיסכון',
  depNoMatch: 'אין הצעות שמתאימות לסינון — נסו לשחרר פילטר.',
  depMetaLoading: 'טוען פרטים…',
  // Filter bar: store-type chips, region, on-sale, sort.
  depType: { official: 'רשמי', disc: 'דיסק', keys: 'מוכרי מפתחות' } as Record<
    'official' | 'disc' | 'keys',
    string
  >,
  depRegionAll: 'כל האזורים',
  depRegionLabel: 'סינון לפי אזור',
  depMyRegion: (name: string) => `האזור שלי · ${name}`,
  depOnSale: 'רק במבצע',
  depStoresLabel: 'חנויות',
  depStoresAll: 'הכל',
  // Region / key caveats. The tool never blocks a purchase — it explains.
  depRiskTitle: 'לפני שקונים מאזור אחר',
  depRiskBody:
    'המחירים מאזורים אחרים אמיתיים, אבל לא תמיד אפשר לשלם אותם מכאן: חנות שמוכרת לפי אזור דורשת בדרך כלל חשבון ואמצעי תשלום מאותה מדינה, ומפתח שנקנה אצל מוכר חיצוני עלול להיות נעול לאזור מסוים ולא להיפתח בחשבון ישראלי.',
  depRiskWhatHappens:
    'מה קורה אם המפתח לא מתאים לאזור שלכם? בדרך כלל הוא פשוט לא ייפתח, ואצל רוב המוכרים אין החזר על מפתח שכבר נוסה. לכן כדאי לבדוק באתר המוכר לאיזה אזור המוצר מיועד לפני התשלום.',
  depRiskDisclaimer:
    'הכלי מציג מידע בלבד ואינו מוכר דבר — הבחירה והאחריות על הרכישה הן שלכם, ואיננו אחראים לנזק או להפסד שנגרמו מרכישה שלא התאימה לאזור.',
  depRiskDismiss: 'אל תציגו לי את ההסבר הזה שוב',
  depRiskGotIt: 'הבנתי',
  depRiskShowAgain: 'הצג שוב הסבר על קנייה מאזור אחר',
  // Eilat: real prices published by the shops themselves — never calculated.
  depEilat: 'מחירי אילת',
  depEilatHint: 'מציג את המחיר שהחנות עצמה מפרסמת לסניף אילת, במקום המחיר הארצי',
  depEilatBadge: 'אילת',
  depEilatTitle: 'מחירי אילת',
  depEilatBody:
    'אילת נמצאת באזור סחר חופשי, ולכן קנייה בעיר פטורה ממע״מ (18%) ומשחקים יוצאים שם זולים יותר. רשת שיש לה סניף באילת מפרסמת את המחיר האילתי לצד המחיר הארצי, וזה בדיוק המספר שמוצג כאן — נקרא מהחנות, לא מחושב על ידינו.',
  depEilatBody2:
    'לא לכל החנויות יש סניף באילת, ולכן לחלק מהשורות פשוט אין מחיר אילתי — במקרה כזה מוצג המחיר הארצי כרגיל. המחיר בפועל תלוי בסניף ובמלאי, והקנייה צריכה להתבצע באילת.',
  depEilatNone: 'אין מחיר אילת',
  depEilatSaving: (pct: number) => `${pct}% פחות מהמחיר הארצי`,
  depOnlyBuyable: 'רק מה שאפשר לקנות מכאן',
  // Names the region, because "from here" is meaningless until you know which
  // "here" — and it is the country picked in Settings, not the browser's locale.
  depOnlyBuyableHint: (region: string) =>
    `מסתיר שורות שלא באמת אפשר לקנות מהאזור שלכם: חנות שדורשת חשבון ואמצעי תשלום זרים, או מפתח שנעול לאזור אחר. ` +
    `"האזור שלכם" הוא ${region} — המדינה שבחרתם בהגדרות, תחת "מדינה מועדפת כברירת מחדל". ` +
    `שינוי המדינה שם משנה גם את מה שהכפתור הזה מסתיר. אפשר לכבות אותו בכל רגע והשורות חוזרות.`,
  // Board layout
  depMoreRegions: (n: number) => `עוד ${n} אזורים`,
  depFewerRegions: 'הסתר אזורים',
  depShowRest: (n: number) => `הצג עוד ${n} הצעות`,
  depColSale: 'מבצע',
  // Summary of the board, under the game — a table of numbers with nothing
  // summing it up answers "where" but never "is this a lot of money".
  statsTitle: '📊 סיכום המחירים',
  statsLow: 'הזול ביותר',
  statsMedian: 'המחיר האופייני',
  statsHigh: 'היקר ביותר',
  statsSpread: 'הפרש',
  // A multiplier, not a percentage: "×2.3 between cheapest and dearest" lands
  // instantly, where "+130%" needs a moment's arithmetic to mean anything.
  statsSpreadPct: (pct: number) => `פי ${(1 + pct / 100).toFixed(1)}`,
  statsCount: (offers: number, stores: number) => `${offers} הצעות ב־${stores} חנויות`,
  statsFiltered: 'לפי הסינון הנוכחי',
  statsIsrael: 'בישראל',
  statsIsraelOver: (pct: number) => `יקר ב־${pct}% מהזול ביותר`,
  statsIsraelBest: 'הזול ביותר בלוח',
  statsRecordedLow: (price: string, when: string) =>
    when ? `הנמוך ביותר שנרשם: ${price} (${when})` : `הנמוך ביותר שנרשם: ${price}`,
  statsChecks: (n: number) => `${n} בדיקות מחיר שמורות`,
  statsOneCheck: 'נרשמה בדיקת מחיר אחת — עוד לא מספיק לגרף.',
  statsNoHistory: 'אין עדיין היסטוריית מחירים למשחק הזה. הוסיפו אותו למעקב כדי להתחיל לאסוף.',
  // Every row goes somewhere — a comparison that cannot be acted on is trivia.
  depColGo: 'לרכישה',
  depGoAria: (store: string, price: string) => `פתיחת ההצעה ב${store} — ${price} (נפתח בלשונית חדשה)`,
  depNoLink: 'המקור הזה לא מספק קישור ישיר להצעה',
  // Adapter health canary
  healthTitle: 'מצב מקורות המחירים',
  healthIntro:
    'הכלי אוסף מחירים מ־16 מקורות, שרובם נקראים ישירות מאתרי החנויות. כשחנות משנה את האתר שלה המקור לא "נופל" — הוא פשוט מפסיק להחזיר תוצאות, וזה נראה בדיוק כמו "המשחק לא נמכר שם". הבדיקה הזו מריצה חיפוש אמיתי לכל מקור אחת ליום ומראה מי באמת עובד.',
  healthRun: 'בדוק עכשיו',
  healthRunning: 'בודק…',
  healthNever: 'עוד לא בוצעה בדיקה. אפשר להריץ אחת עכשיו.',
  healthCheckedAt: (when: string) => `נבדק לאחרונה: ${when}`,
  healthProbe: (q: string) => `חיפוש בדיקה: "${q}"`,
  healthStates: {
    ok: 'תקין',
    empty: 'לא החזיר תוצאות',
    error: 'שגיאה',
    rate_limited: 'ממתין (האטה יזומה)',
    disabled: 'כבוי (נדרש מפתח)',
  } as Record<string, string>,
  healthEmptyHint:
    'מקור שלא מחזיר תוצאות לחיפוש בדיקה הוא כנראה שבור — כדאי לבדוק אם החנות שינתה את האתר.',
  // PlayStation persisted-query hash
  psnTitle: 'חיבור לחנות פלייסטיישן',
  psnIntro:
    'החיפוש בחנות פלייסטיישן דורש מזהה שאילתה שסוני מחליפה מדי פעם. כשזה קורה, הכלי משחזר אותו לבד — הוא פותח את דף החנות הציבורי בדפדפן שכבר מותקן במחשב וקורא משם את המזהה. לא צריך לעשות כלום.',
  psnBrowserOk: (engine: string) => `שחזור אוטומטי פעיל (דרך ${engine})`,
  psnBrowserSelf: 'שחזור אוטומטי פעיל (האפליקציה משתמשת בדפדפן המובנה שלה)',
  // Says what is true about THIS shell. The old single message claimed no
  // Chromium browser existed on the machine — which people read inside a
  // Chromium browser, on machines with several.
  psnBrowserManual:
    'בגרסה הזו אין שחזור אוטומטי: תוסף דפדפן לא יכול להפעיל דפדפן ולקרוא ממנו בקשות. זו מגבלה של התוסף, לא של המחשב שלכם. אם סוני תחליף את המזהה, אפשר להדביק אותו ידנית למטה — זה לוקח חצי דקה, וההסבר בהמשך.',
  psnBrowserNone:
    'לא נמצא דפדפן שאפשר להפעיל ברקע לצורך השחזור. הכלי מחפש כרום או אדג׳, ואם אין — כל דפדפן אחר מבוסס Chromium שמותקן במחשב (Brave, Comet, Vivaldi, Opera וכדומה). אפשר גם להצביע על דפדפן מסוים עם משתנה הסביבה VGPT_BROWSER_PATH, או פשוט להדביק את המזהה ידנית למטה.',
  psnSourceLabel: 'המזהה שבשימוש',
  psnSources: { env: 'ממשתנה סביבה', saved: 'הוזן/שוחזר כאן', builtin: 'ברירת המחדל המובנית' } as Record<string, string>,
  psnRecover: 'בדוק ושחזר עכשיו',
  psnRecovering: 'משחזר…',
  psnRecovered: 'שוחזר בהצלחה ✓',
  psnRecoverFailed: 'לא הצלחנו לשחזר אוטומטית — אפשר להדביק ידנית',
  psnManualLabel: 'הדבקה ידנית של המזהה',
  psnManualHelp:
    'פתחו את store.playstation.com בכל דפדפן, חפשו משחק כלשהו, ובכלי הפיתוח (F12) בלשונית Network מצאו בקשה בשם getSearchResults והעתיקו ממנה את הערך sha256Hash (64 תווים).',
  psnSave: 'שמירה',
  psnClear: 'איפוס לברירת מחדל',
  psnSaved: 'נשמר ✓',
  psnBadHash: 'מזהה לא תקין — צריך 64 תווים הקסדצימליים',
  boardViewTitle: 'תצוגת לוח המחירים',
  boardViewHint:
    'משחק למחשב יכול להגיע ל־70 שורות (חנות אחת × 30 אזורים). כך ייראה הלוח כברירת מחדל:',
  keysEaNote:
    'הערה על EA App: חנות EA קובעת מחיר לפי מיקום גיאוגרפי ולא לפי כתובת האתר, ולכן אי אפשר לקרוא ממנה מחירים של מדינות אחרות בלי להתחזות למיקום אחר — דבר שהכלי הזה לא עושה. לכן EA App מוצגת כשורה אחת: המחיר שEA תגבה מכם בפועל. מחירי EA לפי אזור יתאפשרו רק דרך תוסף הדפדפן המתוכנן, שיקרא אותם מהחשבון שלכם. אם מוגדר מפתח IsThereAnyDeal, יופיעו גם הצעות EA App שנאספו דרכו.',
  boardViewNames: {
    collapse: 'מכווץ — שורה אחת לכל חנות (האזור הזול ביותר), עם אפשרות לפתוח',
    pinned: 'ישראל והמדינה שלי למעלה, השאר לפי מחיר',
    top: '12 ההצעות הזולות, עם כפתור להצגת השאר',
    full: 'הכל — כל השורות לפי מחיר',
  } as Record<string, string>,
  depSortLabel: 'מיון',
  depSortCheap: 'הזול ביותר',
  depSortRegion: 'לפי אזור',
  depSortOfficial: 'רשמי תחילה',
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
  /** Nothing found, and the query was already in English — nothing to suggest. */
  noResults: 'לא נמצאו תוצאות. בדקו את האיות, או נסו שם קצר יותר של המשחק.',
  /** Nothing found and the query was in Hebrew — the stores list games in English. */
  noResultsTryEnglish: 'לא נמצאו תוצאות. נסו את שם המשחק באנגלית — כך הוא רשום בחנויות.',
  /* ── Add-ons on a game's own page (DlcPanel) ───────────────────────────── */
  dlcSectionTitle: 'תוספות ו‑DLC למשחק',
  dlcLoading: 'מחפש תוספות בחנויות…',
  dlcNone: 'לא נמצאו תוספות למשחק הזה.',
  dlcFailed: 'לא הצלחנו לבדוק תוספות כרגע. נסו שוב בעוד רגע.',
  dlcNoOffers: 'לא נמצאו מחירים לתוספת הזו.',
  dlcOffersFailed: 'לא הצלחנו לטעון מחירים לתוספת הזו.',
  dlcExpand: 'הרחבה ⤢',
  dlcCollapse: 'הקטנה ⤡',
  dlcMore: (n: number) => `ועוד ${n} הצעות — לחצו על "הרחבה"`,
  exportCsv: '⤓ ייצוא לגיליון (CSV)',
  exportCsvHint:
    'קובץ CSV עם כל המחירים שנרשמו — שורה לכל בדיקה — שנפתח ישירות ב‑Excel או ב‑Google Sheets. הקובץ מיועד לניתוח, בעוד קובץ הייצוא הרגיל מיועד לייבוא חזרה לכלי.',
  includeDlcLabel: 'כולל תוספות ו‑DLC',
  includeDlcHint:
    'כברירת מחדל מוצגים משחקים בלבד. סמנו כדי לחפש גם הרחבות, פס עונה, חבילות מטבעות ותוספות אחרות — הן יסומנו בתווית.',
  dlcBadge: 'תוספת',
  searchSuggestLabel: 'הצעות חיפוש',
  searchRecent: 'חיפושים אחרונים',
  searchFailed: 'החיפוש נכשל — ייתכן שהשרת לא זמין. נסו שוב.',
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
  // Fuzzy store search is worth keeping — a typo has to find something — but
  // presenting a lookalike as if it were the game you asked for is not.
  relatedTitle: 'יכול להיות שהתכוונתם גם ל־',
  relatedOnlyTitle: 'לא נמצאה התאמה מדויקת — אלה תוצאות עם שם דומה',
  relatedHint: 'התוצאות האלה לא מכילות את כל המילים שחיפשתם, אבל הן דומות בשם.',
  // The bell is a place things pass through; this is the record. Clearing it is
  // deliberately harder, because unlike the bell it really is the last copy.
  logTitle: 'יומן התראות',
  logHint:
    'כל ההתראות שנשלחו, כולל כאלה שכבר נקראו או שנוקו מהפעמון. אם פספסתם התראה או ניקיתם את הפעמון בטעות — היא עדיין כאן.',
  logEmpty: 'עוד לא נשלחה אף התראה.',
  logCount: (n: number) => `${n} התראות ביומן`,
  logClear: 'מחיקת היומן — החזיקו 3 שניות',
  logClearHolding: 'ממשיכים להחזיק…',
  logCleared: 'היומן נמחק ✓',
  logClearNote:
    'המחיקה סופית ואין לה ביטול — זו הרשומה האחרונה של ההתראות. לכן צריך להחזיק את הכפתור שלוש שניות; שחרור באמצע מבטל.',
  // The bar exists because the wait is real and cannot be shortened — the slow
  // sources are the Israeli shops, held to a 2.5s gap on purpose. What it can
  // stop being is unexplained.
  searchProgressLabel: (done: number, total: number) => `נבדקו ${done} מתוך ${total} חנויות`,
  searchProgressCount: (done: number, total: number) => `${done}/${total} חנויות`,
  progressTitle: 'סרגל התקדמות בחיפוש',
  progressHint:
    'מראה כמה מהחנויות כבר ענו, והתוצאות מתעדכנות תוך כדי. החלק הכתום בסוף הסרגל הוא חנויות שלא הצלחנו להגיע אליהן — אותן חנויות שמופיעות בהתראה שמתחת.',
  progressShow: 'הצגת הסרגל',
  progressBlinkLabel: 'הבהוב האחוזים בסיום',
  progressBlinkHint: 'אם הגדרתם במערכת ההפעלה "הפחתת תנועה", ההבהוב כבוי ממילא.',
  sourcesUnavailable: 'חלק מהמקורות לא נבדקו בפעם הזו — ייתכן שחסרות הצעות:',
  sourceReasonError: 'לא זמין כרגע',
  sourceReasonRateLimited: 'ננוח מהחנות ונבדוק מאוחר יותר',
  sourcesRetryHint: 'נסו שוב עוד רגע — זו בעיה זמנית של המקור, לא של המשחק.',
  // Two dismissals, on purpose. A store can be down for a week, and the same
  // banner on every search for a week teaches people to ignore all of them.
  // There is no "never" — a permanently silenced source failing looks exactly
  // like a game not being sold, which is what this notice exists to prevent.
  sourcesDismissDay: 'הבנתי (לא להציג היום)',
  sourcesMuteOne: (name: string) => `השתיקו את ${name} עד שיחזור לספק נתונים`,
  sourcesMuteMany: (n: number) => `השתיקו את ${n} המקורות האלה עד שיחזרו לספק נתונים`,
  sourcesMutedTitle: 'מקורות שהשתקתם',
  sourcesMutedBody: (n: number) =>
    `${n} מקורות לא יציגו התראה כשהם לא זמינים, עד שיחזרו לענות. ברגע שמקור חוזר, ההשתקה שלו מתבטלת מעצמה.`,
  sourcesUnmuteAll: 'בטלו את כל ההשתקות',
  officialBadge: 'רשמי',
  launcherLabel: 'פלטפורמה',
  forRegionNote: (name: string) => `מוצג עבור האזור המועדף: ${name}. מחירים אצל ספקים חיצוניים עשויים להשתנות לפי אזור.`,
} as const;

export const platformNames: Record<Platform, string> = {
  pc: 'מחשב',
  ps5: 'PS5',
  ps4: 'PS4',
  xbox: 'Xbox',
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
