/**
 * P1-EMPLOYEE-BASELINE-01 (D-P1-10): the Founder Attention card's own words, in Arabic — the card's kind, its one-line ask
 * and a brief's headings. Fixed text per case (never a model call), with the dynamic data (names, titles, risk codes,
 * amounts) inserted as separate parts exactly as they are. Only these card texts are Arabic: the panel title, the lane tabs,
 * every button and action, the rest of the Command Center, the chat and company content keep their language.
 *
 * A part is plain text (`text`), emphasised (`strong`), or company content shown as written (`content`: a name or a title,
 * whose own direction the renderer keeps).
 */
export interface AskPart {
  readonly text: string;
  readonly strong?: true;
  readonly content?: true;
}

/** The readers the card needs from its host: a person's name and a Work Item's title (null when unknown). */
export interface AttentionNames {
  nameOf(ref: string): string;
  workTitleOf(workItemId: string): string | null;
}

type Rec = Record<string, unknown>;

/**
 * Every case a Founder Attention card renders, in the order the card tests them (the first that matches wins). `NOTICE`
 * is a signal the card has no specific words for (a resilience exception, an external-evidence signal).
 */
export const ATTENTION_CASES = ['APPROVAL', 'GOAL', 'STAFFING', 'ESCALATION', 'CONFLICT', 'UNCERTAIN_EFFECT', 'HELD_RESERVATION', 'HELD_JOB', 'REVIEW_ESCALATION', 'SYSTEMIC', 'JUDGMENT', 'OUTCOME', 'MESSAGE', 'BRIEF', 'NOTICE'] as const;
export type AttentionCase = (typeof ATTENTION_CASES)[number];

const obj = (v: unknown): Rec | null => (v !== null && typeof v === 'object' ? (v as Rec) : null);

/** The case of one attention item (mirrors the card's precedence). */
export function attentionCase(i: Rec): AttentionCase {
  const message = obj(i.message);
  const brief = obj(message?.brief);
  if (obj(i.approval)) return 'APPROVAL';
  if (obj(i.goal)) return 'GOAL';
  if (obj(i.staffing)) return 'STAFFING';
  if (obj(i.escalation)) return 'ESCALATION';
  if (obj(i.conflict)) return 'CONFLICT';
  if (obj(i.uncertainEffect)) return 'UNCERTAIN_EFFECT';
  if (obj(i.heldReservation)) return 'HELD_RESERVATION';
  if (obj(i.heldJob)) return 'HELD_JOB';
  if (obj(i.reviewEscalation)) return 'REVIEW_ESCALATION';
  if (obj(i.systemic)) return 'SYSTEMIC';
  if (obj(i.judgment)) return 'JUDGMENT';
  if (obj(i.outcome)) return 'OUTCOME';
  if (message && !brief) return 'MESSAGE';
  if (brief) return 'BRIEF';
  return 'NOTICE';
}

/** The card's kind (its source), in Arabic. The company map's chips keep the English `SOURCE_LABEL`. */
export const SOURCE_LABEL_AR: Readonly<Record<string, string>> = {
  APPROVAL: 'موافقة',
  STAFFING_REQUEST: 'طلب تعيين',
  ESCALATION: 'تصعيد',
  REVIEW_CONFLICT: 'خلاف بين المراجعين',
  BRIEF: 'ملخص',
  THREAD: 'محادثة',
  GOAL: 'هدف',
  DECISION_REQUEST: 'طلب قرار',
};
export const CEO_BRIEF_KIND_AR = 'ملخص من الرئيس التنفيذي';
const UNKNOWN_KIND_AR = 'تنبيه';

/** A message's purpose, in Arabic (the chat keeps the English `PURPOSE_LABEL`). */
export const PURPOSE_LABEL_AR: Readonly<Record<string, string>> = {
  REQUEST: 'طلب',
  QUESTION: 'سؤال',
  FYI: 'للعلم',
  REVIEW: 'مراجعة',
  DECISION_REQUEST: 'طلب قرار',
  BLOCKER: 'عائق',
  ESCALATION: 'تصعيد',
  RESULT: 'نتيجة',
  CORRECTION: 'تصحيح',
  BRIEF: 'ملخص',
};

/** An approval's action, in Arabic; an unknown action code is shown as it is (data, never guessed). */
export const ACTION_LABEL_AR: Readonly<Record<string, string>> = {
  'work_item.execute': 'تنفيذ مهمة',
  'work_item.release': 'إطلاق مهمة',
  'tool.invoke': 'استخدام أداة',
  'budget.change': 'تغيير ميزانية',
  'employee.activate': 'تفعيل موظف',
};

/** A brief's four headings and its "no decision" line, in Arabic (the brief's own text stays as its author wrote it). */
export const BRIEF_LABEL_AR = {
  happening: 'إيه اللي بيحصل',
  matters: 'ليه ده مهم',
  recommendation: 'التوصية',
  decision: 'القرار المطلوب',
  yes: 'نعم',
  noDecision: 'مفيش قرار مطلوب',
} as const;

/** The mandatory held-money wording (Founder decision): it never suggests the amount was or was not spent. */
export const HELD_RESERVATION_AR: readonly [string, string] = [
  'فيه مبلغ محجوز مقابل استدعاء لم تتأكد فاتورته.',
  'راجع الفوترة قبل تحرير الحجز، وما تعتبرش المبلغ مصروفًا أو غير مصروف من غير دليل.',
];

export function attentionKindAr(i: Rec): string {
  const message = obj(i.message);
  if (String(i.sourceKind) === 'BRIEF' || obj(message?.brief)) return CEO_BRIEF_KIND_AR;
  return SOURCE_LABEL_AR[String(i.sourceKind)] ?? UNKNOWN_KIND_AR;
}

const plain = (text: string): AskPart => ({ text });
const strong = (text: string): AskPart => ({ text, strong: true });
const data = (text: string): AskPart => ({ text, content: true });

/** A Work Item named by its title when known, otherwise in words. */
const workPart = (names: AttentionNames, id: unknown): AskPart => {
  const title = typeof id === 'string' ? names.workTitleOf(id) : null;
  return title ? data(title) : strong('مهمة');
};

/** The card's one-line ask, in Arabic, as parts. Every case of `ATTENTION_CASES` has its own fixed words. */
export function attentionAskAr(i: Rec, names: AttentionNames): AskPart[] {
  const c = attentionCase(i);
  switch (c) {
    case 'APPROVAL': {
      const a = obj(i.approval) as Rec;
      const action = String(a.action);
      return [plain(`مطلوب موافقتك (مستوى المخاطرة ${String(a.risk)}) على ${ACTION_LABEL_AR[action] ?? action} لـ `), data(names.nameOf(String(a.subjectRef)))];
    }
    case 'GOAL':
      return [plain('هدف مقترح محتاج قرارك: '), data(String((obj(i.goal) as Rec).title))];
    case 'STAFFING': {
      const s = obj(i.staffing) as Rec;
      const rec = s.ceoRecommendation === 'APPROVE' ? 'الرئيس التنفيذي بيوصي بالموافقة' : s.ceoRecommendation === 'REJECT' ? 'الرئيس التنفيذي بيوصي بالرفض' : 'الرئيس التنفيذي لسه ما قدّمش توصية';
      return [plain('طلب تعيين في وظيفة '), data(String(s.positionTitle)), plain(` — ${rec}.`)];
    }
    case 'ESCALATION':
      return [plain('تصعيد على '), workPart(names, (obj(i.escalation) as Rec).childWorkItemId), plain(' — الشغل واقف لحد ما تقرر.')];
    case 'CONFLICT':
      return [strong('المراجعين مختلفين على نفس الشغل'), plain(' — قرّر هل يتقبل كما هو ولا يرجع للتعديل.')];
    case 'UNCERTAIN_EFFECT':
      return [strong('فيه أثر خارجي مش متأكدين إنه حصل'), plain(' — أكّد هل اتنفذ ولا لأ. مش هيتكرر من غير إجابتك.')];
    case 'HELD_RESERVATION':
      return [strong(HELD_RESERVATION_AR[0]), plain(` ${HELD_RESERVATION_AR[1]}`)];
    case 'HELD_JOB':
      return [plain('شغل متوقف بعد أثر مش متأكدين منه: '), workPart(names, (obj(i.heldJob) as Rec).workItemId), plain(' — قرّر هل اكتمل، ولا يتعاد، ولا يتسجل كفشل.')];
    case 'REVIEW_ESCALATION':
      return [plain('المراجع ما قدرش يحسم '), workPart(names, (obj(i.reviewEscalation) as Rec).workItemId), plain(' — القرار عندك.')];
    case 'SYSTEMIC':
      return [strong('فيه فشل بيتكرر بنفس النمط'), plain(' — هل المشكلة في النظام نفسه؟')];
    case 'JUDGMENT':
      return [strong((obj(i.judgment) as Rec).subjectKind === 'LESSON' ? 'درس فريق المراجعة ما قدرش يحسمه' : 'سبب فريق المراجعة ما قدرش يحسمه'), plain(' — اعتمده أو ارفضه.')];
    case 'OUTCOME':
      return [plain('المراجعين ما قدروش يتأكدوا من نتيجة '), workPart(names, (obj(i.outcome) as Rec).workItemId)];
    case 'MESSAGE': {
      const m = obj(i.message) as Rec;
      const purpose = String(m.purpose ?? 'REQUEST');
      const owner = i.ownerRef ? names.nameOf(String(i.ownerRef)) : null;
      return [plain(`${PURPOSE_LABEL_AR[purpose] ?? purpose} من `), owner ? data(owner) : strong('الشركة')];
    }
    case 'BRIEF':
      return [strong(obj(obj(i.message)?.brief)?.decisionNeeded ? 'مطلوب منك قرار' : 'للعلم')];
    case 'NOTICE':
      return [strong(obj(i.resilience) ? 'تنبيه عن النسخ الاحتياطية أو الاستعادة أو الصيانة' : 'تنبيه من النظام محتاج مراجعتك'), plain(' — افتح مكانه في الشركة عشان تشوف التفاصيل.')];
  }
}
