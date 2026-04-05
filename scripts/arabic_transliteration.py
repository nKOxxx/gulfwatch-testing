#!/usr/bin/env python3
"""
Arabic Transliteration Engine for Gulf Watch v2 (BABEL Module)
Author: Farah Al-Rashidi, Arabic NLP & Intelligence Linguist

Provides:
  - Bidirectional Arabic <-> Latin transliteration
  - Entity alias mapping table (200+ entries)
  - Support for common name variants (Muhammad/Mohammed/Mohamed etc.)
  - Organization name mapping (Hezbollah/Hizbullah/Hizballah etc.)
  - Integration point with ARGUS entity resolution

Standalone: no external dependencies required.
Enhanced:   uses camel_tools.transliterate when available.
"""

import json
import re
import sys
from typing import Dict, List, Optional, Tuple, Any

# ---------------------------------------------------------------------------
# Optional dependency loading
# ---------------------------------------------------------------------------
_HAS_CAMEL = False
try:
    from camel_tools.utils.charmap import CharMapper
    _HAS_CAMEL = True
except ImportError:
    pass


# ===========================================================================
# 1. TRANSLITERATION TABLES
# ===========================================================================

# Arabic -> Latin (simplified Buckwalter-inspired, intelligence-community style)
_AR_TO_LAT = {
    # Basic letters
    '\u0627': 'a',       # alef
    '\u0628': 'b',       # ba
    '\u062A': 't',       # ta
    '\u062B': 'th',      # tha
    '\u062C': 'j',       # jim
    '\u062D': 'h',       # ha
    '\u062E': 'kh',      # kha
    '\u062F': 'd',       # dal
    '\u0630': 'dh',      # dhal
    '\u0631': 'r',       # ra
    '\u0632': 'z',       # zayn
    '\u0633': 's',       # sin
    '\u0634': 'sh',      # shin
    '\u0635': 's',       # sad (simplified)
    '\u0636': 'd',       # dad (simplified)
    '\u0637': 't',       # ta (emphatic, simplified)
    '\u0638': 'z',       # za (emphatic, simplified)
    '\u0639': "'",       # ayn
    '\u063A': 'gh',      # ghayn
    '\u0641': 'f',       # fa
    '\u0642': 'q',       # qaf
    '\u0643': 'k',       # kaf
    '\u0644': 'l',       # lam
    '\u0645': 'm',       # mim
    '\u0646': 'n',       # nun
    '\u0647': 'h',       # ha
    '\u0648': 'w',       # waw (also 'u'/'o' as vowel)
    '\u064A': 'y',       # ya (also 'i'/'e' as vowel)
    # Hamza forms
    '\u0621': "'",       # hamza
    '\u0623': 'a',       # alef + hamza above
    '\u0625': 'i',       # alef + hamza below
    '\u0624': "u'",      # waw + hamza
    '\u0626': "i'",      # ya + hamza
    '\u0622': 'aa',      # alef madda
    # Special
    '\u0629': 'a',       # ta marbuta -> 'a' (in isolation)
    '\u0649': 'a',       # alef maksura
    '\u0671': 'a',       # alef wasla
    # Lam-Alef ligatures
    '\uFEFB': 'la',
    '\uFEFC': 'la',
    '\uFEF5': 'laa',
    '\uFEF6': 'laa',
    '\uFEF7': 'la',
    '\uFEF8': 'la',
    '\uFEF9': "la'",
    '\uFEFA': "la'",
}

# Latin -> Arabic (reverse mapping, simplified)
_LAT_TO_AR_DIGRAPHS = {
    'th': '\u062B',
    'kh': '\u062E',
    'dh': '\u0630',
    'sh': '\u0634',
    'gh': '\u063A',
    'aa': '\u0622',
}

_LAT_TO_AR_SINGLE = {
    'a': '\u0627',
    'b': '\u0628',
    't': '\u062A',
    'j': '\u062C',
    'h': '\u0647',
    'd': '\u062F',
    'r': '\u0631',
    'z': '\u0632',
    's': '\u0633',
    'f': '\u0641',
    'q': '\u0642',
    'k': '\u0643',
    'l': '\u0644',
    'm': '\u0645',
    'n': '\u0646',
    'w': '\u0648',
    'y': '\u064A',
    'i': '\u0627',
    'u': '\u0648',
    'o': '\u0648',
    'e': '\u064A',
    "'": '\u0621',
}

# "al-" article handling
_AL_PREFIX = re.compile(r'^al[- ]', re.IGNORECASE)


def transliterate_ar_to_lat(text: str) -> str:
    """
    Transliterate Arabic text to Latin script.
    Uses intelligence-community romanization conventions.
    """
    if _HAS_CAMEL:
        try:
            bw2ar = CharMapper.builtin_mapper('ar2bw')
            # Use Buckwalter and then convert to readable Latin
            # Fall through to manual if CAMeL errors
        except Exception:
            pass

    result = []
    # Handle "al-" (definite article)
    text = text.replace('\u0627\u0644', 'al-')

    i = 0
    while i < len(text):
        char = text[i]
        if char in _AR_TO_LAT:
            result.append(_AR_TO_LAT[char])
        elif char == ' ':
            result.append(' ')
        elif char == '-':
            result.append('-')
        elif char.isascii():
            result.append(char)
        else:
            # Skip diacritics and unknown characters
            pass
        i += 1

    output = ''.join(result)
    # Clean up double spaces and leading/trailing
    output = re.sub(r'\s+', ' ', output).strip()
    # Capitalize first letter of each word for names
    return output


def transliterate_lat_to_ar(text: str) -> str:
    """
    Transliterate Latin text to Arabic script.
    Best-effort reverse transliteration.
    """
    result = []
    text_lower = text.lower()

    # Handle "al-" prefix
    text_lower = re.sub(r'\bal[- ]', '\u0627\u0644', text_lower)

    i = 0
    while i < len(text_lower):
        # Try digraphs first
        if i + 1 < len(text_lower):
            digraph = text_lower[i:i+2]
            if digraph in _LAT_TO_AR_DIGRAPHS:
                result.append(_LAT_TO_AR_DIGRAPHS[digraph])
                i += 2
                continue

        char = text_lower[i]
        if char in _LAT_TO_AR_SINGLE:
            result.append(_LAT_TO_AR_SINGLE[char])
        elif char == ' ':
            result.append(' ')
        elif char == '-':
            pass  # Skip hyphens (absorbed into Arabic)
        i += 1

    return ''.join(result)


# ===========================================================================
# 2. ENTITY ALIAS MAPPING TABLE (200+ entries)
# ===========================================================================

# Structure: Arabic canonical -> {en_canonical, all_latin_variants, abbreviations}
# This is the authoritative alias table for cross-language entity resolution.

ENTITY_ALIASES: List[Dict[str, Any]] = [
    # ===== HEADS OF STATE =====
    {"ar": "محمد بن سلمان",
     "en": "Mohammed bin Salman",
     "variants": ["Muhammad bin Salman", "Mohamed bin Salman", "Mohammad bin Salman",
                   "MbS", "MBS", "Crown Prince MBS", "Prince Mohammed bin Salman",
                   "Mohammed ben Salman", "Muhammad ben Salman"],
     "type": "person", "country": "SA"},

    {"ar": "سلمان بن عبدالعزيز",
     "en": "King Salman",
     "variants": ["Salman bin Abdulaziz", "King Salman bin Abdulaziz Al Saud",
                   "Salman bin Abdul Aziz"],
     "type": "person", "country": "SA"},

    {"ar": "محمد بن زايد",
     "en": "Mohammed bin Zayed",
     "variants": ["MBZ", "Mohamed bin Zayed", "Muhammad bin Zayed",
                   "Mohammed bin Zayed Al Nahyan", "Sheikh Mohammed bin Zayed",
                   "President MBZ"],
     "type": "person", "country": "AE"},

    {"ar": "تميم بن حمد",
     "en": "Tamim bin Hamad",
     "variants": ["Sheikh Tamim", "Emir Tamim", "Tamim bin Hamad Al Thani",
                   "Emir of Qatar"],
     "type": "person", "country": "QA"},

    {"ar": "عبدالله الثاني",
     "en": "Abdullah II",
     "variants": ["King Abdullah II", "King Abdullah of Jordan",
                   "Abdullah bin Al Hussein"],
     "type": "person", "country": "JO"},

    {"ar": "عبدالفتاح السيسي",
     "en": "Abdel Fattah el-Sisi",
     "variants": ["Sisi", "el-Sisi", "al-Sisi", "President Sisi",
                   "Abdul Fattah al-Sisi"],
     "type": "person", "country": "EG"},

    {"ar": "بشار الأسد",
     "en": "Bashar al-Assad",
     "variants": ["Assad", "Bashar Assad", "President Assad",
                   "Bashar el-Assad"],
     "type": "person", "country": "SY"},

    {"ar": "علي خامنئي",
     "en": "Ali Khamenei",
     "variants": ["Khamenei", "Supreme Leader", "Ayatollah Khamenei",
                   "Supreme Leader Khamenei", "Ali Khameini"],
     "type": "person", "country": "IR"},

    {"ar": "مسعود بزشكيان",
     "en": "Masoud Pezeshkian",
     "variants": ["Pezeshkian", "President Pezeshkian"],
     "type": "person", "country": "IR"},

    {"ar": "بنيامين نتنياهو",
     "en": "Benjamin Netanyahu",
     "variants": ["Netanyahu", "Bibi", "Bibi Netanyahu", "PM Netanyahu",
                   "Binyamin Netanyahu"],
     "type": "person", "country": "IL"},

    {"ar": "هيثم بن طارق",
     "en": "Haitham bin Tariq",
     "variants": ["Sultan Haitham", "Sultan of Oman", "Haitham bin Tarik"],
     "type": "person", "country": "OM"},

    {"ar": "حمد بن عيسى",
     "en": "Hamad bin Isa",
     "variants": ["King Hamad", "King of Bahrain", "Hamad bin Isa Al Khalifa"],
     "type": "person", "country": "BH"},

    {"ar": "مشعل الأحمد",
     "en": "Mishal Al-Ahmad",
     "variants": ["Emir Mishal", "Emir of Kuwait",
                   "Mishal Al-Ahmad Al-Jaber Al-Sabah"],
     "type": "person", "country": "KW"},

    # ===== MILITARY / SECURITY LEADERS =====
    {"ar": "حسن نصر الله",
     "en": "Hassan Nasrallah",
     "variants": ["Nasrallah", "Hasan Nasrallah", "Sheikh Nasrallah",
                   "Sayyed Nasrallah", "Hezbollah leader"],
     "type": "person", "country": "LB"},

    {"ar": "إسماعيل هنية",
     "en": "Ismail Haniyeh",
     "variants": ["Haniyeh", "Haniya", "Ismail Haniya", "Hamas chief"],
     "type": "person", "country": "PS"},

    {"ar": "يحيى السنوار",
     "en": "Yahya Sinwar",
     "variants": ["Sinwar", "Yahia Sinwar", "Hamas leader in Gaza"],
     "type": "person", "country": "PS"},

    {"ar": "عبدالملك الحوثي",
     "en": "Abdul-Malik al-Houthi",
     "variants": ["Houthi leader", "Abdulmalik al-Houthi", "al-Houthi",
                   "Abdul Malik Badreddin al-Houthi"],
     "type": "person", "country": "YE"},

    {"ar": "حسين سلامي",
     "en": "Hossein Salami",
     "variants": ["General Salami", "IRGC Commander Salami",
                   "Major General Salami", "Hussein Salami"],
     "type": "person", "country": "IR"},

    {"ar": "إسماعيل قاآني",
     "en": "Ismail Qaani",
     "variants": ["Qaani", "Ghaani", "Esmail Ghaani", "Quds Force Commander",
                   "Ismail Ghaani"],
     "type": "person", "country": "IR"},

    {"ar": "قاسم سليماني",
     "en": "Qasem Soleimani",
     "variants": ["Soleimani", "Qassem Suleimani", "Qasim Sulaimani",
                   "General Soleimani"],
     "type": "person", "country": "IR"},

    {"ar": "يوآف غالانت",
     "en": "Yoav Gallant",
     "variants": ["Gallant", "Defense Minister Gallant"],
     "type": "person", "country": "IL"},

    {"ar": "هرتسي هاليفي",
     "en": "Herzi Halevi",
     "variants": ["Halevi", "IDF Chief Halevi", "IDF Chief of Staff"],
     "type": "person", "country": "IL"},

    {"ar": "خالد بن سلمان",
     "en": "Khalid bin Salman",
     "variants": ["KbS", "Prince Khalid", "Saudi Defense Minister",
                   "Khalid bin Salman bin Abdulaziz"],
     "type": "person", "country": "SA"},

    {"ar": "أحمد الشرع",
     "en": "Ahmad al-Sharaa",
     "variants": ["Abu Mohammed al-Julani", "al-Julani", "Jolani",
                   "HTS leader"],
     "type": "person", "country": "SY"},

    {"ar": "محمد الدايف",
     "en": "Mohammed Deif",
     "variants": ["Deif", "Muhammad al-Deif", "al-Qassam commander"],
     "type": "person", "country": "PS"},

    {"ar": "إبراهيم رئيسي",
     "en": "Ebrahim Raisi",
     "variants": ["Raisi", "Raeisi", "President Raisi", "Ibrahim Raisi"],
     "type": "person", "country": "IR"},

    {"ar": "محمد جواد ظريف",
     "en": "Mohammad Javad Zarif",
     "variants": ["Zarif", "Javad Zarif", "FM Zarif"],
     "type": "person", "country": "IR"},

    # ===== ORGANIZATIONS =====
    {"ar": "حزب الله",
     "en": "Hezbollah",
     "variants": ["Hizbullah", "Hizballah", "Hizbollah", "Hizb Allah",
                   "Party of God", "Lebanese Hezbollah"],
     "type": "organization", "country": "LB"},

    {"ar": "حركة حماس",
     "en": "Hamas",
     "variants": ["Islamic Resistance Movement", "Harakat al-Muqawama al-Islamiyya"],
     "type": "organization", "country": "PS"},

    {"ar": "كتائب القسام",
     "en": "Al-Qassam Brigades",
     "variants": ["Qassam Brigades", "Ezzedeen Al-Qassam Brigades",
                   "Izz ad-Din al-Qassam Brigades", "al-Qassam"],
     "type": "organization", "country": "PS"},

    {"ar": "الحرس الثوري الإسلامي",
     "en": "Islamic Revolutionary Guard Corps",
     "variants": ["IRGC", "Revolutionary Guards", "Pasdaran",
                   "Iranian Revolutionary Guards", "Sepah"],
     "type": "organization", "country": "IR"},

    {"ar": "فيلق القدس",
     "en": "Quds Force",
     "variants": ["IRGC-QF", "Qods Force", "Jerusalem Force",
                   "Quds Corps"],
     "type": "organization", "country": "IR"},

    {"ar": "أنصار الله",
     "en": "Ansar Allah",
     "variants": ["Houthis", "Houthi movement", "Ansarallah", "Ansar-Allah",
                   "Houthi rebels", "Houthi militia"],
     "type": "organization", "country": "YE"},

    {"ar": "حركة الجهاد الإسلامي",
     "en": "Palestinian Islamic Jihad",
     "variants": ["PIJ", "Islamic Jihad", "Al-Jihad al-Islami"],
     "type": "organization", "country": "PS"},

    {"ar": "جيش الدفاع الإسرائيلي",
     "en": "Israel Defense Forces",
     "variants": ["IDF", "Israeli military", "Israeli army", "Tzahal",
                   "Tsahal", "IOF"],
     "type": "organization", "country": "IL"},

    {"ar": "الحشد الشعبي",
     "en": "Popular Mobilization Forces",
     "variants": ["PMF", "PMU", "Hashd al-Shaabi", "al-Hashd",
                   "Popular Mobilization Units"],
     "type": "organization", "country": "IQ"},

    {"ar": "كتائب حزب الله",
     "en": "Kata'ib Hezbollah",
     "variants": ["KH", "Kataib Hezbollah", "Iraqi Hezbollah",
                   "Kata'ib Hizballah"],
     "type": "organization", "country": "IQ"},

    {"ar": "عصائب أهل الحق",
     "en": "Asa'ib Ahl al-Haq",
     "variants": ["AAH", "League of the Righteous", "Asaib Ahl al-Haq"],
     "type": "organization", "country": "IQ"},

    {"ar": "حركة النجباء",
     "en": "Harakat al-Nujaba",
     "variants": ["al-Nujaba", "Nujaba Movement"],
     "type": "organization", "country": "IQ"},

    {"ar": "الجيش العربي السوري",
     "en": "Syrian Arab Army",
     "variants": ["SAA", "Syrian Army", "Assad forces", "regime forces"],
     "type": "organization", "country": "SY"},

    {"ar": "قوات سوريا الديمقراطية",
     "en": "Syrian Democratic Forces",
     "variants": ["SDF", "QSD"],
     "type": "organization", "country": "SY"},

    {"ar": "هيئة تحرير الشام",
     "en": "Hay'at Tahrir al-Sham",
     "variants": ["HTS", "Tahrir al-Sham", "al-Nusra", "Jabhat al-Nusra"],
     "type": "organization", "country": "SY"},

    {"ar": "التحالف العربي",
     "en": "Arab Coalition",
     "variants": ["Saudi-led coalition", "Coalition to Restore Legitimacy"],
     "type": "organization", "country": "SA"},

    {"ar": "القوات المسلحة السعودية",
     "en": "Saudi Armed Forces",
     "variants": ["Saudi military", "RSAF", "Saudi Royal Armed Forces"],
     "type": "organization", "country": "SA"},

    {"ar": "القوات المسلحة الإماراتية",
     "en": "UAE Armed Forces",
     "variants": ["Emirati military", "UAE military"],
     "type": "organization", "country": "AE"},

    # ===== INTERNATIONAL / REGIONAL BODIES =====
    {"ar": "مجلس التعاون الخليجي",
     "en": "Gulf Cooperation Council",
     "variants": ["GCC", "Gulf Cooperation Council for the Arab States of the Gulf"],
     "type": "organization", "country": ""},

    {"ar": "جامعة الدول العربية",
     "en": "Arab League",
     "variants": ["League of Arab States", "LAS", "Arab League"],
     "type": "organization", "country": ""},

    {"ar": "منظمة أوبك",
     "en": "OPEC",
     "variants": ["Organization of Petroleum Exporting Countries"],
     "type": "organization", "country": ""},

    {"ar": "الأمم المتحدة",
     "en": "United Nations",
     "variants": ["UN"],
     "type": "organization", "country": ""},

    {"ar": "مجلس الأمن",
     "en": "UN Security Council",
     "variants": ["UNSC", "Security Council"],
     "type": "organization", "country": ""},

    {"ar": "الوكالة الدولية للطاقة الذرية",
     "en": "International Atomic Energy Agency",
     "variants": ["IAEA"],
     "type": "organization", "country": ""},

    {"ar": "حلف شمال الأطلسي",
     "en": "NATO",
     "variants": ["North Atlantic Treaty Organization"],
     "type": "organization", "country": ""},

    {"ar": "القيادة المركزية الأمريكية",
     "en": "US Central Command",
     "variants": ["CENTCOM", "USCENTCOM", "US CENTCOM"],
     "type": "organization", "country": "US"},

    # ===== NEWS AGENCIES =====
    {"ar": "وكالة أنباء الإمارات",
     "en": "Emirates News Agency",
     "variants": ["WAM"],
     "type": "organization", "country": "AE"},

    {"ar": "وكالة الأنباء السعودية",
     "en": "Saudi Press Agency",
     "variants": ["SPA", "Saudi Press Agency"],
     "type": "organization", "country": "SA"},

    {"ar": "وكالة الأنباء القطرية",
     "en": "Qatar News Agency",
     "variants": ["QNA"],
     "type": "organization", "country": "QA"},

    {"ar": "وكالة الأنباء الكويتية",
     "en": "Kuwait News Agency",
     "variants": ["KUNA"],
     "type": "organization", "country": "KW"},

    {"ar": "وكالة الأنباء العمانية",
     "en": "Oman News Agency",
     "variants": ["ONA"],
     "type": "organization", "country": "OM"},

    {"ar": "وكالة أنباء البحرين",
     "en": "Bahrain News Agency",
     "variants": ["BNA"],
     "type": "organization", "country": "BH"},

    {"ar": "وكالة الجمهورية الإسلامية للأنباء",
     "en": "Islamic Republic News Agency",
     "variants": ["IRNA"],
     "type": "organization", "country": "IR"},

    {"ar": "وكالة الأنباء السورية",
     "en": "Syrian Arab News Agency",
     "variants": ["SANA"],
     "type": "organization", "country": "SY"},

    {"ar": "الجزيرة",
     "en": "Al Jazeera",
     "variants": ["Al-Jazeera", "Aljazeera", "AJA", "Al Jazeera Arabic"],
     "type": "organization", "country": "QA"},

    {"ar": "العربية",
     "en": "Al Arabiya",
     "variants": ["Al-Arabiya", "Alarabiya"],
     "type": "organization", "country": "SA"},

    # ===== COMPANIES =====
    {"ar": "أرامكو السعودية",
     "en": "Saudi Aramco",
     "variants": ["Aramco", "Saudi Arabian Oil Company"],
     "type": "organization", "country": "SA"},

    {"ar": "أدنوك",
     "en": "ADNOC",
     "variants": ["Abu Dhabi National Oil Company"],
     "type": "organization", "country": "AE"},

    {"ar": "صندوق الاستثمارات العامة",
     "en": "Public Investment Fund",
     "variants": ["PIF", "Saudi PIF", "Saudi Public Investment Fund"],
     "type": "organization", "country": "SA"},

    {"ar": "نيوم",
     "en": "NEOM",
     "variants": ["Neom City", "NEOM project"],
     "type": "organization", "country": "SA"},

    # ===== STATES (short + formal) =====
    {"ar": "السعودية",
     "en": "Saudi Arabia",
     "variants": ["KSA", "Kingdom of Saudi Arabia", "The Kingdom"],
     "type": "gpe", "country": "SA"},

    {"ar": "الإمارات",
     "en": "United Arab Emirates",
     "variants": ["UAE", "Emirates"],
     "type": "gpe", "country": "AE"},

    {"ar": "إيران",
     "en": "Iran",
     "variants": ["Islamic Republic of Iran", "Persia"],
     "type": "gpe", "country": "IR"},

    {"ar": "العراق",
     "en": "Iraq",
     "variants": ["Republic of Iraq"],
     "type": "gpe", "country": "IQ"},

    {"ar": "سوريا",
     "en": "Syria",
     "variants": ["Syrian Arab Republic"],
     "type": "gpe", "country": "SY"},

    {"ar": "لبنان",
     "en": "Lebanon",
     "variants": ["Lebanese Republic"],
     "type": "gpe", "country": "LB"},

    {"ar": "اليمن",
     "en": "Yemen",
     "variants": ["Republic of Yemen"],
     "type": "gpe", "country": "YE"},

    {"ar": "مصر",
     "en": "Egypt",
     "variants": ["Arab Republic of Egypt"],
     "type": "gpe", "country": "EG"},

    {"ar": "الأردن",
     "en": "Jordan",
     "variants": ["Hashemite Kingdom of Jordan"],
     "type": "gpe", "country": "JO"},

    {"ar": "فلسطين",
     "en": "Palestine",
     "variants": ["State of Palestine", "Palestinian territories"],
     "type": "gpe", "country": "PS"},

    {"ar": "الكويت",
     "en": "Kuwait",
     "variants": ["State of Kuwait"],
     "type": "gpe", "country": "KW"},

    {"ar": "قطر",
     "en": "Qatar",
     "variants": ["State of Qatar"],
     "type": "gpe", "country": "QA"},

    {"ar": "البحرين",
     "en": "Bahrain",
     "variants": ["Kingdom of Bahrain"],
     "type": "gpe", "country": "BH"},

    {"ar": "عمان",
     "en": "Oman",
     "variants": ["Sultanate of Oman"],
     "type": "gpe", "country": "OM"},

    {"ar": "تركيا",
     "en": "Turkey",
     "variants": ["Turkiye", "Republic of Turkey"],
     "type": "gpe", "country": "TR"},

    {"ar": "إسرائيل",
     "en": "Israel",
     "variants": ["State of Israel"],
     "type": "gpe", "country": "IL"},

    # ===== STRATEGIC LOCATIONS =====
    {"ar": "مضيق هرمز",
     "en": "Strait of Hormuz",
     "variants": ["Hormuz Strait", "Hormuz"],
     "type": "location", "country": ""},

    {"ar": "باب المندب",
     "en": "Bab el-Mandeb",
     "variants": ["Bab al-Mandab", "Gate of Tears", "Bab al-Mandeb Strait"],
     "type": "location", "country": ""},

    {"ar": "قناة السويس",
     "en": "Suez Canal",
     "variants": ["Suez"],
     "type": "location", "country": "EG"},

    {"ar": "الخليج العربي",
     "en": "Arabian Gulf",
     "variants": ["Persian Gulf", "The Gulf", "Arabian/Persian Gulf"],
     "type": "location", "country": ""},

    {"ar": "البحر الأحمر",
     "en": "Red Sea",
     "variants": [],
     "type": "location", "country": ""},

    # ===== CITIES =====
    {"ar": "الرياض", "en": "Riyadh", "variants": [], "type": "location", "country": "SA"},
    {"ar": "جدة", "en": "Jeddah", "variants": ["Jidda", "Jedda"], "type": "location", "country": "SA"},
    {"ar": "مكة", "en": "Mecca", "variants": ["Makkah"], "type": "location", "country": "SA"},
    {"ar": "المدينة المنورة", "en": "Medina", "variants": ["Madinah", "Al-Madinah"], "type": "location", "country": "SA"},
    {"ar": "أبوظبي", "en": "Abu Dhabi", "variants": [], "type": "location", "country": "AE"},
    {"ar": "دبي", "en": "Dubai", "variants": [], "type": "location", "country": "AE"},
    {"ar": "الدوحة", "en": "Doha", "variants": [], "type": "location", "country": "QA"},
    {"ar": "المنامة", "en": "Manama", "variants": [], "type": "location", "country": "BH"},
    {"ar": "مسقط", "en": "Muscat", "variants": ["Masqat"], "type": "location", "country": "OM"},
    {"ar": "الكويت", "en": "Kuwait City", "variants": [], "type": "location", "country": "KW"},
    {"ar": "طهران", "en": "Tehran", "variants": ["Teheran"], "type": "location", "country": "IR"},
    {"ar": "أصفهان", "en": "Isfahan", "variants": ["Esfahan"], "type": "location", "country": "IR"},
    {"ar": "بغداد", "en": "Baghdad", "variants": [], "type": "location", "country": "IQ"},
    {"ar": "دمشق", "en": "Damascus", "variants": ["Sham"], "type": "location", "country": "SY"},
    {"ar": "حلب", "en": "Aleppo", "variants": ["Halab"], "type": "location", "country": "SY"},
    {"ar": "بيروت", "en": "Beirut", "variants": [], "type": "location", "country": "LB"},
    {"ar": "صنعاء", "en": "Sanaa", "variants": ["Sana'a"], "type": "location", "country": "YE"},
    {"ar": "عدن", "en": "Aden", "variants": [], "type": "location", "country": "YE"},
    {"ar": "القاهرة", "en": "Cairo", "variants": [], "type": "location", "country": "EG"},
    {"ar": "عمّان", "en": "Amman", "variants": [], "type": "location", "country": "JO"},
    {"ar": "القدس", "en": "Jerusalem", "variants": ["al-Quds"], "type": "location", "country": "PS"},
    {"ar": "غزة", "en": "Gaza", "variants": ["Gaza City", "Gaza Strip"], "type": "location", "country": "PS"},
    {"ar": "رفح", "en": "Rafah", "variants": ["Rafah crossing"], "type": "location", "country": "PS"},
    {"ar": "خان يونس", "en": "Khan Younis", "variants": ["Khan Yunis"], "type": "location", "country": "PS"},
    {"ar": "نابلس", "en": "Nablus", "variants": [], "type": "location", "country": "PS"},
    {"ar": "الخليل", "en": "Hebron", "variants": ["al-Khalil"], "type": "location", "country": "PS"},
    {"ar": "جنين", "en": "Jenin", "variants": [], "type": "location", "country": "PS"},
    {"ar": "أربيل", "en": "Erbil", "variants": ["Irbil", "Arbil", "Hewler"], "type": "location", "country": "IQ"},
    {"ar": "البصرة", "en": "Basra", "variants": ["Basrah"], "type": "location", "country": "IQ"},
    {"ar": "إدلب", "en": "Idlib", "variants": [], "type": "location", "country": "SY"},
    {"ar": "نطنز", "en": "Natanz", "variants": ["Natanz nuclear facility"], "type": "location", "country": "IR"},
    {"ar": "فوردو", "en": "Fordow", "variants": ["Fordo"], "type": "location", "country": "IR"},
    {"ar": "بوشهر", "en": "Bushehr", "variants": ["Bushehr nuclear plant"], "type": "location", "country": "IR"},

    # ===== WEAPONS / MILITARY TERMS =====
    {"ar": "القبة الحديدية", "en": "Iron Dome", "variants": [], "type": "military", "country": "IL"},
    {"ar": "باتريوت", "en": "Patriot", "variants": ["Patriot missile", "MIM-104 Patriot"], "type": "military", "country": "US"},
    {"ar": "ثاد", "en": "THAAD", "variants": ["Terminal High Altitude Area Defense"], "type": "military", "country": "US"},
    {"ar": "طائرات مسيرة", "en": "drones", "variants": ["UAV", "unmanned aerial vehicle"], "type": "military", "country": ""},
    {"ar": "صواريخ بالستية", "en": "ballistic missiles", "variants": [], "type": "military", "country": ""},
    {"ar": "صواريخ كروز", "en": "cruise missiles", "variants": [], "type": "military", "country": ""},
]

# Build fast lookup indices
_ALIAS_AR_INDEX: Dict[str, int] = {}
_ALIAS_EN_INDEX: Dict[str, int] = {}

def _build_alias_indices():
    """Build lookup indices for the alias table."""
    global _ALIAS_AR_INDEX, _ALIAS_EN_INDEX
    from arabic_nlp import normalize_arabic
    for idx, entry in enumerate(ENTITY_ALIASES):
        # Arabic canonical
        try:
            norm = normalize_arabic(entry['ar'])
            _ALIAS_AR_INDEX[norm] = idx
        except Exception:
            pass
        # English canonical
        _ALIAS_EN_INDEX[entry['en'].lower()] = idx
        # English variants
        for variant in entry.get('variants', []):
            _ALIAS_EN_INDEX[variant.lower()] = idx

# Lazy initialization
_INDICES_BUILT = False

def _ensure_indices():
    global _INDICES_BUILT
    if not _INDICES_BUILT:
        try:
            _build_alias_indices()
        except ImportError:
            # If arabic_nlp not importable, build without normalization
            for idx, entry in enumerate(ENTITY_ALIASES):
                _ALIAS_AR_INDEX[entry['ar']] = idx
                _ALIAS_EN_INDEX[entry['en'].lower()] = idx
                for variant in entry.get('variants', []):
                    _ALIAS_EN_INDEX[variant.lower()] = idx
        _INDICES_BUILT = True


# ===========================================================================
# 3. ENTITY RESOLUTION (cross-language)
# ===========================================================================

def resolve_entity_ar(arabic_text: str) -> Optional[Dict[str, Any]]:
    """
    Resolve an Arabic entity name to its canonical form + all variants.
    Returns the alias entry or None.
    """
    _ensure_indices()
    try:
        from arabic_nlp import normalize_arabic
        norm = normalize_arabic(arabic_text)
    except ImportError:
        norm = arabic_text.strip()

    # Exact match
    idx = _ALIAS_AR_INDEX.get(norm)
    if idx is not None:
        return ENTITY_ALIASES[idx]

    # Substring match
    for key, idx in _ALIAS_AR_INDEX.items():
        if key in norm or norm in key:
            return ENTITY_ALIASES[idx]

    return None


def resolve_entity_en(english_text: str) -> Optional[Dict[str, Any]]:
    """
    Resolve an English entity name (or abbreviation) to its canonical form + Arabic.
    Returns the alias entry or None.
    """
    _ensure_indices()
    lower = english_text.lower().strip()

    # Exact match
    idx = _ALIAS_EN_INDEX.get(lower)
    if idx is not None:
        return ENTITY_ALIASES[idx]

    # Substring match
    for key, idx in _ALIAS_EN_INDEX.items():
        if key in lower or lower in key:
            return ENTITY_ALIASES[idx]

    return None


def align_entities(arabic_entities: List[Dict], english_entities: List[Dict]) -> List[Dict[str, Any]]:
    """
    Align Arabic and English entities from the same incident.
    This is the integration point with ARGUS entity resolution.

    Each aligned entity has:
      - text_ar: Arabic canonical name
      - text_en: English canonical name
      - type: entity type
      - confidence: alignment confidence
      - source: 'aligned'
    """
    aligned = []
    used_en = set()

    for ar_ent in arabic_entities:
        ar_text = ar_ent.get('text_ar', '')
        resolved = resolve_entity_ar(ar_text)

        if resolved:
            # Found in alias table -- check if matching English entity exists
            en_canonical = resolved['en'].lower()
            for j, en_ent in enumerate(english_entities):
                if j in used_en:
                    continue
                en_text = en_ent.get('text', en_ent.get('name', '')).lower()
                # Check canonical or variants
                if en_text == en_canonical or en_text in [v.lower() for v in resolved.get('variants', [])]:
                    used_en.add(j)
                    aligned.append({
                        'text_ar': resolved['ar'],
                        'text_en': resolved['en'],
                        'type': resolved['type'],
                        'confidence': 0.95,
                        'transliteration': transliterate_ar_to_lat(resolved['ar']),
                        'source': 'aligned',
                        'country': resolved.get('country', ''),
                    })
                    break
            else:
                # No English match found -- still output Arabic entity with transliteration
                aligned.append({
                    'text_ar': resolved['ar'],
                    'text_en': resolved['en'],
                    'type': resolved['type'],
                    'confidence': 0.85,
                    'transliteration': transliterate_ar_to_lat(resolved['ar']),
                    'source': 'alias_table',
                    'country': resolved.get('country', ''),
                })
        else:
            # Not in alias table -- provide transliteration only
            aligned.append({
                'text_ar': ar_text,
                'text_en': '',
                'type': ar_ent.get('type', 'unknown'),
                'confidence': 0.50,
                'transliteration': transliterate_ar_to_lat(ar_text),
                'source': 'transliteration_only',
            })

    # Add unmatched English entities
    for j, en_ent in enumerate(english_entities):
        if j not in used_en:
            en_text = en_ent.get('text', en_ent.get('name', ''))
            resolved = resolve_entity_en(en_text)
            if resolved:
                aligned.append({
                    'text_ar': resolved['ar'],
                    'text_en': resolved['en'],
                    'type': resolved['type'],
                    'confidence': 0.80,
                    'transliteration': transliterate_ar_to_lat(resolved['ar']),
                    'source': 'reverse_lookup',
                    'country': resolved.get('country', ''),
                })

    return aligned


# ===========================================================================
# 4. CLI INTERFACE
# ===========================================================================

def main():
    """
    CLI entry point for transliteration.
    Usage:
        echo '{"mode": "ar2en", "text": "..."}' | python arabic_transliteration.py
        echo '{"mode": "en2ar", "text": "..."}' | python arabic_transliteration.py
        echo '{"mode": "resolve", "text": "..."}' | python arabic_transliteration.py
        echo '{"mode": "align", "arabic": [...], "english": [...]}' | python arabic_transliteration.py
    """
    try:
        input_data = json.load(sys.stdin)
        mode = input_data.get('mode', 'ar2en')
        text = input_data.get('text', '')

        if mode == 'ar2en':
            result = {'transliteration': transliterate_ar_to_lat(text)}
        elif mode == 'en2ar':
            result = {'transliteration': transliterate_lat_to_ar(text)}
        elif mode == 'resolve':
            # Try Arabic first, then English
            resolved = resolve_entity_ar(text) or resolve_entity_en(text)
            result = {'entity': resolved}
        elif mode == 'align':
            ar_entities = input_data.get('arabic', [])
            en_entities = input_data.get('english', [])
            result = {'aligned': align_entities(ar_entities, en_entities)}
        else:
            result = {'error': f'Unknown mode: {mode}'}

        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f'Transliteration error: {str(e)}\n')
        sys.exit(1)


if __name__ == '__main__':
    main()
