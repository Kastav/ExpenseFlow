import { ExpenseCategory, CurrencyCode, CATEGORIES } from '../types/expense';
import { getTodayDateString } from './formatters';

export interface ParsedVoiceExpense {
  rawTranscript: string;
  amount: number | null;
  type: 'expense' | 'income';
  category: ExpenseCategory;
  categoryConfident: boolean;
  date: string; // YYYY-MM-DD
  currencySpoken?: CurrencyCode;
  notes: string;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  suggestedPaymentMethod?: string;
}

// Spoken word to number dictionary
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  lakh: 100000,
  million: 1000000,
};

// Common currency keywords
const CURRENCY_MAP: { keywords: string[]; code: CurrencyCode }[] = [
  { keywords: ['rupee', 'rupees', 'rs', 'inr', '₹'], code: 'INR' },
  { keywords: ['dollar', 'dollars', 'bucks', 'buck', 'usd', '$'], code: 'USD' },
  { keywords: ['euro', 'euros', 'eur', '€'], code: 'EUR' },
  { keywords: ['pound', 'pounds', 'quid', 'gbp', '£'], code: 'GBP' },
  { keywords: ['cad', 'canadian dollar', 'canadian dollars'], code: 'CAD' },
  { keywords: ['aud', 'australian dollar', 'australian dollars'], code: 'AUD' },
  { keywords: ['yen', 'jpy', '¥'], code: 'JPY' },
  { keywords: ['dirham', 'dirhams', 'aed'], code: 'AED' },
  { keywords: ['franc', 'francs', 'chf'], code: 'CHF' },
  { keywords: ['real', 'reais', 'brl'], code: 'BRL' },
  { keywords: ['singapore dollar', 'sgd'], code: 'SGD' },
  { keywords: ['dinar', 'dinars', 'kwd'], code: 'KWD' },
];

export interface CategoryIntentDefinition {
  category: ExpenseCategory;
  // Generic words that ONLY represent the category itself.
  // If only generic words are present without separate merchant/item, notes remain empty.
  genericWords: string[];
  // Specific merchants, items, activities that serve as both category match AND genuine description
  specificKeywords: string[];
}

export const CATEGORY_INTENT_DEFINITIONS: CategoryIntentDefinition[] = [
  {
    category: 'Entertainment',
    genericWords: ['entertainment', 'recreation', 'fun', 'amusement', 'leisure'],
    specificKeywords: [
      'movie',
      'movies',
      'cinema',
      'netflix',
      'spotify',
      'hulu',
      'disney',
      'concert',
      'theatre',
      'theater',
      'game',
      'games',
      'gaming',
      'steam',
      'playstation',
      'xbox',
      'outing',
      'amusement park',
      'youtube premium',
      'prime video',
      'hbo',
      'show',
      'bowling',
      'arcade',
    ],
  },
  {
    category: 'Dining Out',
    genericWords: ['dining out', 'eating out', 'dining', 'eating', 'food', 'restaurant', 'restaurants'],
    specificKeywords: [
      'lunch',
      'dinner',
      'breakfast',
      'brunch',
      'cafe',
      'coffee',
      'starbucks',
      'pizza',
      'burger',
      'takeout',
      'takeaway',
      'mcdonald',
      'mcdonalds',
      'subway',
      'uber eats',
      'doordash',
      'zomato',
      'swiggy',
      'drinks',
      'cocktail',
      'cocktails',
      'beer',
      'beers',
      'snacks',
      'snack',
      'tacos',
      'bar',
      'pub',
      'bistro',
      'tea',
      'chai',
      'fast food',
      'bakery',
      'diner',
      'kfc',
      'dominos',
      'chipotle',
    ],
  },
  {
    category: 'Groceries',
    genericWords: ['groceries', 'grocery', 'household groceries'],
    specificKeywords: [
      'supermarket',
      'vegetables',
      'vegetable',
      'fruits',
      'fruit',
      'milk',
      'bread',
      'eggs',
      'walmart',
      'target',
      'trader joe',
      'trader joes',
      'whole foods',
      'provision',
      'provisions',
      'kirana',
      'ration',
      'produce',
      'veggies',
      'dal',
      'rice',
      'meat',
      'chicken',
      'fish',
      'bazaar',
    ],
  },
  {
    category: 'Transportation',
    genericWords: ['transport', 'transportation', 'commute', 'transit'],
    specificKeywords: [
      'bus',
      'train',
      'subway',
      'metro',
      'uber',
      'lyft',
      'ola',
      'taxi',
      'cab',
      'gas',
      'fuel',
      'petrol',
      'diesel',
      'parking',
      'toll',
      'car maintenance',
      'auto',
      'rickshaw',
      'fare',
      'car repair',
      'oil change',
      'ev charging',
    ],
  },
  {
    category: 'Utilities',
    genericWords: ['utilities', 'utility', 'utility bills'],
    specificKeywords: [
      'electricity bill',
      'electric bill',
      'electricity',
      'power bill',
      'water bill',
      'gas bill',
      'internet bill',
      'phone bill',
      'mobile recharge',
      'internet',
      'wifi',
      'broadband',
      'recharge',
      'cable',
      'heating',
      'sewer',
      'trash',
      'cylinder',
      'lpg',
      'airtel',
      'jio',
      'verizon',
      'at&t',
    ],
  },
  {
    category: 'Healthcare',
    genericWords: ['healthcare', 'health', 'medical'],
    specificKeywords: [
      'medicines',
      'medicine',
      'pharmacy',
      'doctor',
      'hospital',
      'dentist',
      'prescription',
      'clinic',
      'health insurance',
      'drugs',
      'pills',
      'chemist',
      'doctor visit',
      'checkup',
      'dental',
      'eyecare',
      'optical',
      'therapy',
      'counseling',
      'meds',
      'first aid',
      'lab test',
      'blood test',
    ],
  },
  {
    category: 'Housing',
    genericWords: ['housing', 'house', 'home maintenance'],
    specificKeywords: [
      'rent',
      'mortgage',
      'apartment',
      'maintenance fee',
      'hoa',
      'plumber',
      'property tax',
      'repair',
      'repairs',
      'electrician',
      'carpenter',
      'flat rent',
      'room rent',
      'house rent',
      'lease',
      'landlord',
    ],
  },
  {
    category: 'Shopping',
    genericWords: ['shopping', 'online shopping'],
    specificKeywords: [
      'clothes',
      'clothing',
      'shoes',
      'shoe',
      'sneakers',
      'apparel',
      'amazon',
      'flipkart',
      'myntra',
      'mall',
      'electronics',
      'gadget',
      'gadgets',
      'furniture',
      'store',
      'dress',
      'shirt',
      'pants',
      'jeans',
      'jacket',
      'watch',
      'bag',
      'handbag',
      'accessories',
    ],
  },
  {
    category: 'Personal Care',
    genericWords: ['personal care', 'grooming', 'self care'],
    specificKeywords: [
      'haircut',
      'salon',
      'barber',
      'spa',
      'cosmetics',
      'skincare',
      'gym',
      'fitness',
      'massage',
      'shampoo',
      'beauty',
      'makeup',
      'manicure',
      'pedicure',
      'waxing',
      'soap',
      'toiletries',
    ],
  },
  {
    category: 'Travel',
    genericWords: ['travel', 'vacation', 'holiday'],
    specificKeywords: [
      'hotel',
      'airbnb',
      'resort',
      'trip',
      'tour',
      'hostel',
      'sightseeing',
      'flight',
      'flight ticket',
      'plane ticket',
      'train ticket',
      'airline',
      'cruise',
      'booking.com',
      'expedia',
      'visa fee',
    ],
  },
  {
    category: 'Education',
    genericWords: ['education', 'learning', 'study'],
    specificKeywords: [
      'tuition',
      'course',
      'books',
      'book',
      'school',
      'college',
      'university',
      'udemy',
      'coursera',
      'class',
      'classes',
      'textbook',
      'textbooks',
      'training',
      'stationery',
      'exam fee',
      'coaching',
    ],
  },
  {
    category: 'Other',
    genericWords: ['other', 'miscellaneous', 'misc', 'random'],
    specificKeywords: [],
  },
];

const INCOME_INDICATORS = [
  'received',
  'earned',
  'income',
  'got paid',
  'salary',
  'bonus',
  'freelance',
  'dividend',
  'refund',
  'cashback',
  'deposited',
  'credit',
];

const PAYMENT_METHOD_KEYWORDS: { method: string; keywords: string[] }[] = [
  { method: 'Debit Card', keywords: ['debit card', 'debit'] },
  { method: 'Credit Card', keywords: ['credit card', 'credit', 'visa', 'mastercard', 'amex', 'card'] },
  { method: 'Cash', keywords: ['cash', 'paid cash', 'currency notes', 'paper money'] },
  { method: 'Bank Transfer', keywords: ['bank transfer', 'wire', 'direct deposit', 'neft', 'imps', 'ach', 'online banking', 'net banking'] },
  { method: 'Digital Wallet', keywords: ['wallet', 'apple pay', 'google pay', 'gpay', 'paypal', 'venmo', 'paytm', 'upi', 'phonepe', 'zelle', 'cash app', 'revolut'] },
];

/**
 * Converts spelled out word numbers into numeric value.
 * e.g. "twenty five" -> 25, "two thousand" -> 2000, "one hundred fifty" -> 150
 */
export function wordsToNumber(text: string): number | null {
  const words = text.toLowerCase().replace(/,/g, '').split(/\s+/);
  let total = 0;
  let current = 0;
  let hasNumber = false;

  for (const word of words) {
    if (NUMBER_WORDS[word] !== undefined) {
      hasNumber = true;
      const val = NUMBER_WORDS[word];
      if (val === 100) {
        current = (current === 0 ? 1 : current) * 100;
      } else if (val === 1000 || val === 100000 || val === 1000000) {
        current = (current === 0 ? 1 : current) * val;
        total += current;
        current = 0;
      } else {
        current += val;
      }
    } else if (/^\d+(\.\d+)?$/.test(word)) {
      hasNumber = true;
      const numVal = parseFloat(word);
      current += numVal;
    }
  }

  total += current;
  return hasNumber && total > 0 ? total : null;
}

/**
 * Extracts a date if explicitly mentioned in spoken input.
 */
export function extractSpokenDate(cleanText: string): string {
  const today = new Date();

  if (/\byesterday\b/i.test(cleanText)) {
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    return `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  }

  if (/\bday before yesterday\b/i.test(cleanText)) {
    const dby = new Date(today);
    dby.setDate(dby.getDate() - 2);
    return `${dby.getFullYear()}-${String(dby.getMonth() + 1).padStart(2, '0')}-${String(dby.getDate()).padStart(2, '0')}`;
  }

  return getTodayDateString();
}

/**
 * Parse natural spoken language into structured transaction details.
 * Strictly avoids guessing or fabricating data.
 */
export function parseVoiceExpense(
  transcript: string,
  currentDefaultCurrency: CurrencyCode = 'USD'
): ParsedVoiceExpense {
  const rawTranscript = transcript.trim();
  const lower = rawTranscript.toLowerCase();

  // 1. Detect Income vs Expense
  const isIncome = INCOME_INDICATORS.some((w) => lower.includes(w));
  const type: 'expense' | 'income' = isIncome ? 'income' : 'expense';

  // 2. Detect Currency Spoken
  let currencySpoken: CurrencyCode | undefined;
  for (const curr of CURRENCY_MAP) {
    if (curr.keywords.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(lower))) {
      currencySpoken = curr.code;
      break;
    }
  }

  // 3. Extract Amount
  let amount: number | null = null;
  let isAmbiguous = false;
  let ambiguityReason: string | undefined;

  const digitRegex = /(?:[$€£₹¥]\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/g;
  const matches = Array.from(lower.matchAll(digitRegex));

  const validNumbers = matches
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((n) => !isNaN(n) && n > 0 && n < 100000000);

  if (validNumbers.length === 1) {
    amount = Math.round(validNumbers[0] * 100) / 100;
  } else if (validNumbers.length > 1) {
    const currencyNearby = matches.find((m) => {
      const idx = m.index ?? 0;
      const snippet = lower.slice(Math.max(0, idx - 15), Math.min(lower.length, idx + m[0].length + 15));
      return CURRENCY_MAP.some((c) => c.keywords.some((k) => snippet.includes(k)));
    });

    if (currencyNearby) {
      amount = Math.round(parseFloat(currencyNearby[1].replace(/,/g, '')) * 100) / 100;
    } else {
      amount = Math.round(validNumbers[0] * 100) / 100;
      isAmbiguous = true;
      ambiguityReason = `Multiple numbers detected in speech (${validNumbers.join(', ')}). Please verify the amount.`;
    }
  } else {
    const wordNum = wordsToNumber(lower);
    if (wordNum !== null && wordNum > 0) {
      amount = Math.round(wordNum * 100) / 100;
    } else {
      amount = null;
      isAmbiguous = true;
      ambiguityReason = 'Could not identify the transaction amount. Please enter it manually.';
    }
  }

  // 4. Detect Category Intent with Specificity & Conflict Resolution
  const matchedCategories = new Map<ExpenseCategory, { matchedWord: string; isGeneric: boolean }>();

  for (const def of CATEGORY_INTENT_DEFINITIONS) {
    if (def.category === 'Other') continue;

    // Check specific keywords first (multi-word first, then single-word)
    const sortedSpecific = [...def.specificKeywords].sort((a, b) => b.length - a.length);
    for (const kw of sortedSpecific) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(lower)) {
        if (!matchedCategories.has(def.category)) {
          matchedCategories.set(def.category, { matchedWord: kw, isGeneric: false });
        }
        break;
      }
    }

    // Check generic words
    const sortedGeneric = [...def.genericWords].sort((a, b) => b.length - a.length);
    for (const gw of sortedGeneric) {
      const regex = new RegExp(`\\b${gw}\\b`, 'i');
      if (regex.test(lower)) {
        if (!matchedCategories.has(def.category)) {
          matchedCategories.set(def.category, { matchedWord: gw, isGeneric: true });
        }
        break;
      }
    }
  }

  let matchedCategory: ExpenseCategory = 'Other';
  let categoryConfident = false;
  let genericCategoryMatched: ExpenseCategory | null = null;

  if (matchedCategories.size === 1) {
    const [cat, info] = Array.from(matchedCategories.entries())[0];
    matchedCategory = cat;
    categoryConfident = true;
    if (info.isGeneric) {
      genericCategoryMatched = cat;
    }
  } else if (matchedCategories.size > 1) {
    // True conflict between distinct categories
    const catNames = Array.from(matchedCategories.keys());
    matchedCategory = catNames[0];
    categoryConfident = false;
    isAmbiguous = true;
    ambiguityReason = `Multiple categories detected (${catNames.join(', ')}). Please verify category.`;
  } else {
    matchedCategory = 'Other';
    categoryConfident = false;
  }

  // 5. Detect Date
  const date = extractSpokenDate(lower);

  // 6. Detect Payment Method
  let suggestedPaymentMethod: string | undefined;
  for (const pm of PAYMENT_METHOD_KEYWORDS) {
    if (pm.keywords.some((kw) => lower.includes(kw))) {
      suggestedPaymentMethod = pm.method;
      break;
    }
  }

  // 7. Clean Description / Notes
  // Distinguish between genuine merchant/item descriptions and generic category words
  let cleanNotes = rawTranscript;

  // Remove spending verbs
  cleanNotes = cleanNotes.replace(
    /\b(i\s+)?(spent|spend|pay|paid|buying|bought|purchase|purchased|cost|costs|costed|received|earned|got\s+paid|add|added|send|sent|give|gave)\b/gi,
    ' '
  );

  // Remove spoken dates
  cleanNotes = cleanNotes.replace(/\b(today|yesterday|day before yesterday|last week)\b/gi, ' ');

  // Remove currency names and symbols
  cleanNotes = cleanNotes.replace(
    /\b(rupees?|rs\.?|inr|dollars?|bucks?|usd|euros?|eur|pounds?|quid|gbp|yen|jpy|dirhams?|aed|francs?|chf|reais|real|brl|dinars?|kwd)\b/gi,
    ' '
  );

  // Remove payment methods
  cleanNotes = cleanNotes.replace(
    /\b(via\s+|with\s+|using\s+)?(credit\s+card|debit\s+card|google\s+pay|apple\s+pay|gpay|paytm|phonepe|zelle|cash\s+app|paypal|upi|card|cash|notes|wallet)\b/gi,
    ' '
  );

  // Remove numbers and word numbers
  cleanNotes = cleanNotes.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|million|point)\b/gi,
    ' '
  );
  cleanNotes = cleanNotes.replace(/(?:[$€£₹¥]\s*)?\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\b[.,;?!:]*/g, ' ');

  // Remove generic category words for the resolved category from notes
  // e.g. "coffee dining out" -> removes "dining out" leaving "coffee"
  // e.g. "90 rupees on entertainment" -> removes "entertainment" leaving ""
  const matchedDef = CATEGORY_INTENT_DEFINITIONS.find((c) => c.category === matchedCategory);
  if (matchedDef) {
    for (const gw of matchedDef.genericWords) {
      const regex = new RegExp(`\\b${gw}\\b`, 'gi');
      cleanNotes = cleanNotes.replace(regex, ' ');
    }
  }

  // Normalize punctuation and whitespace before trimming prepositions
  cleanNotes = cleanNotes.replace(/[.,;?!:]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Remove orphaned prepositions: "for", "on", "from", "at" at the start or end of the text
  cleanNotes = cleanNotes
    .replace(/^(for|on|from|to|at|in|a|an|the|of)\s+/gi, '')
    .replace(/\s+(for|on|from|to|at|in|a|an|the|of)$/gi, '')
    .replace(/^(for|on|from|to|at|in|a|an|the|of)\s+/gi, '')
    .replace(/\s+(for|on|from|to|at|in|a|an|the|of)$/gi, '')
    .trim();

  // If the remaining text is purely a preposition, article, or conjunction, clear it
  const isPrepositionOnly = /^(for|on|from|to|at|in|a|an|the|of|and|with|by|about)$/i.test(cleanNotes);

  // If cleanNotes is empty, leave as empty string (do NOT fabricate or duplicate category name into notes!)
  if (!cleanNotes || cleanNotes.length < 2 || isPrepositionOnly) {
    cleanNotes = '';
  } else {
    // If the remaining words simply repeat the category name, clear it
    if (cleanNotes.toLowerCase() === matchedCategory.toLowerCase()) {
      cleanNotes = '';
    } else {
      // Capitalize first letter of genuine description
      cleanNotes = cleanNotes.charAt(0).toUpperCase() + cleanNotes.slice(1);
    }
  }

  return {
    rawTranscript,
    amount,
    type,
    category: matchedCategory,
    categoryConfident,
    date,
    currencySpoken,
    notes: cleanNotes,
    isAmbiguous,
    ambiguityReason,
    suggestedPaymentMethod,
  };
}
