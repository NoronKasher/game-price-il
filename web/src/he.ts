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
  dealsTab: 'מבצעים',
  // The deals page: the same feed as the strip at the top, standing still.
  dealsTitle: 'מבצעים היום',
  dealsIntro:
    'המבצעים שרצים בסרגל שלמעלה, בלי לרוץ. לחיצה על משחק מריצה עליו חיפוש מלא בכל החנויות — המחיר כאן הוא של חנות אחת, והשוואה היא כל מה שהכלי הזה עושה.',
  dealsLoading: 'טוען מבצעים…',
  dealsEmpty: 'אין מבצעים להצגה כרגע.',
  dealsFailed: 'לא הצלחנו לטעון את המבצעים. אפשר לנסות שוב מאוחר יותר.',
  dealsSort: { discount: 'לפי אחוז הנחה', price: 'לפי מחיר', rating: 'לפי דירוג שחקנים' } as Record<string, string>,
  dealsCardHint: 'לחצו כדי להשוות את המחיר בכל החנויות',
  dealsLoadingMore: 'טוען עוד מבצעים…',
  dealsEnd: (n: number) => `זהו — ${n} מבצעים, וזה כל מה שהמקורות מציעים כרגע.`,
  dealsRating: (pct: number) => `${pct}% משוב חיובי בסטים`,
  dealsNote:
    'המבצעים מגיעים משלושה ממשקים פומביים: CheapShark (עשרות חנויות מחשב), המבצעים של Steam לישראל (מחירים בשקלים, ישירות מ‑Steam, בלי המרה), והקטלוג המוזל של GOG. אף אחד מהם לא נסרק — כולם ממשקים שנועדו לשימוש. מחירים שאינם בשקלים הומרו לפי שער יציג.',
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
    'זוהי ברירת המחדל לכל המשחקים ברשימת המעקב. לכל משחק אפשר לקבוע התראות ספציפיות (או להשתיק אותו) מתוך הפאנל שנפתח בלחיצה על שם המשחק.',
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
  alertModeGlobal: 'לפי ברירת מחדל',
  alertModeCustom: 'ספציפיות למשחק זה',
  alertModeOff: 'כבוי (לא להתריע)',
  alertScopeUseGlobal: (name: string) => `לפי ברירת מחדל (${name})`,
  alertPctLabel: 'כשיש הנחה של',
  alertPriceLabel: 'או כשהמחיר יורד ל־',
  alertNote:
    'נבדק עם כל עדכון מחיר, ומתריע רק כשהמחיר חוצה את הסף מחדש — כדי שמשחק שנשאר במבצע לא יציק בכל בדיקה.',
  alertGlobalSummary: (rule: string) => `ברירת המחדל כרגע: ${rule}`,
  alertOffNote: 'המשחק הזה מושתק — לא יישלחו עליו התראות.',
  alertRowCustom: 'התראות ספציפיות למשחק זה',
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
  currencyWideLabel: 'הציגו גם מטבעות שאף חנות לא גובה בהם',
  currencyWideHint:
    'פותח עוד עשרות מטבעות להמרה. ההגדרה נשמרת גם בקוד ההעברה למכשיר אחר.',
  currencyWideWarn:
    '⚠️ שימו לב: מטבעות מהרשימה המורחבת הם המרה שלנו מהמחיר בשקלים, ולא מחיר שחנות כלשהי תגבה בפועל. הם שימושיים כדי להבין סדר גודל, אבל אין חנות בכלי שמוכרת בהם — ולכן ייתכנו הפרשי עיגול או תצוגה. הרשימה לא כוללת מטבעות של מדינות שאין אליהן מסלול רכישה חוקי מישראל.',
  currencyPrimary: 'מטבע ראשי',
  currencySecondary: 'מטבע נוסף לצד הראשי',
  currencyNoSecond: '— בלי מטבע נוסף —',
  currencySample: (example: string) => `כך ייראה מחיר בכלי: ${example}`,
  currencyHint: 'כל המחירים בכלי יוצגו במטבע הזה. המחירים נאספים ונשמרים בשקלים ומומרים לתצוגה לפי שער יציג.',
  currencySettingsNote:
    'הכפתור ₪ / $ / € שבראש העמוד מחליף בין שלושת המטבעות הנפוצים. כאן אפשר לבחור כל מטבע אחר — למשל לראות מחיר טורקי בלירות או אוקראיני בהריבניה, כפי שהחנות עצמה תגבה. אפשר גם להוסיף מטבע שני שיוצג בסוגריים לצד הראשון, כדי לראות את שניהם יחד. המחירים תמיד נאספים ונשמרים בשקלים ומומרים לתצוגה לפי שער יציג.',
  // General preferences (settings page)
  generalTitle: 'העדפות כלליות',
  defaultCountryLabel: 'מדינה מועדפת כברירת מחדל',
  defaultCountryNote:
    'האזור שנבחר כאן נצמד לראש כל השוואת מחירים ומשמש כבסיס לחיסכון. אפשר גם לשנות אותו תוך כדי צפייה במשחק.',
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
  // Three of the values in the region column are not regions: they say why the
  // row HAS no region. Left unexplained, "ישיר" in a column headed "אזור" reads
  // as a region nobody has heard of.
  depRegionHint: (name: string) => `המחיר בחנות של ${name}. רכישה מאזור אחר דורשת חשבון באותו אזור.`,
  depDirectHint:
    'רכישה ישירה מהחנות עצמה, בלי אזור מסוים — המחיר זהה מכל מקום והמשחק נכנס ישר לספרייה שלכם, בלי קוד הפעלה.',
  depKeyHint:
    'קוד הפעלה שנמכר על ידי מוכר צד שלישי, ולא על ידי החנות עצמה. אין לו אזור, אבל יש לוודא באיזו פלטפורמה הקוד מופעל.',
  depDiscHint: 'עותק פיזי — דיסק או קלטת. אין לו אזור מחיר; זה פשוט מה שהחנות מבקשת עליו.',
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
  statsTrackThis: '➕ עקבו אחרי המשחק הזה',
  statsTracked: '✓ המשחק במעקב — המחירים נרשמים אוטומטית',
  statsNoHistory: 'אין עדיין היסטוריית מחירים למשחק הזה. הוסיפו אותו למעקב כדי להתחיל לאסוף.',
  // What an outside tracker has on record — years we were not watching. Always
  // attributed, and always beside the original currency, because the shekel
  // figure is today's rate on a price paid long ago.
  statsEverLow: 'הנמוך ביותר אי־פעם',
  statsEverLowSource: (original: string, source: string) => `${original} · לפי ${source}`,
  lowWindows: { all: 'אי־פעם', y1: 'בשנה האחרונה', m3: 'בשלושת החודשים האחרונים' } as Record<string, string>,
  statsEverLowTitle: (source: string, others: string[]) =>
    [
      `השפל שנרשם אצל ${source} מאז שהם עוקבים אחרי המשחק — לא בהכרח מחיר שהיה זמין בישראל.`,
      'הסכום בשקלים הוא המרה לפי שער היום של מחיר שנרשם בעבר, ולא מה ששילמו עליו אז.',
      ...(others.length ? [`שפל בחלונות קצרים יותר — ${others.join(' · ')}`] : []),
    ].join('\n'),
  // The tip jar. One line, no banner — see support.ts.
  // ALPHA — suggestions from what the user actually plays.
  advisorTab: 'המלצות',
  advisorTitle: 'מה כדאי לכם, לפי מה שאתם באמת משחקים',
  advisorAlpha: 'אלפא',
  advisorWarning:
    '⚠️ פיצ׳ר בשלב אלפא. הוא מבוסס על היוריסטיקה פשוטה — התאמת ז׳אנרים משוקללת לפי שעות משחק — וייתכן שיציע שטויות. אם לא יעבוד מספיק טוב, הוא יוסר. אל תסמכו עליו כמו על לוח המחירים, שהוא מדויק בהגדרה.',
  advisorIntro:
    'הכלי קורא אילו משחקים יש לכם ב‑Steam וכמה שיחקתם בכל אחד, בונה מזה פרופיל ז׳אנרים, ומצליב אותו מול המבצעים של היום. מה שהוא לא יכול לדעת: אם נהניתם. ל‑Steam אין ממשק לביקורות שכתבתם, ולכן שעות משחק משמשות כתחליף ל"אהבתי" — הנחה שנכונה לרוב ופשוט שגויה למשחק שנטשתם אחרי גריינד ארוך.',
  advisorProfileLabel: 'פרופיל Steam',
  advisorProfilePlaceholder: 'קישור לפרופיל, שם משתמש, או SteamID64',
  advisorKeyNote:
    'דורש מפתח Steam API (חינמי, נרשם בדקה ב‑steamcommunity.com/dev/apikey ומוזן בהגדרות). Steam סגר את הגישה לרשימת המשחקים בלי מפתח, כך שאין דרך אחרת. הספרייה שלכם לא נשמרת בשום מקום ולא נשלחת לאף אחד.',
  advisorRun: 'בנו לי המלצות',
  advisorRunning: 'עובד…',
  advisorFoundLibrary: (n: number) => `נמצאו ${n} משחקים בספרייה. בונה פרופיל…`,
  advisorProfiling: (done: number, total: number, title: string) =>
    `בודק ז׳אנרים — ${done} מתוך ${total}${title ? ` · ${title}` : ''}`,
  advisorScoring: (done: number, total: number) => `מצליב מול המבצעים — ${done} מתוך ${total}`,
  advisorTasteTitle: 'הז׳אנרים שאתם משחקים בפועל',
  advisorHours: (hours: number, games: number) => `${hours} שעות · ${games} משחקים`,
  advisorPicksTitle: 'מבין המבצעים של היום',
  advisorNone:
    'לא נמצאה התאמה טובה במבצעים של היום. זה לא אומר שאין מה לקנות — רק שאף אחד מהם לא מתאים מספיק למה שאתם משחקים כדי שנמליץ עליו.',
  advisorFoot:
    'ההמלצות מגיעות רק מהמבצעים של היום, בכוונה: כלי השוואת מחירים שממליץ על משחק במחיר מלא הוא מגזין.',
  advisorErrors: {
    steam_key_missing: 'לא הוגדר מפתח Steam API. אפשר להוסיף אותו בהגדרות → מפתחות API.',
    steam_profile_private: 'רשימת המשחקים בפרופיל הזה פרטית. אפשר לשנות ב‑Steam: Privacy Settings → Game details → Public.',
    steam_profile_not_found: 'לא מצאנו פרופיל בשם הזה. נסו את הקישור המלא לפרופיל.',
    no_profile: 'צריך פרופיל Steam כדי להתחיל.',
    demo: 'ההמלצות לא זמינות בהדגמה — הן דורשות מפתח וספרייה אמיתית.',
    unreachable: 'אין חיבור לשרת של הכלי.',
    failed: 'משהו השתבש. אפשר לנסות שוב.',
  } as Record<string, string>,
  // Reporting a bug, asking for a change, suggesting a feature.
  contactTab: 'צרו קשר',
  contactTitle: 'דיווח על תקלה, בקשה או רעיון',
  contactIntro:
    'מצאתם באג? חסר לכם משהו? יש רעיון? כתבו כאן, והכלי יכין את הדיווח ויפתח אותו מוכן לשליחה ב‑GitHub — בלי צורך בתוכנת דואר. אם אין לכם חשבון GitHub, יש גם קישור למייל בתחתית.',
  contactKinds: { bug: 'תקלה', idea: 'רעיון', question: 'שאלה' } as Record<string, string>,
  contactKindHints: {
    bug: 'משהו לא עובד או מציג נתון שגוי. הכי עוזר: מה חיפשתם, מה ציפיתם לראות, ומה ראיתם בפועל.',
    idea: 'פיצ׳ר שהייתם רוצים, או שינוי במשהו קיים. כתבו גם למה — מה זה יפתור עבורכם.',
    question: 'לא בטוחים איך משהו עובד, או למה הכלי מציג משהו מסוים. אין שאלה טיפשית.',
  } as Record<string, string>,
  contactSubject: 'כותרת',
  contactSubjectPlaceholder: {
    bug: 'למשל: Diablo 4 מופיע פעמיים בתוצאות',
    idea: 'למשל: התראה כשמשחק נכנס למבצע בחנות מסוימת',
    question: 'למשל: למה המחיר בטורקיה שונה ממה שאני רואה בחנות?',
  } as Record<string, string>,
  contactBody: 'פירוט',
  contactBodyPlaceholder: {
    bug: 'מה חיפשתם, מה ציפיתם, ומה קרה בפועל. אם יש צילום מסך — אפשר לצרף אותו ב‑GitHub אחרי שהדיווח ייפתח.',
    idea: 'מה הייתם רוצים שיקרה, ומתי זה היה עוזר לכם.',
    question: 'מה לא ברור?',
  } as Record<string, string>,
  contactAttach: 'צרפו דוח אבחון (עוזר מאוד לדיווח על באג)',
  contactAttachLoading: 'מכין דוח אבחון…',
  contactAttachHint:
    'הדוח כולל את מצב מקורות המחיר ושגיאות שקרו בהפעלה הזו. הוא לא כולל מפתחות API, מחירים, הערות או את רשימת המשחקים שלכם.',
  contactDiagNote: 'זה בדיוק מה שיצורף. אפשר לקרוא ולוודא לפני השליחה:',
  contactDiagFailed: 'לא הצלחנו להפיק דוח אבחון. אפשר לשלוח את הדיווח בלעדיו.',
  contactViaGithub: 'פתיחת דיווח ב‑GitHub ←',
  contactViaMail: 'או שליחה במייל',
  contactReady: 'הדיווח מוכן. הלחיצה תפתח לשונית חדשה עם הכול כבר ממולא — עדיין תצטרכו ללחוץ על Submit.',
  contactNeedMore: 'מלאו כותרת ופירוט קצר כדי להמשיך.',
  contactPublicNote:
    '⚠️ דיווח ב‑GitHub הוא ציבורי וכל אחד יכול לקרוא אותו. אל תכתבו בו פרטים אישיים.',
  contactTooLong:
    'הדיווח ארוך מדי כדי להיפתח דרך קישור. קצרו את הפירוט, או הסירו את דוח האבחון וצרפו אותו ידנית אחרי הפתיחה.',
  // Jumping to a setting, and finding one by name.
  setNavLabel: 'ניווט בהגדרות',
  setNavSearch: 'חיפוש הגדרה…',
  setNavNone: (q: string) => `לא נמצאה הגדרה שמתאימה ל"${q}"`,
  // The diagnostic export — "הוראות הפעלה" and what the file does and does not hold.
  diagTitle: 'אבחון ותמיכה',
  diagHowtoTitle: 'הוראות הפעלה',
  diagSteps: [
    'אם משהו לא עובד כמו שצריך — למשל משחק שמופיע פעמיים, חנות שלא מחזירה מחירים, או תוצאה מוזרה — כתבו בשדה שלמטה בדיוק את מה שחיפשתם כשזה קרה.',
    'לחצו על "הפקת דוח". הדוח כולל את מצב כל מקורות המחיר, שגיאות שקרו בהפעלה הזו, וגם — אם מילאתם חיפוש — איך בדיוק הכלי קיבץ את התוצאות, וזה מה שמסביר כפילויות.',
    'לחצו "העתקה" או "הורדת קובץ", ושלחו את התוכן יחד עם תיאור קצר של מה שציפיתם שיקרה.',
    'אם הבעיה חוזרת רק לפעמים — הפיקו את הדוח מיד אחרי שהיא קורית. רשומת השגיאות נמחקת עם סגירת הכלי.',
  ] as string[],
  diagPrivacy:
    '🔒 מה שהדוח לא כולל: מפתחות API, מחירים, ההערות שכתבתם, ורשימת המשחקים שלכם. הוא מציין רק כמה משחקים יש ברשימה, לא אילו. שמות משחקים מופיעים אך ורק בתוך דוגמת החיפוש שביקשתם — כלומר רק מה שחיפשתם בעצמכם עכשיו.',
  diagQueryLabel: 'חיפוש לבדיקה (לא חובה)',
  diagQueryPlaceholder: 'למשל: diablo 4 — השם שגרם לבעיה',
  diagRun: 'הפקת דוח',
  diagRunning: 'מפיק…',
  diagCopy: 'העתקה',
  diagCopied: 'הועתק ✓',
  diagDownload: 'הורדת קובץ',
  diagSize: (kb: number) => `${kb}KB`,
  diagFailed: 'לא הצלחנו להפיק דוח. ודאו שהשרת של הכלי פועל.',
  supportFooter: 'הכלי חינמי וללא פרסומות. אם בא לכם לתמוך:',
  supportTitle: 'תמיכה בכלי',
  supportIntro:
    'הכלי חינמי, קוד פתוח, ורץ אצלכם במחשב — אין שרת לתחזק ואין שום דבר נעול מאחורי תשלום. אם בא לכם להשאיר טיפ, זה המקום. אם לא, הכול עובד בדיוק אותו הדבר. מה שלא יהיה כאן לעולם: קישורי שותפים. קישור שמשלם לנו לפי הקלקה ייתן לנו סיבה להעדיף מוכר מסוים, וסדר התוצאות הוא כל מה שהכלי הזה הוא.',
  // Whether the deals strip scrolls. A visible switch rather than an inference
  // from the OS — see prefs.loadTickerMotion.
  tickerMotionTitle: 'סרגל המבצעים',
  tickerMotionLabel: 'הזיזו את סרגל המבצעים שבראש העמוד',
  tickerMotionIntro:
    'הסרגל שבראש העמוד גולל את מבצעי היום בלולאה רציפה. אפשר לעצור אותו — כשהוא עצור אפשר לגלול אותו ביד, וכל המבצעים עדיין שם.',
  tickerMotionHint:
    'ברירת המחדל נקבעת לפי הגדרת האנימציות של המערכת שלכם, אבל הבחירה כאן גוברת עליה תמיד.',
  // Turning the explanatory notices off for good — different from dismissing
  // one, which means "not this one, for now".
  quietTitle: 'הודעות הסבר',
  quietLabel: 'אל תציגו הודעות על חנויות חסרות ועל רכישה מאזור אחר',
  quietIntro:
    'הכלי מסביר כשחנות לא זמינה, וכשמחיר מאזור אחר דורש חשבון באותו אזור. אם כבר ברור לכם איך זה עובד, אפשר לכבות את ההסברים האלה לגמרי — הנתונים עצמם לא משתנים, רק ההודעות נעלמות.',
  quietHint:
    'ההגדרה הזו נשמרת גם בקוד ההעברה למכשיר אחר, יחד עם כל הודעה שסגרתם לתמיד.',
  // The bundle checker. The one comparison a shop will never show you, because
  // it depends on what you already own.
  bundlesTitle: (n: number) => (n === 1 ? 'המשחק נמכר גם בחבילה' : `המשחק נמכר גם ב־${n} חבילות`),
  bundlesIntro:
    'סמנו מה כבר יש לכם, והכלי יחשב כמה יעלה לקנות רק את מה שחסר — לעומת מחיר החבילה. החנויות מציגות את ההנחה על החבילה המלאה, וזו לא בהכרח ההשוואה שלכם. הסימון נשמר אצלכם ונוסע עם קוד ההעברה.',
  bundleNoSolo: 'לא נמכר בנפרד',
  bundleAllOwned: 'כבר יש לכם את כל המשחקים בחבילה הזו.',
  bundleNoneOwned: (sep: string) => `בנפרד כל המשחקים עולים ${sep}`,
  bundleSome: (owned: number, sep: string) =>
    owned === 1 ? `יש לכם כבר משחק אחד. מה שחסר עולה בנפרד ${sep}` : `יש לכם כבר ${owned}. מה שחסר עולה בנפרד ${sep}`,
  // Nothing that is left can be bought on its own, so there is no comparison.
  bundleOnlyWay: (n: number) =>
    n === 1
      ? 'המשחק שנותר לא נמכר בנפרד — החבילה היא הדרך היחידה לקבל אותו.'
      : `${n} המשחקים שנותרו לא נמכרים בנפרד — החבילה היא הדרך היחידה לקבל אותם.`,
  bundleSaves: (amount: string) => `החבילה זולה ב־${amount} ✓`,
  bundleCosts: (amount: string) => `קנייה בנפרד זולה ב־${amount}`,
  // Plural-aware: Hebrew does not let one form carry both, and "X, Y ו־Z לא
  // נמכר בנפרד" reads as a mistake to anybody who speaks it.
  bundleFloor: (titles: string[]) =>
    titles.length === 1
      ? `שימו לב: ${titles[0]} לא נמכר בנפרד, ולכן הסכום הזה הוא מינימום ולא מחיר מלא`
      : `שימו לב: ${titles.join(', ')} לא נמכרים בנפרד, ולכן הסכום הזה הוא מינימום ולא מחיר מלא`,
  // A note about one game, in the user's own words and formatting. Behind a
  // checkbox so a list nobody has annotated stays a list of games.
  noteAdd: '📝 הוסיפו הערה למשחק הזה',
  noteEdit: '📝 עריכת ההערה',
  noteAria: 'הערה אישית למשחק',
  notePlaceholder: 'למה אתם עוקבים אחרי המשחק הזה? "לחכות למהדורת GOTY", "מתנה לדנה", כל דבר.',
  noteSave: 'שמירה',
  noteSaving: 'שומר…',
  noteSaved: 'נשמר ✓',
  noteDelete: 'מחיקה',
  noteDeleteConfirm: 'למחוק את ההערה? אין דרך לשחזר אותה.',
  noteColor: 'צבע טקסט',
  noteSize: 'גודל',
  noteSizeSmall: 'קטן',
  noteSizeNormal: 'רגיל',
  noteSizeBig: 'גדול',
  noteImage: 'הוספת תמונה או GIF',
  noteImageTooBig: (kb: number) => `התמונה גדולה מדי. המקסימום הוא ${kb}KB — נסו תמונה קטנה יותר.`,
  noteHint:
    'ההערה נשמרת אצלכם בלבד, ונוסעת יחד עם רשימת המעקב בייצוא ובקוד ההעברה. אפשר להשתמש באימוג’י של המקלדת (Win+נקודה בווינדוס) ולהדביק או לגרור תמונות.',
  // The automatic first price check for rows that arrived without one.
  firstCheckRunning: (done: number, total: number) =>
    `בודקים מחירים ראשונים למשחקים שנוספו — ${done} מתוך ${total}`,
  // The whole tracked list as one pasteable string. Lives in Settings because
  // it is about the installation, not about the games on any one page.
  tokenTitle: 'העברת הנתונים למכשיר אחר',
  tokenIntro:
    'יצירת קוד אחד שמכיל את כל רשימת המעקב שלכם — כולל היסטוריית המחירים שנאספה. מעתיקים אותו, מדביקים בכלי במכשיר אחר, והכול עובר. שימושי במיוחד למעבר בין התוסף לאפליקציית שולחן העבודה, או כשאין נוחות בהורדה והעלאה של קובץ.',
  tokenMake: 'צרו קוד',
  tokenWithHistory: 'כולל היסטוריית מחירים',
  tokenHistoryHint:
    'ההיסטוריה היא רוב אורך הקוד — בערך פי תשעה. בלעדיה עוברת רק רשימת המשחקים וההגדרות שלהם.',
  tokenCopy: 'העתקה',
  tokenCopied: 'הועתק ✓',
  tokenLength: (n: number) => `${n.toLocaleString('he-IL')} תווים`,
  tokenLoadTitle: 'טעינת קוד ממכשיר אחר',
  tokenPastePlaceholder: 'הדביקו כאן קוד שמתחיל ב־VGPT1-',
  tokenLoad: 'טעינה',
  tokenWorking: 'טוען…',
  tokenImported: (games: number, points: number, prefs: number, settings: number) => {
    const extras = [
      prefs > 0 ? `${prefs} העדפות תצוגה` : '',
      settings > 0 ? `${settings} הגדרות` : '',
    ].filter(Boolean);
    const tail = extras.length ? `, וגם ${extras.join(' ו־')}` : '';
    return `נטענו ${games} משחקים ו־${points} רישומי מחיר${tail}. מה שכבר היה כאן לא נמחק. רעננו את העמוד כדי לראות את ההגדרות החדשות.`;
  },
  tokenBad: 'זה לא נראה כמו קוד שלנו. ודאו שהעתקתם את כולו — הוא מתחיל ב־VGPT1-.',
  tokenFailed: 'משהו השתבש. אפשר לנסות שוב.',
  tokenNote:
    'הקוד דחוס אבל לא מוצפן — מי שמחזיק בו יכול לקרוא ממנו את הרשימה. אין בו שום דבר אישי מעבר לשמות המשחקים ולמחירים שנאספו, והוא לא נשלח לשום מקום: הוא נוצר אצלכם במכשיר ונשאר שם עד שתעבירו אותו בעצמכם. טעינה מוסיפה על מה שכבר יש ולא מוחקת כלום.',
  // A Hebrew query, translated before the stores were asked. Never silent: the
  // catalogues are all English, so the tool searched for something other than
  // what was typed, and the user has to be able to see and correct that.
  searchedAs: (query: string) => `חיפשנו באנגלית: ${query}`,
  searchedAsDropped: (words: string[]) =>
    words.length === 1
      ? `המילה "${words[0]}" לא מוכרת לנו ולכן הושמטה`
      : `המילים ${words.map((w) => `"${w}"`).join(', ')} לא מוכרות לנו ולכן הושמטו`,
  // Steam wishlist import. The wait is real (Valve retired the bulk app list,
  // so every title is its own spaced request), so the copy says so rather than
  // letting a three-minute spinner look like a hang.
  steamImportButton: '🎮 ייבוא רשימת משאלות מ‑Steam',
  steamImportTitle: 'ייבוא רשימת המשאלות שלכם מ‑Steam',
  steamImportIntro:
    'הדביקו קישור לפרופיל Steam שלכם (או את שם המשתמש). הכלי יקרא את רשימת המשאלות הפומבית דרך ה‑API הרשמי של Valve ויוסיף את המשחקים למעקב. לא נדרשת התחברות ולא נשמרת שום סיסמה.',
  steamImportPlaceholder: 'https://steamcommunity.com/id/שם-המשתמש',
  steamImportGo: 'ייבוא',
  steamImportWorking: 'מייבא…',
  steamImportStep: (done: number, total: number) => `${done} מתוך ${total}`,
  steamImportNote:
    'הייבוא איטי בכוונה: Valve סגרה את הממשק שמחזיר שמות של הרבה משחקים בבת אחת, ולכן כל כותרת נקראת בבקשה קטנה נפרדת עם רווח ביניהן. רשימה של 80 משחקים תיקח כמה דקות. אפשר להריץ שוב בכל עת — מה שכבר במעקב מדולג בלי בקשה נוספת.',
  steamImportDone: (r: { added: number; skipped: number; nonGames: number; unresolved: number }) => {
    const parts = [r.added === 1 ? 'משחק אחד נוסף למעקב' : `${r.added} משחקים נוספו למעקב`];
    if (r.skipped > 0) parts.push(`${r.skipped} כבר היו ברשימה`);
    if (r.nonGames > 0) parts.push(`${r.nonGames} תוספות/דמו דולגו`);
    if (r.unresolved > 0) parts.push(`${r.unresolved} לא נמצאו בחנות`);
    return parts.join(' · ');
  },
  steamImportError: {
    profile: 'לא הצלחנו לזהות פרופיל Steam מהכתובת הזו. נסו את הקישור המלא לפרופיל, למשל https://steamcommunity.com/id/שם-המשתמש',
    empty:
      'לא קיבלנו משחקים מהפרופיל הזה. או שרשימת המשאלות ריקה, או שהיא מוגדרת כפרטית — Steam מחזיר את אותה תשובה לשני המקרים. אפשר לשנות את הפרטיות בהגדרות הפרופיל ב‑Steam ולנסות שוב.',
    failed: 'הייבוא נכשל. ייתכן ש‑Steam לא זמין כרגע — אפשר לנסות שוב בעוד כמה דקות.',
    demo: 'הדגמה מציגה צילום מוקלט של נתונים ואין לה לאן לשמור. התקינו את התוסף או הריצו את הכלי מקומית כדי לייבא באמת.',
  } as Record<string, string>,
  // Already covered by a subscription. Phrased as a fact about the catalogue,
  // never as a claim about this buyer's cost: they may not subscribe, and the
  // subscription is not free even when the game is.
  includedHead: 'המשחק כלול במנוי',
  includedNote: 'לפי הקטלוג הישראלי הנוכחי. משחקים נכנסים ויוצאים מהמנויים — בדקו לפני שאתם מוותרים על רכישה.',
  includedTitle:
    'רשימות המנויים נקראות ישירות מהקטלוג הרשמי של מיקרוסופט, עבור השוק הישראלי בלבד.\nזה לא אומר שהמשחק חינם — הוא כלול במנוי בתשלום, ורק אם יש לכם אותו.',
  includedAck: 'הבנתי — אל תתריעו לי על המשחק הזה שוב',
  includedAcked: '✓ לא נתריע יותר על המשחק הזה',
  // The Settings switch that turns the subscription alerts on. Off by default:
  // most people do not subscribe, and telling them a game is free with a
  // subscription they do not have is noise dressed as a saving.
  gpAlertsTitle: 'התראות על משחקים שכלולים במנוי',
  gpAlertsLabel: 'הודיעו לי כשמשחק שחיפשתי כבר כלול במנוי',
  gpAlertsIntro:
    'כשהאפשרות הזו דולקת, פתיחת משחק שנמצא בקטלוג של Xbox Game Pass, PC Game Pass או EA Play תיצור התראה בפעמון וברשומות שבהגדרות. אפשר לאשר לכל משחק בנפרד שהבנתם — ואז הוא לא יתריע יותר. הסימון הירוק בלוח המחירים מוצג תמיד, בלי קשר להגדרה הזו.',
  gpAlertsHint:
    'כבוי כברירת מחדל: אם אין לכם מנוי, "כלול במנוי" הוא לא חיסכון אלא רעש. ההגדרה נשמרת גם בקוד ההעברה למכשיר אחר.',
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
  /** The same option, naming the region that is actually selected. */
  boardViewPinned: (region: string) =>
    region
      ? `${region} (ברירת המחדל) למעלה, והשאר בסדר עולה מהזול ליקר`
      : 'המדינה שבברירת המחדל למעלה, והשאר בסדר עולה מהזול ליקר',
  boardViewNames: {
    collapse: 'מכווץ — שורה אחת לכל חנות (האזור הזול ביותר), עם אפשרות לפתוח',
    // Named with the region actually chosen, because "המדינה שלי" is a label
    // for a setting the reader cannot see from here.
    pinned: 'המדינה שבברירת המחדל למעלה, והשאר בסדר עולה מהזול ליקר',
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
  progressShow: 'הצג את סרגל טעינת החנויות',
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
  // Not a console: a row whose platform we genuinely do not know.
  other: 'אחר',
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
