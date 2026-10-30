/** Strings for the shaping and caret checks (#7), each set in one family and weight. */
export interface TextSample { label: string; text: string; family: string; weight: number; rtl?: boolean }

export const SAMPLES: TextSample[] = [
  { label: 'Hindi headline', text: 'श्री दिवाली सेल', family: 'Noto Sans Devanagari', weight: 700 },
  { label: 'Hindi body', text: 'क्षमता से ज़्यादा बचत, किफ़ायती दाम', family: 'Noto Sans Devanagari', weight: 400 },
  { label: 'Hindi price', text: 'सिर्फ़ ₹1,299', family: 'Noto Sans Devanagari', weight: 700 },
  { label: 'Hindi conjuncts and matras', text: 'क्ष त्र ज्ञ श्री कि की कु क्षि', family: 'Noto Sans Devanagari', weight: 400 },
  { label: 'Arabic headline', text: 'تخفيضات الصيف', family: 'Noto Naskh Arabic', weight: 700, rtl: true },
  { label: 'Arabic body', text: 'احصل على حذاء الجديد بخصم 40 اليوم فقط', family: 'Noto Naskh Arabic', weight: 400, rtl: true },
  { label: 'Arabic price', text: 'السعر 299 ر.س', family: 'Noto Naskh Arabic', weight: 700, rtl: true },
  { label: 'Arabic lam-alef and marks', text: 'لا إلى سَلام', family: 'Noto Naskh Arabic', weight: 400, rtl: true },
  { label: 'English', text: 'Summer sale: office-ready fit', family: 'Noto Sans', weight: 400 },
]

/** For caret checks only: Latin inside Arabic, which falls back to Noto Sans mid-paragraph. */
export const MIXED: TextSample = {
  label: 'Latin inside Arabic', text: 'احصل على حذاء Nike Air الجديد', family: 'Noto Naskh Arabic', weight: 400, rtl: true,
}
