#!/usr/bin/env python3
"""
BABEL Module -- Arabic NLP Pipeline for Gulf Watch v2
Author: Farah Al-Rashidi, Arabic NLP & Intelligence Linguist

Provides:
  - Arabic text normalization (tashkeel removal, alef/ya/ta_marbuta normalization)
  - Tokenization with morphological awareness
  - Named Entity Recognition (PER, ORG, LOC, GPE, MIL)
  - Entity database: 100+ Gulf military/political entities with Arabic + Latin names
  - Sentiment analysis with Arabic military/political keyword sets
  - Dialect detection heuristic (MSA vs Gulf vs Levantine)
  - Hooks for CAMeL Tools / AraBERT when available

Standalone: works with zero external ML dependencies.
Enhanced:   uses camel_tools, pyarabic, or transformers when installed.

Protocol: stdin/stdout JSON per Marcus's module contract in ARCHITECTURE.md
"""

import json
import re
import sys
import unicodedata
from collections import defaultdict
from typing import Dict, List, Optional, Tuple, Any

# ---------------------------------------------------------------------------
# Optional dependency loading -- graceful degradation
# ---------------------------------------------------------------------------
_HAS_CAMEL = False
_HAS_PYARABIC = False
_HAS_TRANSFORMERS = False

try:
    from camel_tools.utils.normalize import normalize_unicode, normalize_alef_maksura_ar, normalize_teh_marbuta_ar, normalize_alef_ar
    from camel_tools.tokenizers.word import simple_word_tokenize
    from camel_tools.ner import NERecognizer
    _HAS_CAMEL = True
except ImportError:
    pass

try:
    import pyarabic.araby as araby
    _HAS_PYARABIC = True
except ImportError:
    pass

try:
    from transformers import pipeline as hf_pipeline
    _HAS_TRANSFORMERS = True
except ImportError:
    pass


# ===========================================================================
# 1. ARABIC TEXT NORMALIZATION
# ===========================================================================

# Unicode ranges for Arabic diacritics (tashkeel)
_TASHKEEL = re.compile(r'[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]')

# Tatweel (kashida)
_TATWEEL = re.compile(r'\u0640')

# Alef variants -> bare alef
_ALEF_VARIANTS = {
    '\u0622': '\u0627',  # ALEF WITH MADDA ABOVE -> ALEF
    '\u0623': '\u0627',  # ALEF WITH HAMZA ABOVE -> ALEF
    '\u0625': '\u0627',  # ALEF WITH HAMZA BELOW -> ALEF
    '\u0671': '\u0627',  # ALEF WASLA -> ALEF
}

# Ya variants -> dotless ya (alef maksura form used in normalization)
_YA_NORMALIZE = {
    '\u064A': '\u0649',  # YEH -> ALEF MAKSURA (common normalization)
}

# Ta marbuta -> ha
_TA_MARBUTA = {
    '\u0629': '\u0647',  # TA MARBUTA -> HA
}


def remove_tashkeel(text: str) -> str:
    """Remove all Arabic diacritical marks (tashkeel/harakat)."""
    return _TASHKEEL.sub('', text)


def remove_tatweel(text: str) -> str:
    """Remove tatweel (kashida) elongation characters."""
    return _TATWEEL.sub('', text)


def normalize_alef(text: str) -> str:
    """Normalize alef variants to bare alef."""
    if _HAS_CAMEL:
        return normalize_alef_ar(text)
    for src, dst in _ALEF_VARIANTS.items():
        text = text.replace(src, dst)
    return text


def normalize_ya(text: str) -> str:
    """Normalize ya/yeh to alef maksura for consistent matching."""
    for src, dst in _YA_NORMALIZE.items():
        text = text.replace(src, dst)
    return text


def normalize_ta_marbuta(text: str) -> str:
    """Normalize ta marbuta to ha."""
    if _HAS_CAMEL:
        return normalize_teh_marbuta_ar(text)
    for src, dst in _TA_MARBUTA.items():
        text = text.replace(src, dst)
    return text


def normalize_arabic(text: str, full: bool = True) -> str:
    """
    Full Arabic text normalization pipeline.

    Steps:
      1. Remove tashkeel (diacritics)
      2. Remove tatweel (kashida)
      3. Normalize alef variants
      4. Normalize ya
      5. Normalize ta marbuta (optional, controlled by `full`)
      6. Collapse whitespace
    """
    if not text:
        return text
    text = remove_tashkeel(text)
    text = remove_tatweel(text)
    text = normalize_alef(text)
    text = normalize_ya(text)
    if full:
        text = normalize_ta_marbuta(text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# ===========================================================================
# 2. ARABIC TOKENIZATION
# ===========================================================================

# Common Arabic prefixes/proclitics
_PREFIXES = ['وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل']

# Common Arabic suffixes/enclitics
_SUFFIXES = ['هم', 'هن', 'كم', 'كن', 'نا', 'ها', 'ه', 'ي', 'ك']


def tokenize_arabic(text: str) -> List[str]:
    """
    Tokenize Arabic text.
    Uses CAMeL Tools if available, otherwise whitespace + punctuation splitting.
    """
    if _HAS_CAMEL:
        return simple_word_tokenize(text)

    # Fallback: split on whitespace and common punctuation
    # Separate punctuation from words
    text = re.sub(r'([،؛؟!\.,:;\(\)\[\]{}«»""\-])', r' \1 ', text)
    tokens = text.split()
    return [t for t in tokens if t.strip()]


def strip_prefix(word: str) -> Tuple[str, str]:
    """
    Strip the longest matching Arabic prefix/proclitic.
    Returns (prefix, stem).
    """
    normalized = normalize_arabic(word, full=False)
    for pfx in _PREFIXES:
        if normalized.startswith(pfx) and len(normalized) > len(pfx) + 1:
            return pfx, normalized[len(pfx):]
    return '', normalized


def strip_suffix(word: str) -> Tuple[str, str]:
    """
    Strip the longest matching Arabic suffix/enclitic.
    Returns (stem, suffix).
    """
    normalized = normalize_arabic(word, full=False)
    for sfx in _SUFFIXES:
        if normalized.endswith(sfx) and len(normalized) > len(sfx) + 1:
            return normalized[:-len(sfx)], sfx
    return normalized, ''


def extract_root(word: str) -> str:
    """
    Heuristic Arabic root extraction (3-letter root).
    Strips prefixes, suffixes, and common patterns.
    Not a full morphological analyzer -- use CAMeL Tools for that.
    """
    w = normalize_arabic(word, full=True)
    _, w = strip_prefix(w)
    w, _ = strip_suffix(w)
    # Remove common infix patterns (very simplified)
    # Pattern: remove alef in position 2 for form IV/VII/VIII/X
    if len(w) >= 4 and w[1] == '\u0627':
        w = w[0] + w[2:]
    # Pattern: remove ta prefix (form V/VI)
    if len(w) >= 4 and w[0] == '\u062A':
        w = w[1:]
    # Pattern: remove nun prefix (form VII)
    if len(w) >= 4 and w[0] == '\u0646':
        w = w[1:]
    # Trim to 3 consonants if longer
    consonants = [c for c in w if c not in '\u0627\u0648\u0649\u064A']
    if len(consonants) >= 3:
        return ''.join(consonants[:3])
    return w


# ===========================================================================
# 3. ARABIC ENTITY DATABASE (100+ entries)
# ===========================================================================

class ArabicEntityDB:
    """
    Database of Gulf region military, political, and organizational entities.
    Each entry has: Arabic name, Latin transliterations, entity type, aliases.
    """

    # Entity types matching ARCHITECTURE.md NER tags
    TYPE_PER = 'person'
    TYPE_ORG = 'organization'
    TYPE_LOC = 'location'
    TYPE_GPE = 'geopolitical_entity'
    TYPE_MIL = 'military_unit'

    def __init__(self):
        self.entities: List[Dict[str, Any]] = []
        self._ar_index: Dict[str, int] = {}   # normalized Arabic -> entity index
        self._en_index: Dict[str, int] = {}   # lowercase Latin -> entity index
        self._build_db()
        self._build_indices()

    def _build_db(self):
        """Build the entity database with 100+ Gulf region entities."""
        self.entities = [
            # ===== HEADS OF STATE / SENIOR LEADERS =====
            {"ar": "محمد بن سلمان بن عبدالعزيز آل سعود", "en": "Mohammed bin Salman", "type": self.TYPE_PER,
             "aliases_en": ["MbS", "Muhammad bin Salman", "MBS", "Crown Prince Mohammed bin Salman"],
             "aliases_ar": ["محمد بن سلمان", "ولي العهد السعودي", "ولي العهد"], "country": "SA"},
            {"ar": "سلمان بن عبدالعزيز آل سعود", "en": "King Salman bin Abdulaziz", "type": self.TYPE_PER,
             "aliases_en": ["King Salman", "Salman bin Abdulaziz"],
             "aliases_ar": ["الملك سلمان", "خادم الحرمين الشريفين"], "country": "SA"},
            {"ar": "محمد بن زايد آل نهيان", "en": "Mohammed bin Zayed Al Nahyan", "type": self.TYPE_PER,
             "aliases_en": ["MBZ", "Sheikh Mohammed bin Zayed", "Mohamed bin Zayed"],
             "aliases_ar": ["محمد بن زايد", "رئيس الدولة"], "country": "AE"},
            {"ar": "تميم بن حمد آل ثاني", "en": "Tamim bin Hamad Al Thani", "type": self.TYPE_PER,
             "aliases_en": ["Sheikh Tamim", "Emir of Qatar", "Tamim bin Hamad"],
             "aliases_ar": ["أمير قطر", "الشيخ تميم"], "country": "QA"},
            {"ar": "عبدالله الثاني بن الحسين", "en": "Abdullah II of Jordan", "type": self.TYPE_PER,
             "aliases_en": ["King Abdullah II", "King Abdullah of Jordan"],
             "aliases_ar": ["الملك عبدالله", "ملك الأردن"], "country": "JO"},
            {"ar": "عبدالفتاح السيسي", "en": "Abdel Fattah el-Sisi", "type": self.TYPE_PER,
             "aliases_en": ["Sisi", "President Sisi", "el-Sisi"],
             "aliases_ar": ["السيسي", "الرئيس السيسي"], "country": "EG"},
            {"ar": "بشار الأسد", "en": "Bashar al-Assad", "type": self.TYPE_PER,
             "aliases_en": ["Assad", "Bashar Assad"],
             "aliases_ar": ["الأسد", "الرئيس الأسد"], "country": "SY"},
            {"ar": "علي خامنئي", "en": "Ali Khamenei", "type": self.TYPE_PER,
             "aliases_en": ["Khamenei", "Supreme Leader Khamenei", "Ayatollah Khamenei"],
             "aliases_ar": ["المرشد الأعلى", "خامنئي", "آية الله خامنئي"], "country": "IR"},
            {"ar": "إبراهيم رئيسي", "en": "Ebrahim Raisi", "type": self.TYPE_PER,
             "aliases_en": ["Raisi", "President Raisi"],
             "aliases_ar": ["رئيسي", "الرئيس رئيسي"], "country": "IR"},
            {"ar": "بنيامين نتنياهو", "en": "Benjamin Netanyahu", "type": self.TYPE_PER,
             "aliases_en": ["Netanyahu", "Bibi", "Bibi Netanyahu"],
             "aliases_ar": ["نتنياهو", "رئيس الوزراء الإسرائيلي"], "country": "IL"},
            {"ar": "مسعود بزشكيان", "en": "Masoud Pezeshkian", "type": self.TYPE_PER,
             "aliases_en": ["Pezeshkian", "President Pezeshkian"],
             "aliases_ar": ["بزشكيان"], "country": "IR"},
            {"ar": "حسن نصر الله", "en": "Hassan Nasrallah", "type": self.TYPE_PER,
             "aliases_en": ["Nasrallah", "Sheikh Nasrallah", "Hasan Nasrallah"],
             "aliases_ar": ["نصر الله", "السيد نصر الله", "أمين عام حزب الله"], "country": "LB"},
            {"ar": "إسماعيل هنية", "en": "Ismail Haniyeh", "type": self.TYPE_PER,
             "aliases_en": ["Haniyeh", "Ismail Haniya"],
             "aliases_ar": ["هنية"], "country": "PS"},
            {"ar": "يحيى السنوار", "en": "Yahya Sinwar", "type": self.TYPE_PER,
             "aliases_en": ["Sinwar"],
             "aliases_ar": ["السنوار"], "country": "PS"},
            {"ar": "عبدالملك الحوثي", "en": "Abdul-Malik al-Houthi", "type": self.TYPE_PER,
             "aliases_en": ["Houthi leader", "Abdulmalik al-Houthi"],
             "aliases_ar": ["الحوثي", "زعيم الحوثيين"], "country": "YE"},
            {"ar": "مشعل بن فهم السلمي", "en": "Mishal Al-Sulami", "type": self.TYPE_PER,
             "aliases_en": ["Speaker of Saudi Shura Council"],
             "aliases_ar": ["رئيس مجلس الشورى"], "country": "SA"},
            {"ar": "هيثم بن طارق آل سعيد", "en": "Haitham bin Tariq", "type": self.TYPE_PER,
             "aliases_en": ["Sultan Haitham", "Sultan of Oman"],
             "aliases_ar": ["السلطان هيثم", "سلطان عمان"], "country": "OM"},
            {"ar": "حمد بن عيسى آل خليفة", "en": "Hamad bin Isa Al Khalifa", "type": self.TYPE_PER,
             "aliases_en": ["King of Bahrain", "King Hamad"],
             "aliases_ar": ["ملك البحرين", "الملك حمد"], "country": "BH"},
            {"ar": "صباح الأحمد الجابر الصباح", "en": "Sabah Al-Ahmad Al-Jaber Al-Sabah", "type": self.TYPE_PER,
             "aliases_en": ["Emir of Kuwait"],
             "aliases_ar": ["أمير الكويت"], "country": "KW"},
            {"ar": "مشعل الأحمد الجابر الصباح", "en": "Mishal Al-Ahmad Al-Jaber Al-Sabah", "type": self.TYPE_PER,
             "aliases_en": ["Emir Mishal", "Emir of Kuwait"],
             "aliases_ar": ["الأمير مشعل", "أمير الكويت"], "country": "KW"},

            # ===== MILITARY / SECURITY LEADERS =====
            {"ar": "حسين سلامي", "en": "Hossein Salami", "type": self.TYPE_PER,
             "aliases_en": ["Major General Salami", "IRGC Commander Salami"],
             "aliases_ar": ["اللواء سلامي", "قائد الحرس الثوري"], "country": "IR"},
            {"ar": "إسماعيل قاآني", "en": "Ismail Qaani", "type": self.TYPE_PER,
             "aliases_en": ["Qaani", "Ghaani", "Quds Force Commander"],
             "aliases_ar": ["قاآني", "قائد فيلق القدس"], "country": "IR"},
            {"ar": "يوآف غالانت", "en": "Yoav Gallant", "type": self.TYPE_PER,
             "aliases_en": ["Gallant", "Defense Minister Gallant"],
             "aliases_ar": ["غالانت", "وزير الدفاع الإسرائيلي"], "country": "IL"},
            {"ar": "هرتسي هاليفي", "en": "Herzi Halevi", "type": self.TYPE_PER,
             "aliases_en": ["Halevi", "IDF Chief of Staff"],
             "aliases_ar": ["هاليفي", "رئيس أركان الجيش الإسرائيلي"], "country": "IL"},
            {"ar": "خالد بن سلمان بن عبدالعزيز", "en": "Khalid bin Salman", "type": self.TYPE_PER,
             "aliases_en": ["KbS", "Saudi Defense Minister", "Prince Khalid"],
             "aliases_ar": ["الأمير خالد بن سلمان", "وزير الدفاع السعودي"], "country": "SA"},

            # ===== ORGANIZATIONS =====
            {"ar": "الحرس الثوري الإسلامي", "en": "Islamic Revolutionary Guard Corps", "type": self.TYPE_ORG,
             "aliases_en": ["IRGC", "Iranian Revolutionary Guards", "Pasdaran", "Revolutionary Guards"],
             "aliases_ar": ["الحرس الثوري", "حرس الثورة الإسلامية", "سپاه پاسداران"], "country": "IR"},
            {"ar": "فيلق القدس", "en": "Quds Force", "type": self.TYPE_ORG,
             "aliases_en": ["IRGC-QF", "Qods Force", "Jerusalem Force"],
             "aliases_ar": ["قوة القدس", "نيروى قدس"], "country": "IR"},
            {"ar": "حزب الله", "en": "Hezbollah", "type": self.TYPE_ORG,
             "aliases_en": ["Hizbullah", "Hizballah", "Hizbollah", "Party of God"],
             "aliases_ar": ["حزب اللّه", "المقاومة الإسلامية"], "country": "LB"},
            {"ar": "حركة حماس", "en": "Hamas", "type": self.TYPE_ORG,
             "aliases_en": ["Islamic Resistance Movement"],
             "aliases_ar": ["حماس", "حركة المقاومة الإسلامية"], "country": "PS"},
            {"ar": "كتائب القسام", "en": "Al-Qassam Brigades", "type": self.TYPE_ORG,
             "aliases_en": ["Qassam Brigades", "Izz ad-Din al-Qassam Brigades"],
             "aliases_ar": ["كتائب عز الدين القسام"], "country": "PS"},
            {"ar": "حركة الجهاد الإسلامي", "en": "Palestinian Islamic Jihad", "type": self.TYPE_ORG,
             "aliases_en": ["PIJ", "Islamic Jihad"],
             "aliases_ar": ["الجهاد الإسلامي"], "country": "PS"},
            {"ar": "أنصار الله", "en": "Ansar Allah", "type": self.TYPE_ORG,
             "aliases_en": ["Houthis", "Houthi movement", "Ansarallah", "Ansar-Allah"],
             "aliases_ar": ["الحوثيون", "جماعة الحوثي"], "country": "YE"},
            {"ar": "جيش الدفاع الإسرائيلي", "en": "Israel Defense Forces", "type": self.TYPE_MIL,
             "aliases_en": ["IDF", "Israeli military", "Israeli army", "Tzahal", "Tsahal"],
             "aliases_ar": ["الجيش الإسرائيلي", "تساهال"], "country": "IL"},
            {"ar": "الجيش العربي السوري", "en": "Syrian Arab Army", "type": self.TYPE_MIL,
             "aliases_en": ["SAA", "Syrian Army", "Assad forces"],
             "aliases_ar": ["الجيش السوري"], "country": "SY"},
            {"ar": "قوات سوريا الديمقراطية", "en": "Syrian Democratic Forces", "type": self.TYPE_MIL,
             "aliases_en": ["SDF", "QSD"],
             "aliases_ar": ["قسد"], "country": "SY"},
            {"ar": "الحشد الشعبي", "en": "Popular Mobilization Forces", "type": self.TYPE_MIL,
             "aliases_en": ["PMF", "PMU", "Hashd al-Shaabi", "Popular Mobilization Units"],
             "aliases_ar": ["هيئة الحشد الشعبي"], "country": "IQ"},
            {"ar": "القوات المسلحة السعودية", "en": "Saudi Armed Forces", "type": self.TYPE_MIL,
             "aliases_en": ["Saudi military", "RSAF"],
             "aliases_ar": ["الجيش السعودي"], "country": "SA"},
            {"ar": "القوات المسلحة الإماراتية", "en": "UAE Armed Forces", "type": self.TYPE_MIL,
             "aliases_en": ["Emirati military", "UAE military"],
             "aliases_ar": ["الجيش الإماراتي"], "country": "AE"},
            {"ar": "التحالف العربي", "en": "Arab Coalition", "type": self.TYPE_MIL,
             "aliases_en": ["Saudi-led coalition", "Coalition to Restore Legitimacy"],
             "aliases_ar": ["تحالف دعم الشرعية"], "country": "SA"},
            {"ar": "قوات الدفاع الجوي السعودي", "en": "Royal Saudi Air Defense", "type": self.TYPE_MIL,
             "aliases_en": ["Saudi air defense"],
             "aliases_ar": ["الدفاع الجوي"], "country": "SA"},
            {"ar": "كتائب حزب الله", "en": "Kata'ib Hezbollah", "type": self.TYPE_MIL,
             "aliases_en": ["KH", "Iraqi Hezbollah", "Kataib Hezbollah"],
             "aliases_ar": ["كتائب حزب اللّه العراقية"], "country": "IQ"},
            {"ar": "حركة النجباء", "en": "Harakat al-Nujaba", "type": self.TYPE_MIL,
             "aliases_en": ["al-Nujaba Movement", "Nujaba"],
             "aliases_ar": ["النجباء"], "country": "IQ"},
            {"ar": "عصائب أهل الحق", "en": "Asa'ib Ahl al-Haq", "type": self.TYPE_MIL,
             "aliases_en": ["AAH", "League of the Righteous"],
             "aliases_ar": ["العصائب"], "country": "IQ"},

            # ===== GEOPOLITICAL ENTITIES / STATES =====
            {"ar": "المملكة العربية السعودية", "en": "Saudi Arabia", "type": self.TYPE_GPE,
             "aliases_en": ["KSA", "Kingdom of Saudi Arabia", "The Kingdom"],
             "aliases_ar": ["السعودية", "المملكة"], "country": "SA"},
            {"ar": "الإمارات العربية المتحدة", "en": "United Arab Emirates", "type": self.TYPE_GPE,
             "aliases_en": ["UAE", "Emirates"],
             "aliases_ar": ["الإمارات"], "country": "AE"},
            {"ar": "جمهورية إيران الإسلامية", "en": "Islamic Republic of Iran", "type": self.TYPE_GPE,
             "aliases_en": ["Iran"],
             "aliases_ar": ["إيران", "الجمهورية الإسلامية"], "country": "IR"},
            {"ar": "دولة الكويت", "en": "State of Kuwait", "type": self.TYPE_GPE,
             "aliases_en": ["Kuwait"],
             "aliases_ar": ["الكويت"], "country": "KW"},
            {"ar": "دولة قطر", "en": "State of Qatar", "type": self.TYPE_GPE,
             "aliases_en": ["Qatar"],
             "aliases_ar": ["قطر"], "country": "QA"},
            {"ar": "مملكة البحرين", "en": "Kingdom of Bahrain", "type": self.TYPE_GPE,
             "aliases_en": ["Bahrain"],
             "aliases_ar": ["البحرين"], "country": "BH"},
            {"ar": "سلطنة عمان", "en": "Sultanate of Oman", "type": self.TYPE_GPE,
             "aliases_en": ["Oman"],
             "aliases_ar": ["عمان"], "country": "OM"},
            {"ar": "الجمهورية العراقية", "en": "Republic of Iraq", "type": self.TYPE_GPE,
             "aliases_en": ["Iraq"],
             "aliases_ar": ["العراق"], "country": "IQ"},
            {"ar": "الجمهورية العربية السورية", "en": "Syrian Arab Republic", "type": self.TYPE_GPE,
             "aliases_en": ["Syria"],
             "aliases_ar": ["سوريا", "سورية"], "country": "SY"},
            {"ar": "الجمهورية اللبنانية", "en": "Lebanese Republic", "type": self.TYPE_GPE,
             "aliases_en": ["Lebanon"],
             "aliases_ar": ["لبنان"], "country": "LB"},
            {"ar": "الجمهورية اليمنية", "en": "Republic of Yemen", "type": self.TYPE_GPE,
             "aliases_en": ["Yemen"],
             "aliases_ar": ["اليمن"], "country": "YE"},
            {"ar": "جمهورية مصر العربية", "en": "Arab Republic of Egypt", "type": self.TYPE_GPE,
             "aliases_en": ["Egypt"],
             "aliases_ar": ["مصر"], "country": "EG"},
            {"ar": "المملكة الأردنية الهاشمية", "en": "Hashemite Kingdom of Jordan", "type": self.TYPE_GPE,
             "aliases_en": ["Jordan"],
             "aliases_ar": ["الأردن"], "country": "JO"},
            {"ar": "دولة فلسطين", "en": "State of Palestine", "type": self.TYPE_GPE,
             "aliases_en": ["Palestine", "Palestinian territories"],
             "aliases_ar": ["فلسطين"], "country": "PS"},

            # ===== LOCATIONS (strategic) =====
            {"ar": "مضيق هرمز", "en": "Strait of Hormuz", "type": self.TYPE_LOC,
             "aliases_en": ["Hormuz Strait"],
             "aliases_ar": ["هرمز"], "country": ""},
            {"ar": "باب المندب", "en": "Bab el-Mandeb", "type": self.TYPE_LOC,
             "aliases_en": ["Bab al-Mandab", "Gate of Tears"],
             "aliases_ar": ["مضيق باب المندب"], "country": ""},
            {"ar": "قناة السويس", "en": "Suez Canal", "type": self.TYPE_LOC,
             "aliases_en": ["Suez"],
             "aliases_ar": ["السويس"], "country": "EG"},
            {"ar": "البحر الأحمر", "en": "Red Sea", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": ""},
            {"ar": "الخليج العربي", "en": "Arabian Gulf", "type": self.TYPE_LOC,
             "aliases_en": ["Persian Gulf", "The Gulf", "Arabian/Persian Gulf"],
             "aliases_ar": ["الخليج الفارسي", "الخليج"], "country": ""},
            {"ar": "البحر الأبيض المتوسط", "en": "Mediterranean Sea", "type": self.TYPE_LOC,
             "aliases_en": ["Mediterranean"],
             "aliases_ar": ["المتوسط"], "country": ""},
            {"ar": "مأرب", "en": "Marib", "type": self.TYPE_LOC,
             "aliases_en": ["Ma'rib", "Mareb"],
             "aliases_ar": [], "country": "YE"},
            {"ar": "الحديدة", "en": "Hodeidah", "type": self.TYPE_LOC,
             "aliases_en": ["Hodeida", "Al Hudaydah"],
             "aliases_ar": ["الحديده"], "country": "YE"},
            {"ar": "رفح", "en": "Rafah", "type": self.TYPE_LOC,
             "aliases_en": ["Rafah crossing"],
             "aliases_ar": ["معبر رفح"], "country": "PS"},
            {"ar": "خان يونس", "en": "Khan Younis", "type": self.TYPE_LOC,
             "aliases_en": ["Khan Yunis"],
             "aliases_ar": [], "country": "PS"},
            {"ar": "جباليا", "en": "Jabalia", "type": self.TYPE_LOC,
             "aliases_en": ["Jabaliya"],
             "aliases_ar": [], "country": "PS"},
            {"ar": "دير البلح", "en": "Deir al-Balah", "type": self.TYPE_LOC,
             "aliases_en": ["Deir el-Balah"],
             "aliases_ar": [], "country": "PS"},
            {"ar": "الضفة الغربية", "en": "West Bank", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "PS"},
            {"ar": "هضبة الجولان", "en": "Golan Heights", "type": self.TYPE_LOC,
             "aliases_en": ["Golan"],
             "aliases_ar": ["الجولان"], "country": "SY"},
            {"ar": "النجف", "en": "Najaf", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "IQ"},
            {"ar": "أربيل", "en": "Erbil", "type": self.TYPE_LOC,
             "aliases_en": ["Irbil", "Arbil", "Hewler"],
             "aliases_ar": ["هولير"], "country": "IQ"},
            {"ar": "إدلب", "en": "Idlib", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "SY"},
            {"ar": "حلب", "en": "Aleppo", "type": self.TYPE_LOC,
             "aliases_en": ["Halab"],
             "aliases_ar": [], "country": "SY"},
            {"ar": "دمشق", "en": "Damascus", "type": self.TYPE_LOC,
             "aliases_en": ["Sham"],
             "aliases_ar": ["الشام"], "country": "SY"},
            {"ar": "بغداد", "en": "Baghdad", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "IQ"},
            {"ar": "طهران", "en": "Tehran", "type": self.TYPE_LOC,
             "aliases_en": ["Teheran"],
             "aliases_ar": [], "country": "IR"},
            {"ar": "أصفهان", "en": "Isfahan", "type": self.TYPE_LOC,
             "aliases_en": ["Esfahan"],
             "aliases_ar": [], "country": "IR"},
            {"ar": "الرياض", "en": "Riyadh", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "SA"},
            {"ar": "جدة", "en": "Jeddah", "type": self.TYPE_LOC,
             "aliases_en": ["Jidda", "Jedda"],
             "aliases_ar": [], "country": "SA"},
            {"ar": "أبوظبي", "en": "Abu Dhabi", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "AE"},
            {"ar": "دبي", "en": "Dubai", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "AE"},
            {"ar": "بيروت", "en": "Beirut", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "LB"},
            {"ar": "الضاحية الجنوبية", "en": "Dahiyeh", "type": self.TYPE_LOC,
             "aliases_en": ["Southern Suburbs", "Dahieh", "Dahiya"],
             "aliases_ar": ["الضاحية"], "country": "LB"},
            {"ar": "نطنز", "en": "Natanz", "type": self.TYPE_LOC,
             "aliases_en": ["Natanz nuclear facility"],
             "aliases_ar": [], "country": "IR"},
            {"ar": "فوردو", "en": "Fordow", "type": self.TYPE_LOC,
             "aliases_en": ["Fordo", "Fordow nuclear facility"],
             "aliases_ar": [], "country": "IR"},
            {"ar": "بوشهر", "en": "Bushehr", "type": self.TYPE_LOC,
             "aliases_en": ["Bushehr nuclear plant"],
             "aliases_ar": [], "country": "IR"},
            {"ar": "نيوم", "en": "NEOM", "type": self.TYPE_LOC,
             "aliases_en": ["Neom City"],
             "aliases_ar": [], "country": "SA"},
            {"ar": "العلا", "en": "AlUla", "type": self.TYPE_LOC,
             "aliases_en": ["Al-Ula"],
             "aliases_ar": [], "country": "SA"},
            {"ar": "صنعاء", "en": "Sanaa", "type": self.TYPE_LOC,
             "aliases_en": ["Sana'a"],
             "aliases_ar": [], "country": "YE"},
            {"ar": "عدن", "en": "Aden", "type": self.TYPE_LOC,
             "aliases_en": [],
             "aliases_ar": [], "country": "YE"},

            # ===== ORGANIZATIONS (international / regional bodies) =====
            {"ar": "مجلس التعاون الخليجي", "en": "Gulf Cooperation Council", "type": self.TYPE_ORG,
             "aliases_en": ["GCC"],
             "aliases_ar": ["مجلس التعاون لدول الخليج العربية", "مجلس التعاون"], "country": ""},
            {"ar": "جامعة الدول العربية", "en": "Arab League", "type": self.TYPE_ORG,
             "aliases_en": ["League of Arab States", "LAS"],
             "aliases_ar": ["الجامعة العربية"], "country": ""},
            {"ar": "منظمة أوبك", "en": "OPEC", "type": self.TYPE_ORG,
             "aliases_en": ["Organization of the Petroleum Exporting Countries"],
             "aliases_ar": ["أوبك", "منظمة الدول المصدرة للنفط"], "country": ""},
            {"ar": "أوبك بلس", "en": "OPEC+", "type": self.TYPE_ORG,
             "aliases_en": ["OPEC Plus"],
             "aliases_ar": [], "country": ""},
            {"ar": "الوكالة الدولية للطاقة الذرية", "en": "International Atomic Energy Agency", "type": self.TYPE_ORG,
             "aliases_en": ["IAEA"],
             "aliases_ar": ["الطاقة الذرية"], "country": ""},
            {"ar": "الأمم المتحدة", "en": "United Nations", "type": self.TYPE_ORG,
             "aliases_en": ["UN"],
             "aliases_ar": [], "country": ""},
            {"ar": "مجلس الأمن الدولي", "en": "UN Security Council", "type": self.TYPE_ORG,
             "aliases_en": ["UNSC", "Security Council"],
             "aliases_ar": ["مجلس الأمن"], "country": ""},
            {"ar": "حلف شمال الأطلسي", "en": "NATO", "type": self.TYPE_ORG,
             "aliases_en": ["North Atlantic Treaty Organization"],
             "aliases_ar": ["الناتو"], "country": ""},
            {"ar": "القيادة المركزية الأمريكية", "en": "US Central Command", "type": self.TYPE_ORG,
             "aliases_en": ["CENTCOM", "USCENTCOM"],
             "aliases_ar": ["سنتكوم"], "country": "US"},
            {"ar": "أرامكو السعودية", "en": "Saudi Aramco", "type": self.TYPE_ORG,
             "aliases_en": ["Aramco"],
             "aliases_ar": ["أرامكو"], "country": "SA"},
            {"ar": "أدنوك", "en": "ADNOC", "type": self.TYPE_ORG,
             "aliases_en": ["Abu Dhabi National Oil Company"],
             "aliases_ar": ["شركة بترول أبوظبي الوطنية"], "country": "AE"},
            {"ar": "صندوق الاستثمارات العامة", "en": "Public Investment Fund", "type": self.TYPE_ORG,
             "aliases_en": ["PIF", "Saudi PIF"],
             "aliases_ar": [], "country": "SA"},
            {"ar": "وكالة أنباء الإمارات", "en": "Emirates News Agency", "type": self.TYPE_ORG,
             "aliases_en": ["WAM"],
             "aliases_ar": ["وام"], "country": "AE"},
            {"ar": "وكالة الأنباء السعودية", "en": "Saudi Press Agency", "type": self.TYPE_ORG,
             "aliases_en": ["SPA"],
             "aliases_ar": ["واس"], "country": "SA"},
            {"ar": "وكالة الأنباء القطرية", "en": "Qatar News Agency", "type": self.TYPE_ORG,
             "aliases_en": ["QNA"],
             "aliases_ar": ["قنا"], "country": "QA"},
            {"ar": "وكالة الأنباء الكويتية", "en": "Kuwait News Agency", "type": self.TYPE_ORG,
             "aliases_en": ["KUNA"],
             "aliases_ar": ["كونا"], "country": "KW"},

            # ===== WEAPONS SYSTEMS / MILITARY EQUIPMENT =====
            {"ar": "القبة الحديدية", "en": "Iron Dome", "type": self.TYPE_MIL,
             "aliases_en": [],
             "aliases_ar": [], "country": "IL"},
            {"ar": "منظومة باتريوت", "en": "Patriot missile system", "type": self.TYPE_MIL,
             "aliases_en": ["Patriot", "MIM-104 Patriot"],
             "aliases_ar": ["باتريوت", "صواريخ باتريوت"], "country": "US"},
            {"ar": "منظومة ثاد", "en": "THAAD", "type": self.TYPE_MIL,
             "aliases_en": ["Terminal High Altitude Area Defense"],
             "aliases_ar": ["ثاد"], "country": "US"},
            {"ar": "صواريخ بالستية", "en": "ballistic missiles", "type": self.TYPE_MIL,
             "aliases_en": [],
             "aliases_ar": ["الصواريخ البالستية"], "country": ""},
            {"ar": "طائرات مسيرة", "en": "drones", "type": self.TYPE_MIL,
             "aliases_en": ["UAV", "unmanned aerial vehicles"],
             "aliases_ar": ["مسيّرات", "طائرات بدون طيار", "درونز"], "country": ""},
            {"ar": "صواريخ كروز", "en": "cruise missiles", "type": self.TYPE_MIL,
             "aliases_en": [],
             "aliases_ar": ["صواريخ مجنحة"], "country": ""},
        ]

    def _build_indices(self):
        """Build lookup indices for fast entity resolution."""
        for idx, entity in enumerate(self.entities):
            # Index canonical Arabic name
            norm_ar = normalize_arabic(entity['ar'])
            self._ar_index[norm_ar] = idx
            # Index Arabic aliases
            for alias in entity.get('aliases_ar', []):
                self._ar_index[normalize_arabic(alias)] = idx
            # Index canonical English name
            self._en_index[entity['en'].lower()] = idx
            # Index English aliases
            for alias in entity.get('aliases_en', []):
                self._en_index[alias.lower()] = idx

    def lookup_arabic(self, text: str) -> Optional[Dict]:
        """Look up an entity by Arabic text (normalized)."""
        norm = normalize_arabic(text)
        idx = self._ar_index.get(norm)
        if idx is not None:
            return self.entities[idx]
        # Partial match: check if any key is a substring
        for key, idx in self._ar_index.items():
            if key in norm or norm in key:
                return self.entities[idx]
        return None

    def lookup_english(self, text: str) -> Optional[Dict]:
        """Look up an entity by English text."""
        lower = text.lower().strip()
        idx = self._en_index.get(lower)
        if idx is not None:
            return self.entities[idx]
        for key, idx in self._en_index.items():
            if key in lower or lower in key:
                return self.entities[idx]
        return None

    def search(self, query: str) -> List[Dict]:
        """Search entities by either Arabic or English text. Returns all matches."""
        results = []
        seen = set()
        norm_q = normalize_arabic(query)
        lower_q = query.lower().strip()

        for idx, entity in enumerate(self.entities):
            if idx in seen:
                continue
            # Check Arabic canonical + aliases
            if norm_q in normalize_arabic(entity['ar']):
                results.append(entity)
                seen.add(idx)
                continue
            for alias in entity.get('aliases_ar', []):
                if norm_q in normalize_arabic(alias):
                    results.append(entity)
                    seen.add(idx)
                    break
            if idx in seen:
                continue
            # Check English canonical + aliases
            if lower_q in entity['en'].lower():
                results.append(entity)
                seen.add(idx)
                continue
            for alias in entity.get('aliases_en', []):
                if lower_q in alias.lower():
                    results.append(entity)
                    seen.add(idx)
                    break
        return results

    def get_all_by_type(self, entity_type: str) -> List[Dict]:
        """Get all entities of a given type."""
        return [e for e in self.entities if e['type'] == entity_type]

    def get_all_by_country(self, country_code: str) -> List[Dict]:
        """Get all entities for a given country code (ISO 3166-1 alpha-2)."""
        return [e for e in self.entities if e.get('country') == country_code]


# Singleton instance
_entity_db = None

def get_entity_db() -> ArabicEntityDB:
    """Get or create the singleton entity database."""
    global _entity_db
    if _entity_db is None:
        _entity_db = ArabicEntityDB()
    return _entity_db


# ===========================================================================
# 4. NAMED ENTITY RECOGNITION (NER)
# ===========================================================================

# Arabic Unicode range for detection
_ARABIC_CHAR = re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]')

def is_arabic(text: str) -> bool:
    """Detect whether text contains Arabic characters."""
    if not text:
        return False
    arabic_chars = len(_ARABIC_CHAR.findall(text))
    total_alpha = sum(1 for c in text if c.isalpha())
    if total_alpha == 0:
        return False
    return (arabic_chars / total_alpha) > 0.3


def detect_language(text: str) -> str:
    """
    Detect language of text.
    Returns: 'ar' for Arabic, 'en' for English, 'mixed' for bilingual.
    """
    if not text:
        return 'en'
    arabic_chars = len(_ARABIC_CHAR.findall(text))
    latin_chars = sum(1 for c in text if 'a' <= c.lower() <= 'z')
    total = arabic_chars + latin_chars
    if total == 0:
        return 'en'
    ar_ratio = arabic_chars / total
    if ar_ratio > 0.7:
        return 'ar'
    elif ar_ratio < 0.3:
        return 'en'
    return 'mixed'


# NER patterns for Arabic text (regex-based fallback when CAMeL unavailable)
_PERSON_PREFIXES_AR = [
    'الرئيس', 'رئيس الوزراء', 'الملك', 'الأمير', 'ولي العهد',
    'الشيخ', 'السلطان', 'أمير', 'الدكتور', 'اللواء', 'العميد',
    'الفريق', 'المشير', 'السفير', 'الوزير', 'آية الله', 'السيد',
    'قائد', 'زعيم',
]

_ORG_KEYWORDS_AR = [
    'حزب', 'حركة', 'جبهة', 'كتائب', 'فيلق', 'منظمة', 'جماعة',
    'وكالة', 'مجلس', 'هيئة', 'لجنة', 'وزارة', 'قوات', 'جيش',
    'شركة', 'مؤسسة', 'صندوق', 'بنك', 'حلف',
]

_LOC_KEYWORDS_AR = [
    'مدينة', 'محافظة', 'منطقة', 'مضيق', 'خليج', 'بحر', 'نهر',
    'جبل', 'صحراء', 'ميناء', 'مطار', 'قاعدة', 'معبر', 'حدود',
    'جزيرة', 'واحة', 'سد', 'قناة', 'هضبة',
]


def extract_entities_regex(text: str) -> List[Dict[str, Any]]:
    """
    Regex + dictionary-based NER for Arabic text.
    Returns entities with type, text, and confidence.
    """
    if not text:
        return []

    entities = []
    seen_spans = set()
    db = get_entity_db()
    norm_text = normalize_arabic(text)

    # 1. Dictionary lookup against entity database
    for entity in db.entities:
        # Check canonical Arabic name
        ar_name = normalize_arabic(entity['ar'])
        if ar_name in norm_text:
            start = norm_text.find(ar_name)
            span = (start, start + len(ar_name))
            if span not in seen_spans:
                seen_spans.add(span)
                entities.append({
                    'text_ar': entity['ar'],
                    'text_en': entity['en'],
                    'type': entity['type'],
                    'confidence': 0.95,
                    'source': 'dictionary',
                    'country': entity.get('country', ''),
                })
        # Check Arabic aliases
        for alias in entity.get('aliases_ar', []):
            alias_norm = normalize_arabic(alias)
            if alias_norm and alias_norm in norm_text:
                start = norm_text.find(alias_norm)
                span = (start, start + len(alias_norm))
                if span not in seen_spans:
                    seen_spans.add(span)
                    entities.append({
                        'text_ar': alias,
                        'text_en': entity['en'],
                        'type': entity['type'],
                        'confidence': 0.90,
                        'source': 'dictionary_alias',
                        'country': entity.get('country', ''),
                    })

    # 2. Pattern-based extraction for entities not in database
    tokens = tokenize_arabic(text)

    # Person patterns: title + 2-4 following words
    for i, token in enumerate(tokens):
        norm_token = normalize_arabic(token)
        for prefix in _PERSON_PREFIXES_AR:
            norm_prefix = normalize_arabic(prefix)
            if norm_token == norm_prefix or norm_text.startswith(norm_prefix):
                # Grab up to 4 following tokens as potential name
                name_tokens = tokens[i+1:i+5]
                if name_tokens:
                    candidate = ' '.join([token] + name_tokens)
                    # Check not already captured
                    if not any(e['text_ar'] == candidate for e in entities):
                        entities.append({
                            'text_ar': candidate,
                            'text_en': '',
                            'type': 'person',
                            'confidence': 0.60,
                            'source': 'pattern',
                        })
                break

    # Organization patterns: keyword in phrase
    for keyword in _ORG_KEYWORDS_AR:
        kw_norm = normalize_arabic(keyword)
        if kw_norm in norm_text:
            # Find the phrase containing the keyword
            idx = norm_text.find(kw_norm)
            # Extract a window around the keyword
            start = max(0, norm_text.rfind(' ', 0, idx))
            end = norm_text.find(' ', idx + len(kw_norm) + 15)
            if end == -1:
                end = min(len(norm_text), idx + len(kw_norm) + 30)
            phrase = text[start:end].strip()
            if phrase and not any(e['text_ar'] == phrase for e in entities):
                entities.append({
                    'text_ar': phrase,
                    'text_en': '',
                    'type': 'organization',
                    'confidence': 0.50,
                    'source': 'pattern',
                })

    return entities


def extract_entities(text: str) -> List[Dict[str, Any]]:
    """
    Main NER entry point. Uses CAMeL Tools if available, otherwise regex fallback.
    """
    if _HAS_CAMEL:
        try:
            ner = NERecognizer.pretrained()
            tokens = simple_word_tokenize(text)
            labels = ner.predict(tokens)
            entities = []
            current_entity = []
            current_label = None
            db = get_entity_db()

            for token, label in zip(tokens, labels):
                if label.startswith('B-'):
                    if current_entity:
                        ent_text = ' '.join(current_entity)
                        db_match = db.lookup_arabic(ent_text)
                        entities.append({
                            'text_ar': ent_text,
                            'text_en': db_match['en'] if db_match else '',
                            'type': _map_ner_label(current_label),
                            'confidence': 0.85,
                            'source': 'camel_ner',
                            'country': db_match.get('country', '') if db_match else '',
                        })
                    current_entity = [token]
                    current_label = label[2:]
                elif label.startswith('I-') and current_label:
                    current_entity.append(token)
                else:
                    if current_entity:
                        ent_text = ' '.join(current_entity)
                        db_match = db.lookup_arabic(ent_text)
                        entities.append({
                            'text_ar': ent_text,
                            'text_en': db_match['en'] if db_match else '',
                            'type': _map_ner_label(current_label),
                            'confidence': 0.85,
                            'source': 'camel_ner',
                            'country': db_match.get('country', '') if db_match else '',
                        })
                    current_entity = []
                    current_label = None

            if current_entity:
                ent_text = ' '.join(current_entity)
                db_match = db.lookup_arabic(ent_text)
                entities.append({
                    'text_ar': ent_text,
                    'text_en': db_match['en'] if db_match else '',
                    'type': _map_ner_label(current_label),
                    'confidence': 0.85,
                    'source': 'camel_ner',
                    'country': db_match.get('country', '') if db_match else '',
                })

            return entities
        except Exception:
            # Fall back to regex if CAMeL NER fails
            pass

    return extract_entities_regex(text)


def _map_ner_label(label: str) -> str:
    """Map CAMeL NER labels to our entity types."""
    mapping = {
        'PER': 'person',
        'ORG': 'organization',
        'LOC': 'location',
        'GPE': 'geopolitical_entity',
        'MISC': 'other',
    }
    return mapping.get(label, 'other')


# ===========================================================================
# 5. SENTIMENT ANALYSIS
# ===========================================================================

# Arabic sentiment keyword sets for military/political intelligence

_POSITIVE_KEYWORDS = {
    # Diplomatic / peace
    'سلام': 2.0, 'اتفاق': 1.5, 'اتفاقية': 1.5, 'تطبيع': 1.0,
    'مفاوضات': 1.0, 'حوار': 1.0, 'هدنة': 1.5, 'وقف إطلاق النار': 2.0,
    'تعاون': 1.5, 'شراكة': 1.0, 'تحالف': 0.5, 'دبلوماسية': 1.0,
    'مصالحة': 1.5, 'استقرار': 1.5, 'تنمية': 1.0, 'إعمار': 1.5,
    'إعادة الإعمار': 1.5, 'مساعدات': 1.0, 'إنسانية': 0.5,
    'انفتاح': 1.0, 'إصلاح': 1.0, 'انتخابات': 0.5,
    # Economic positive
    'نمو': 1.0, 'استثمار': 1.0, 'ازدهار': 1.5, 'انتعاش': 1.0,
    'ارتفاع': 0.5,
}

_NEGATIVE_KEYWORDS = {
    # Conflict
    'حرب': -2.0, 'هجوم': -1.5, 'قصف': -2.0, 'غارة': -1.5,
    'ضربة': -1.5, 'اشتباك': -1.5, 'معركة': -1.5, 'عدوان': -2.0,
    'اجتياح': -2.0, 'حصار': -1.5, 'تصعيد': -1.5,
    'انفجار': -1.5, 'تفجير': -2.0, 'اغتيال': -2.0,
    # Violence / casualties
    'قتلى': -2.0, 'شهداء': -1.5, 'جرحى': -1.5, 'ضحايا': -1.5,
    'مجزرة': -2.5, 'إبادة': -3.0, 'تهجير': -2.0, 'نزوح': -1.5,
    'لاجئين': -1.5, 'دمار': -2.0, 'تدمير': -2.0, 'خراب': -2.0,
    # Security threats
    'تهديد': -1.0, 'إرهاب': -2.0, 'إرهابي': -2.0,
    'صواريخ': -1.0, 'طائرات مسيرة': -0.5,
    'أسلحة': -0.5, 'نووي': -0.5, 'تخصيب': -0.5,
    'عقوبات': -1.0, 'حظر': -1.0,
    # Political instability
    'انقلاب': -2.0, 'أزمة': -1.5, 'توتر': -1.0, 'انهيار': -2.0,
    'فوضى': -1.5, 'احتجاجات': -1.0, 'مظاهرات': -0.5,
}

_CRITICAL_MILITARY_TERMS = {
    # Escalation indicators (weighted heavily negative)
    'إعلان حرب': -3.0, 'حالة طوارئ': -2.5, 'تعبئة عامة': -2.5,
    'استنفار': -2.0, 'تأهب': -1.5, 'حشد عسكري': -2.0,
    'إغلاق المجال الجوي': -2.5, 'قطع العلاقات': -2.0,
    'سحب السفراء': -1.5, 'إنذار': -1.5,
    'ضربة استباقية': -3.0, 'ضربة نووية': -3.0,
    'حرب شاملة': -3.0, 'غزو': -3.0,
    'انسحاب': -1.0, 'احتلال': -2.5,
    # WMD specific
    'أسلحة كيميائية': -3.0, 'أسلحة بيولوجية': -3.0,
    'رؤوس نووية': -3.0, 'تجربة صاروخية': -1.5,
    'تجربة نووية': -3.0, 'يورانيوم مخصب': -1.5,
}


def analyze_sentiment(text: str) -> Dict[str, Any]:
    """
    Analyze sentiment of Arabic text using keyword scoring.

    Returns:
        {
            'score': float (-100 to +100),
            'label': 'positive' | 'negative' | 'neutral',
            'critical_terms': List[str],
            'confidence': float (0-1),
        }
    """
    if not text:
        return {'score': 0.0, 'label': 'neutral', 'critical_terms': [], 'confidence': 0.0}

    norm_text = normalize_arabic(text)
    total_score = 0.0
    match_count = 0
    critical_found = []

    # Check critical military terms first (multi-word)
    for term, weight in _CRITICAL_MILITARY_TERMS.items():
        norm_term = normalize_arabic(term)
        if norm_term in norm_text:
            total_score += weight
            match_count += 1
            critical_found.append(term)

    # Check positive keywords
    for keyword, weight in _POSITIVE_KEYWORDS.items():
        norm_kw = normalize_arabic(keyword)
        count = norm_text.count(norm_kw)
        if count > 0:
            total_score += weight * count
            match_count += count

    # Check negative keywords
    for keyword, weight in _NEGATIVE_KEYWORDS.items():
        norm_kw = normalize_arabic(keyword)
        count = norm_text.count(norm_kw)
        if count > 0:
            total_score += weight * count
            match_count += count

    # Normalize score to -100..+100 range
    if match_count > 0:
        # Average the raw score and scale
        avg = total_score / match_count
        normalized = max(-100.0, min(100.0, avg * 33.3))
    else:
        normalized = 0.0

    # Determine label
    if normalized > 10:
        label = 'positive'
    elif normalized < -10:
        label = 'negative'
    else:
        label = 'neutral'

    # Confidence based on number of matches
    confidence = min(1.0, match_count / 5.0)

    return {
        'score': round(normalized, 2),
        'label': label,
        'critical_terms': critical_found,
        'confidence': round(confidence, 2),
    }


# ===========================================================================
# 6. DIALECT DETECTION
# ===========================================================================

# Dialect markers
_GULF_MARKERS = [
    # Gulf-specific words
    'يبه', 'يابه', 'شلونك', 'شلون', 'هالحين', 'زين', 'مب', 'ما عليه',
    'يالله', 'خوش', 'ليش', 'وين', 'شنو', 'هيه', 'اي والله',
    'عيل', 'يعني', 'خلاص', 'اهيه', 'جي', 'جذي', 'اشوي',
    'ربيعي', 'طق', 'يدوب', 'حبيت', 'ابي', 'يبيله',
]

_LEVANTINE_MARKERS = [
    # Levantine-specific words
    'هلق', 'هلأ', 'كيفك', 'منيح', 'هيك', 'شو', 'ليش',
    'كتير', 'هون', 'بدي', 'رح', 'عم', 'يلا', 'طيب',
    'والله', 'هالشي', 'هاد', 'قديش', 'أديش', 'معلش',
]

_EGYPTIAN_MARKERS = [
    # Egyptian Arabic markers
    'ازيك', 'إزيك', 'كويس', 'عايز', 'عاوز', 'بتاع', 'بتاعت',
    'ده', 'دي', 'دول', 'فين', 'كده', 'خلاص', 'يعني',
    'حاجة', 'ممكن', 'عشان', 'بقى', 'أهو', 'مفيش',
]

_MSA_MARKERS = [
    # Modern Standard Arabic formal markers
    'إن', 'أن', 'الذي', 'التي', 'اللذان', 'اللتان', 'الذين', 'اللواتي',
    'حيث', 'بينما', 'على الرغم', 'بالإضافة إلى', 'فيما يتعلق',
    'وفقاً', 'نظراً', 'استناداً', 'علاوة على', 'من جهة أخرى',
    'أعلن', 'صرح', 'أكد', 'أشار', 'أفاد', 'ذكر',
]


def _word_boundary_match(marker: str, text: str) -> bool:
    """Check if marker appears as a whole word (or word boundary) in text."""
    # Use regex word boundary with Arabic-aware matching
    pattern = r'(?:^|\s)' + re.escape(marker) + r'(?:\s|$|[،؛؟!\.,:;])'
    return bool(re.search(pattern, text))


def detect_dialect(text: str) -> Dict[str, Any]:
    """
    Detect Arabic dialect: MSA, Gulf, Levantine, or Egyptian.

    Returns:
        {
            'dialect': 'msa' | 'gulf' | 'levantine' | 'egyptian' | 'unknown',
            'confidence': float (0-1),
            'markers_found': List[str],
        }
    """
    if not text or not is_arabic(text):
        return {'dialect': 'unknown', 'confidence': 0.0, 'markers_found': []}

    norm_text = normalize_arabic(text)
    scores = {'msa': 0, 'gulf': 0, 'levantine': 0, 'egyptian': 0}
    all_markers = {'msa': [], 'gulf': [], 'levantine': [], 'egyptian': []}

    for marker in _MSA_MARKERS:
        norm_marker = normalize_arabic(marker)
        if _word_boundary_match(norm_marker, norm_text):
            scores['msa'] += 1
            all_markers['msa'].append(marker)

    for marker in _GULF_MARKERS:
        norm_marker = normalize_arabic(marker)
        if _word_boundary_match(norm_marker, norm_text):
            scores['gulf'] += 1
            all_markers['gulf'].append(marker)

    for marker in _LEVANTINE_MARKERS:
        norm_marker = normalize_arabic(marker)
        if _word_boundary_match(norm_marker, norm_text):
            scores['levantine'] += 1
            all_markers['levantine'].append(marker)

    for marker in _EGYPTIAN_MARKERS:
        norm_marker = normalize_arabic(marker)
        if _word_boundary_match(norm_marker, norm_text):
            scores['egyptian'] += 1
            all_markers['egyptian'].append(marker)

    total = sum(scores.values())
    if total == 0:
        # Default to MSA for news text with no colloquial markers
        return {'dialect': 'msa', 'confidence': 0.3, 'markers_found': []}

    best_dialect = max(scores, key=scores.get)
    confidence = scores[best_dialect] / max(total, 1)

    return {
        'dialect': best_dialect,
        'confidence': round(min(1.0, confidence), 2),
        'markers_found': all_markers[best_dialect],
    }


# ===========================================================================
# 7. BABEL MODULE ENTRY POINT (stdin/stdout JSON protocol)
# ===========================================================================

def process_text(text: str) -> Dict[str, Any]:
    """
    Full BABEL pipeline: detect language -> normalize -> extract entities ->
    analyze sentiment -> detect dialect.

    Returns output in the format specified by ARCHITECTURE.md section 9.5.
    """
    lang = detect_language(text)

    if lang == 'en':
        # English text -- minimal processing, pass to ARGUS
        return {
            'module': 'babel',
            'version': '1.0.0',
            'dataSource': 'live',
            'data': {
                'detectedLanguage': 'en',
                'entities': [],
                'sentiment': {'score': 0.0, 'label': 'neutral', 'critical_terms': [], 'confidence': 0.0},
                'dialect': {'dialect': 'n/a', 'confidence': 0.0, 'markers_found': []},
            }
        }

    # Arabic or mixed text
    normalized = normalize_arabic(text)
    entities = extract_entities(text)
    sentiment = analyze_sentiment(text)
    dialect = detect_dialect(text)

    # Format entities per ARCHITECTURE.md contract
    formatted_entities = []
    for ent in entities:
        formatted_entities.append({
            'text_ar': ent.get('text_ar', ''),
            'text_en': ent.get('text_en', ''),
            'type': ent.get('type', 'other'),
            'confidence': ent.get('confidence', 0.5),
            'transliteration': '',  # Filled by arabic_transliteration.py
            'country': ent.get('country', ''),
        })

    return {
        'module': 'babel',
        'version': '1.0.0',
        'dataSource': 'live',
        'data': {
            'detectedLanguage': lang,
            'entities': formatted_entities,
            'normalizedText': normalized,
            'sentiment': sentiment,
            'dialect': dialect,
        }
    }


def main():
    """
    stdin/stdout protocol per Marcus's module contract:
    Read JSON from stdin, process, write JSON to stdout.
    Exit 0 on success, 1 on failure (stderr has error).
    """
    try:
        input_data = json.load(sys.stdin)
        text = input_data.get('text', '')

        if not text:
            result = {
                'module': 'babel',
                'version': '1.0.0',
                'dataSource': 'live',
                'data': {
                    'detectedLanguage': 'unknown',
                    'entities': [],
                    'sentiment': {'score': 0.0, 'label': 'neutral', 'critical_terms': [], 'confidence': 0.0},
                    'dialect': {'dialect': 'unknown', 'confidence': 0.0, 'markers_found': []},
                }
            }
        else:
            result = process_text(text)

        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f'BABEL error: {str(e)}\n')
        sys.exit(1)


if __name__ == '__main__':
    main()
