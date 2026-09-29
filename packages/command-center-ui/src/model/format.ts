/**
 * One formatting policy for the Founder surface: Arabic (Egypt) locale, Gregorian calendar, one numeral
 * system everywhere (`ar-EG` resolves Eastern Arabic digits; the choice is centralized here, never per
 * surface). Codes and IDs are LTR islands rendered by the caller with `dir="ltr"`.
 */
export const LOCALE = 'ar-EG-u-ca-gregory';

const numberFormat = new Intl.NumberFormat(LOCALE);
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });
const timeOnly = new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const fmtNumber = (n: number): string => numberFormat.format(n);
export const fmtMoneyMicros = (micros: number, currency: string): string => new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0, signDisplay: 'never' }).format(Math.max(0, Number.isFinite(micros) ? micros : 0) / 1_000_000);

/** Arabic counted nouns: 1 → singular, 2 → dual, 3–10 → plural, 11+ → singular accusative. Digits follow the locale. */
export function countNoun(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${fmtNumber(n)} ${forms.few}`;
  return `${fmtNumber(n)} ${forms.many}`;
}
export const fmtDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const fmtDate = (iso: string): string => dateOnly.format(new Date(iso));
export const fmtTime = (iso: string): string => timeOnly.format(new Date(iso));

export function fmtRelative(iso: string, nowMs = Date.now()): string {
  const diff = Date.parse(iso) - nowMs;
  const abs = Math.abs(diff);
  if (abs < 60_000) return relative.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return relative.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return relative.format(Math.round(diff / 3_600_000), 'hour');
  return relative.format(Math.round(diff / 86_400_000), 'day');
}

export const STATE_AR: Readonly<Record<string, string>> = {
  PROPOSED: 'مقترح',
  READY: 'جاهز',
  QUEUED: 'في الطابور',
  RUNNING: 'قيد التنفيذ',
  IN_PROGRESS: 'قيد التنفيذ',
  DELEGATED: 'مفوَّض',
  ACCEPTED: 'مقبول',
  REFUSED: 'مرفوض',
  REWORK: 'إعادة عمل',
  PASS: 'قبول',
  WAITING_REVIEW: 'ينتظر المراجعة',
  WAITING_APPROVAL: 'ينتظر الموافقة',
  BLOCKED: 'متوقف',
  COMPLETED: 'مكتمل',
  FAILED: 'فشل',
  CANCELLED: 'أُلغي',
  ACTIVE: 'نشط',
  PAUSED: 'موقوف مؤقتًا',
  APPROVED: 'معتمد',
  ACHIEVED: 'تحقق',
  DRAFT: 'مسودة',
  VACANT: 'شاغر',
  CANDIDATE: 'مرشح',
  TRAINING: 'في التدريب',
  SHADOW: 'ظل',
  PROBATION: 'تحت الاختبار',
  ON_LEAVE: 'في إجازة',
  RETRAINING: 'إعادة تدريب',
  SUSPENDED: 'موقوف',
  RETIRED: 'متقاعد',
  PENDING: 'معلّق',
  OPEN: 'مفتوح',
  RESOLVED: 'محلول',
};

export const LANE_AR: Readonly<Record<string, string>> = { NEEDS_ME: 'يحتاجني', CEO_BRIEFS: 'موجزات المدير التنفيذي', THREADS: 'محادثاتي' };
export const LEVEL_AR: Readonly<Record<string, string>> = { INFORMATIONAL: 'للعلم', NEEDS_ATTENTION: 'يحتاج انتباهًا', NEEDS_DECISION: 'يحتاج قرارًا', URGENT: 'عاجل' };
export const SOURCE_AR: Readonly<Record<string, string>> = { APPROVAL: 'موافقة', STAFFING_REQUEST: 'طلب توظيف', ESCALATION: 'تصعيد', REVIEW_CONFLICT: 'خلاف مراجعة', BRIEF: 'موجز', THREAD: 'محادثة', GOAL: 'هدف', DECISION_REQUEST: 'طلب قرار' };
export const RELATION_AR: Readonly<Record<string, string>> = { DELEGATION: 'تفويض عمل', SUPPORT: 'دعم', REVIEW: 'مراجعة', APPROVAL: 'موافقة', HANDOFF: 'استيضاح', ESCALATION: 'تصعيد' };
export const KIND_AR: Readonly<Record<string, string>> = { CEO: 'المدير التنفيذي', DIRECTOR: 'مدير قسم', MANAGER: 'مدير', LEAD: 'قائد', SPECIALIST: 'متخصص', FOUNDER: 'المؤسس' };
export const PURPOSE_AR: Readonly<Record<string, string>> = { REQUEST: 'طلب', QUESTION: 'سؤال', FYI: 'للعلم', REVIEW: 'مراجعة', DECISION_REQUEST: 'طلب قرار', BLOCKER: 'عائق', ESCALATION: 'تصعيد', RESULT: 'نتيجة', CORRECTION: 'تصحيح', BRIEF: 'موجز' };

/** The five canonical Departments (release-seeded with English names) in the Founder's language. */
export const DEPT_NAME_AR: Readonly<Record<string, string>> = {
  'strategic-market-intelligence': 'استخبارات السوق الاستراتيجية',
  growth: 'النمو',
  'brand-creative': 'العلامة والإبداع',
  product: 'المنتج',
  engineering: 'الهندسة',
};
export const deptName = (code: string, name: string): string => DEPT_NAME_AR[code] ?? name;

/** Approval actions as the Founder reads them; an unknown action code stays an LTR island. */
export const ACTION_AR: Readonly<Record<string, string>> = {
  'work_item.execute': 'تنفيذ بند عمل',
  'work_item.release': 'إطلاق بند عمل',
  'tool.invoke': 'استدعاء أداة',
  'budget.change': 'تغيير غلاف مالي',
  'employee.activate': 'تفعيل موظف',
};

/**
 * Arabic titles for the release-seeded canonical seats (their stored titles are the C4 English codes' names).
 * A seat created by the Founder keeps the title it was given; this table never renames it.
 */
export const SEAT_TITLE_AR: Readonly<Record<string, string>> = {
  'company.ceo': 'المدير التنفيذي',
  'director.strategic-market-intelligence': 'مدير إدارة استخبارات السوق',
  'director.growth': 'مدير إدارة النمو',
  'director.brand-creative': 'مدير إدارة العلامة والإبداع',
  'director.product': 'مدير إدارة المنتج',
  'director.engineering': 'مدير إدارة الهندسة',
  'product.app-store-release-reputation-lead': 'قائد إصدارات المتجر والسمعة',
};

/** Founder command intents in the Founder's words (the activity strip and the preview name the act, never its code). */
export const INTENT_AR: Readonly<Record<string, string>> = {
  RETURN_TO_LIVE: 'العودة إلى الحيّ',
  WHO_WORKS_ON: 'من يعمل على',
  WHAT_IS_BLOCKED: 'ما المتوقف',
  NEEDS_MY_APPROVAL: 'ما يحتاج موافقتي',
  SHOW_BRIEFS: 'عرض الموجزات',
  SHOW_TIMELINE: 'عرض خط الزمن',
  SHOW_CEO: 'فتح المدير التنفيذي',
  SHOW_GOAL: 'فتح هدف',
  SHOW_DEPARTMENT: 'فتح إدارة',
  OPEN_EMPLOYEE: 'فتح موظف',
  APPROVAL_DECIDE: 'قرار في طلب موافقة',
  GOAL_APPROVE: 'اعتماد هدف',
  GOAL_STATE: 'تغيير حالة هدف',
  GOAL_PROPOSE: 'اقتراح هدف',
  STAFFING_DECIDE: 'قرار في طلب توظيف',
  CONFLICT_RESOLVE: 'حسم خلاف مراجعة',
  BUDGET_CEILING: 'رفع سقف غلاف مالي',
  DELEGATE_WORK: 'تفويض صلاحية',
};

/** Preview payload fields in the Founder's words; unknown fields keep their code as an LTR island. */
export const FIELD_AR: Readonly<Record<string, string>> = {
  approvalId: 'طلب الموافقة',
  decision: 'القرار',
  reasonCode: 'رمز السبب',
  goalId: 'الهدف',
  activate: 'تفعيل فوري',
  to: 'الحالة الجديدة',
  budgetId: 'الغلاف المالي',
  capMoney: 'السقف المالي',
  capTokens: 'سقف الرموز',
  currency: 'العملة',
  scope: 'النطاق',
  scopeId: 'صاحب الغلاف',
  requestId: 'طلب التوظيف',
  conflictId: 'الخلاف',
  resolution: 'الحسم',
  employeeId: 'الموظف',
  capability: 'الصلاحية',
  expiresAt: 'ينتهي في',
  purposeCode: 'الغرض',
};

export const ar = (table: Readonly<Record<string, string>>, code: string): string => table[code] ?? code;
