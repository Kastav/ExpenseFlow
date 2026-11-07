/**
 * Complete ISO 3166-1 country dataset and ISO 4217 currency dataset.
 * Zero external dependencies, pure static definitions for international onboarding & formatting.
 */

export interface IsoCurrency {
  code: string;
  name: string;
  symbol: string;
  decimalDigits: number;
}

export interface IsoCountry {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  defaultCurrency: string; // ISO 4217
  secondaryCurrencies?: string[];
}

/**
 * Circulating ISO 4217 fiat currencies with symbol, name, and minor unit decimals.
 * Excludes cryptocurrency and non-fiat asset codes (BTC, ETH, XAU, etc.).
 */
export const ISO_CURRENCIES: IsoCurrency[] = [
  { code: 'AED', name: 'United Arab Emirates Dirham', symbol: 'د.إ', decimalDigits: 2 },
  { code: 'AFN', name: 'Afghan Afghani', symbol: '؋', decimalDigits: 2 },
  { code: 'ALL', name: 'Albanian Lek', symbol: 'L', decimalDigits: 2 },
  { code: 'AMD', name: 'Armenian Dram', symbol: '֏', decimalDigits: 2 },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', symbol: 'ƒ', decimalDigits: 2 },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', decimalDigits: 2 },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', decimalDigits: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimalDigits: 2 },
  { code: 'AWG', name: 'Aruban Florin', symbol: 'ƒ', decimalDigits: 2 },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', decimalDigits: 2 },
  { code: 'BAM', name: 'Bosnia and Herzegovina Convertible Mark', symbol: 'KM', decimalDigits: 2 },
  { code: 'BBD', name: 'Barbadian Dollar', symbol: 'Bds$', decimalDigits: 2 },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', decimalDigits: 2 },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', decimalDigits: 2 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', decimalDigits: 3 },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu', decimalDigits: 0 },
  { code: 'BMD', name: 'Bermudian Dollar', symbol: '$', decimalDigits: 2 },
  { code: 'BND', name: 'Brunei Dollar', symbol: 'B$', decimalDigits: 2 },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.', decimalDigits: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimalDigits: 2 },
  { code: 'BSD', name: 'Bahamian Dollar', symbol: '$', decimalDigits: 2 },
  { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.', decimalDigits: 2 },
  { code: 'BWP', name: 'Botswanan Pula', symbol: 'P', decimalDigits: 2 },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br', decimalDigits: 2 },
  { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$', decimalDigits: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimalDigits: 2 },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', decimalDigits: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimalDigits: 2 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', decimalDigits: 0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimalDigits: 2 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', decimalDigits: 2 },
  { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡', decimalDigits: 2 },
  { code: 'CUP', name: 'Cuban Peso', symbol: '$', decimalDigits: 2 },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: 'Esc', decimalDigits: 2 },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', decimalDigits: 2 },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj', decimalDigits: 0 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', decimalDigits: 2 },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', decimalDigits: 2 },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج', decimalDigits: 2 },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', decimalDigits: 2 },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk', decimalDigits: 2 },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', decimalDigits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalDigits: 2 },
  { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$', decimalDigits: 2 },
  { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£', decimalDigits: 2 },
  { code: 'FOK', name: 'Faroese Króna', symbol: 'kr', decimalDigits: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimalDigits: 2 },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾', decimalDigits: 2 },
  { code: 'GGP', name: 'Guernsey Pound', symbol: '£', decimalDigits: 2 },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', decimalDigits: 2 },
  { code: 'GIP', name: 'Gibraltar Pound', symbol: '£', decimalDigits: 2 },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D', decimalDigits: 2 },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG', decimalDigits: 0 },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', decimalDigits: 2 },
  { code: 'GYD', name: 'Guyanaese Dollar', symbol: 'GY$', decimalDigits: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', decimalDigits: 2 },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L', decimalDigits: 2 },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn', decimalDigits: 2 },
  { code: 'HTG', name: 'Haitian Gourde', symbol: 'G', decimalDigits: 2 },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', decimalDigits: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimalDigits: 2 },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', decimalDigits: 2 },
  { code: 'IMP', name: 'Isle of Man Pound', symbol: '£', decimalDigits: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalDigits: 2 },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', decimalDigits: 3 },
  { code: 'IRR', name: 'Iranian Rial', symbol: '﷼', decimalDigits: 2 },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', decimalDigits: 0 },
  { code: 'JEP', name: 'Jersey Pound', symbol: '£', decimalDigits: 2 },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', decimalDigits: 2 },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', decimalDigits: 3 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimalDigits: 0 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimalDigits: 2 },
  { code: 'KGS', name: 'Kyrgystani Som', symbol: 'сом', decimalDigits: 2 },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛', decimalDigits: 2 },
  { code: 'KID', name: 'Kiribati Dollar', symbol: '$', decimalDigits: 2 },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF', decimalDigits: 0 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimalDigits: 0 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', decimalDigits: 3 },
  { code: 'KYD', name: 'Cayman Islands Dollar', symbol: 'CI$', decimalDigits: 2 },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', decimalDigits: 2 },
  { code: 'LAK', name: 'Laotian Kip', symbol: '₭', decimalDigits: 2 },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل', decimalDigits: 2 },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', decimalDigits: 2 },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$', decimalDigits: 2 },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'M', decimalDigits: 2 },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'ل.د', decimalDigits: 3 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', decimalDigits: 2 },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'L', decimalDigits: 2 },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar', decimalDigits: 2 },
  { code: 'MKD', name: 'Macedonian Denar', symbol: 'ден', decimalDigits: 2 },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K', decimalDigits: 2 },
  { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮', decimalDigits: 2 },
  { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP$', decimalDigits: 2 },
  { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM', decimalDigits: 2 },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨', decimalDigits: 2 },
  { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf', decimalDigits: 2 },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', decimalDigits: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$', decimalDigits: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimalDigits: 2 },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', decimalDigits: 2 },
  { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$', decimalDigits: 2 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimalDigits: 2 },
  { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$', decimalDigits: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimalDigits: 2 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रू', decimalDigits: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimalDigits: 2 },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', decimalDigits: 3 },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.', decimalDigits: 2 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/.', decimalDigits: 2 },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', decimalDigits: 2 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', decimalDigits: 2 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', decimalDigits: 2 },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', decimalDigits: 2 },
  { code: 'PYG', name: 'Paraguayan Guaraní', symbol: '₲', decimalDigits: 0 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', decimalDigits: 2 },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', decimalDigits: 2 },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин.', decimalDigits: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimalDigits: 2 },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimalDigits: 0 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', decimalDigits: 2 },
  { code: 'SBD', name: 'Solomon Islands Dollar', symbol: 'SI$', decimalDigits: 2 },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SR', decimalDigits: 2 },
  { code: 'SDG', name: 'Sudanese Pound', symbol: 'ج.س.', decimalDigits: 2 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimalDigits: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimalDigits: 2 },
  { code: 'SHP', name: 'Saint Helena Pound', symbol: '£', decimalDigits: 2 },
  { code: 'SLE', name: 'Sierra Leonean Leone', symbol: 'Le', decimalDigits: 2 },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh.So.', decimalDigits: 2 },
  { code: 'SRD', name: 'Surinamese Dollar', symbol: '$', decimalDigits: 2 },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: '£', decimalDigits: 2 },
  { code: 'STN', name: 'São Tomé and Príncipe Dobra', symbol: 'Db', decimalDigits: 2 },
  { code: 'SYP', name: 'Syrian Pound', symbol: '£S', decimalDigits: 2 },
  { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L', decimalDigits: 2 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimalDigits: 2 },
  { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'SM', decimalDigits: 2 },
  { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'T', decimalDigits: 2 },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت', decimalDigits: 3 },
  { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$', decimalDigits: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimalDigits: 2 },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$', decimalDigits: 2 },
  { code: 'TVD', name: 'Tuvaluan Dollar', symbol: '$', decimalDigits: 2 },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', decimalDigits: 2 },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', decimalDigits: 2 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', decimalDigits: 2 },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimalDigits: 0 },
  { code: 'USD', name: 'United States Dollar', symbol: '$', decimalDigits: 2 },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', decimalDigits: 2 },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: 'soʻm', decimalDigits: 2 },
  { code: 'VES', name: 'Venezuelan Bolívar Soberano', symbol: 'Bs.S', decimalDigits: 2 },
  { code: 'VND', name: 'Vietnamese Đồng', symbol: '₫', decimalDigits: 0 },
  { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT', decimalDigits: 0 },
  { code: 'WST', name: 'Samoan Tālā', symbol: 'WS$', decimalDigits: 2 },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', decimalDigits: 0 },
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$', decimalDigits: 2 },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', decimalDigits: 0 },
  { code: 'XPF', name: 'CFP Franc', symbol: '₣', decimalDigits: 0 },
  { code: 'YER', name: 'Yemeni Rial', symbol: '﷼', decimalDigits: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimalDigits: 2 },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', decimalDigits: 2 },
  { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: 'Z$', decimalDigits: 2 },
];

export const ISO_CURRENCIES_MAP = new Map<string, IsoCurrency>(
  ISO_CURRENCIES.map((c) => [c.code, c])
);

/**
 * Complete ISO 3166-1 alpha-2 country dataset (~249 officially assigned entries).
 * Standard 2-letter codes, English country names, and official/primary default ISO 4217 currencies.
 */
export const ISO_COUNTRIES: IsoCountry[] = [
  { code: 'AD', name: 'Andorra', defaultCurrency: 'EUR' },
  { code: 'AE', name: 'United Arab Emirates', defaultCurrency: 'AED' },
  { code: 'AF', name: 'Afghanistan', defaultCurrency: 'AFN' },
  { code: 'AG', name: 'Antigua and Barbuda', defaultCurrency: 'XCD' },
  { code: 'AI', name: 'Anguilla', defaultCurrency: 'XCD' },
  { code: 'AL', name: 'Albania', defaultCurrency: 'ALL' },
  { code: 'AM', name: 'Armenia', defaultCurrency: 'AMD' },
  { code: 'AO', name: 'Angola', defaultCurrency: 'AOA' },
  { code: 'AQ', name: 'Antarctica', defaultCurrency: 'USD' },
  { code: 'AR', name: 'Argentina', defaultCurrency: 'ARS' },
  { code: 'AS', name: 'American Samoa', defaultCurrency: 'USD' },
  { code: 'AT', name: 'Austria', defaultCurrency: 'EUR' },
  { code: 'AU', name: 'Australia', defaultCurrency: 'AUD' },
  { code: 'AW', name: 'Aruba', defaultCurrency: 'AWG' },
  { code: 'AX', name: 'Åland Islands', defaultCurrency: 'EUR' },
  { code: 'AZ', name: 'Azerbaijan', defaultCurrency: 'AZN' },
  { code: 'BA', name: 'Bosnia and Herzegovina', defaultCurrency: 'BAM' },
  { code: 'BB', name: 'Barbados', defaultCurrency: 'BBD' },
  { code: 'BD', name: 'Bangladesh', defaultCurrency: 'BDT' },
  { code: 'BE', name: 'Belgium', defaultCurrency: 'EUR' },
  { code: 'BF', name: 'Burkina Faso', defaultCurrency: 'XOF' },
  { code: 'BG', name: 'Bulgaria', defaultCurrency: 'BGN' },
  { code: 'BH', name: 'Bahrain', defaultCurrency: 'BHD' },
  { code: 'BI', name: 'Burundi', defaultCurrency: 'BIF' },
  { code: 'BJ', name: 'Benin', defaultCurrency: 'XOF' },
  { code: 'BL', name: 'Saint Barthélemy', defaultCurrency: 'EUR' },
  { code: 'BM', name: 'Bermuda', defaultCurrency: 'BMD' },
  { code: 'BN', name: 'Brunei', defaultCurrency: 'BND' },
  { code: 'BO', name: 'Bolivia', defaultCurrency: 'BOB' },
  { code: 'BQ', name: 'Bonaire, Sint Eustatius and Saba', defaultCurrency: 'USD' },
  { code: 'BR', name: 'Brazil', defaultCurrency: 'BRL' },
  { code: 'BS', name: 'Bahamas', defaultCurrency: 'BSD' },
  { code: 'BT', name: 'Bhutan', defaultCurrency: 'BTN', secondaryCurrencies: ['INR'] },
  { code: 'BV', name: 'Bouvet Island', defaultCurrency: 'NOK' },
  { code: 'BW', name: 'Botswana', defaultCurrency: 'BWP' },
  { code: 'BY', name: 'Belarus', defaultCurrency: 'BYN' },
  { code: 'BZ', name: 'Belize', defaultCurrency: 'BZD' },
  { code: 'CA', name: 'Canada', defaultCurrency: 'CAD' },
  { code: 'CC', name: 'Cocos (Keeling) Islands', defaultCurrency: 'AUD' },
  { code: 'CD', name: 'Congo, Democratic Republic of the', defaultCurrency: 'CDF' },
  { code: 'CF', name: 'Central African Republic', defaultCurrency: 'XAF' },
  { code: 'CG', name: 'Congo', defaultCurrency: 'XAF' },
  { code: 'CH', name: 'Switzerland', defaultCurrency: 'CHF' },
  { code: 'CI', name: "Côte d'Ivoire", defaultCurrency: 'XOF' },
  { code: 'CK', name: 'Cook Islands', defaultCurrency: 'NZD' },
  { code: 'CL', name: 'Chile', defaultCurrency: 'CLP' },
  { code: 'CM', name: 'Cameroon', defaultCurrency: 'XAF' },
  { code: 'CN', name: 'China', defaultCurrency: 'CNY' },
  { code: 'CO', name: 'Colombia', defaultCurrency: 'COP' },
  { code: 'CR', name: 'Costa Rica', defaultCurrency: 'CRC' },
  { code: 'CU', name: 'Cuba', defaultCurrency: 'CUP' },
  { code: 'CV', name: 'Cabo Verde', defaultCurrency: 'CVE' },
  { code: 'CW', name: 'Curaçao', defaultCurrency: 'ANG' },
  { code: 'CX', name: 'Christmas Island', defaultCurrency: 'AUD' },
  { code: 'CY', name: 'Cyprus', defaultCurrency: 'EUR' },
  { code: 'CZ', name: 'Czech Republic', defaultCurrency: 'CZK' },
  { code: 'DE', name: 'Germany', defaultCurrency: 'EUR' },
  { code: 'DJ', name: 'Djibouti', defaultCurrency: 'DJF' },
  { code: 'DK', name: 'Denmark', defaultCurrency: 'DKK' },
  { code: 'DM', name: 'Dominica', defaultCurrency: 'XCD' },
  { code: 'DO', name: 'Dominican Republic', defaultCurrency: 'DOP' },
  { code: 'DZ', name: 'Algeria', defaultCurrency: 'DZD' },
  { code: 'EC', name: 'Ecuador', defaultCurrency: 'USD' },
  { code: 'EE', name: 'Estonia', defaultCurrency: 'EUR' },
  { code: 'EG', name: 'Egypt', defaultCurrency: 'EGP' },
  { code: 'EH', name: 'Western Sahara', defaultCurrency: 'MAD' },
  { code: 'ER', name: 'Eritrea', defaultCurrency: 'ERN' },
  { code: 'ES', name: 'Spain', defaultCurrency: 'EUR' },
  { code: 'ET', name: 'Ethiopia', defaultCurrency: 'ETB' },
  { code: 'FI', name: 'Finland', defaultCurrency: 'EUR' },
  { code: 'FJ', name: 'Fiji', defaultCurrency: 'FJD' },
  { code: 'FK', name: 'Falkland Islands', defaultCurrency: 'FKP' },
  { code: 'FM', name: 'Micronesia', defaultCurrency: 'USD' },
  { code: 'FO', name: 'Faroe Islands', defaultCurrency: 'DKK', secondaryCurrencies: ['FOK'] },
  { code: 'FR', name: 'France', defaultCurrency: 'EUR' },
  { code: 'GA', name: 'Gabon', defaultCurrency: 'XAF' },
  { code: 'GB', name: 'United Kingdom', defaultCurrency: 'GBP' },
  { code: 'GD', name: 'Grenada', defaultCurrency: 'XCD' },
  { code: 'GE', name: 'Georgia', defaultCurrency: 'GEL' },
  { code: 'GF', name: 'French Guiana', defaultCurrency: 'EUR' },
  { code: 'GG', name: 'Guernsey', defaultCurrency: 'GBP', secondaryCurrencies: ['GGP'] },
  { code: 'GH', name: 'Ghana', defaultCurrency: 'GHS' },
  { code: 'GI', name: 'Gibraltar', defaultCurrency: 'GIP', secondaryCurrencies: ['GBP'] },
  { code: 'GL', name: 'Greenland', defaultCurrency: 'DKK' },
  { code: 'GM', name: 'Gambia', defaultCurrency: 'GMD' },
  { code: 'GN', name: 'Guinea', defaultCurrency: 'GNF' },
  { code: 'GP', name: 'Guadeloupe', defaultCurrency: 'EUR' },
  { code: 'GQ', name: 'Equatorial Guinea', defaultCurrency: 'XAF' },
  { code: 'GR', name: 'Greece', defaultCurrency: 'EUR' },
  { code: 'GS', name: 'South Georgia and the South Sandwich Islands', defaultCurrency: 'GBP' },
  { code: 'GT', name: 'Guatemala', defaultCurrency: 'GTQ' },
  { code: 'GU', name: 'Guam', defaultCurrency: 'USD' },
  { code: 'GW', name: 'Guinea-Bissau', defaultCurrency: 'XOF' },
  { code: 'GY', name: 'Guyana', defaultCurrency: 'GYD' },
  { code: 'HK', name: 'Hong Kong', defaultCurrency: 'HKD' },
  { code: 'HM', name: 'Heard Island and McDonald Islands', defaultCurrency: 'AUD' },
  { code: 'HN', name: 'Honduras', defaultCurrency: 'HNL' },
  { code: 'HR', name: 'Croatia', defaultCurrency: 'EUR' },
  { code: 'HT', name: 'Haiti', defaultCurrency: 'HTG', secondaryCurrencies: ['USD'] },
  { code: 'HU', name: 'Hungary', defaultCurrency: 'HUF' },
  { code: 'ID', name: 'Indonesia', defaultCurrency: 'IDR' },
  { code: 'IE', name: 'Ireland', defaultCurrency: 'EUR' },
  { code: 'IL', name: 'Israel', defaultCurrency: 'ILS' },
  { code: 'IM', name: 'Isle of Man', defaultCurrency: 'GBP', secondaryCurrencies: ['IMP'] },
  { code: 'IN', name: 'India', defaultCurrency: 'INR' },
  { code: 'IO', name: 'British Indian Ocean Territory', defaultCurrency: 'USD' },
  { code: 'IQ', name: 'Iraq', defaultCurrency: 'IQD' },
  { code: 'IR', name: 'Iran', defaultCurrency: 'IRR' },
  { code: 'IS', name: 'Iceland', defaultCurrency: 'ISK' },
  { code: 'IT', name: 'Italy', defaultCurrency: 'EUR' },
  { code: 'JE', name: 'Jersey', defaultCurrency: 'GBP', secondaryCurrencies: ['JEP'] },
  { code: 'JM', name: 'Jamaica', defaultCurrency: 'JMD' },
  { code: 'JO', name: 'Jordan', defaultCurrency: 'JOD' },
  { code: 'JP', name: 'Japan', defaultCurrency: 'JPY' },
  { code: 'KE', name: 'Kenya', defaultCurrency: 'KES' },
  { code: 'KG', name: 'Kyrgyzstan', defaultCurrency: 'KGS' },
  { code: 'KH', name: 'Cambodia', defaultCurrency: 'KHR', secondaryCurrencies: ['USD'] },
  { code: 'KI', name: 'Kiribati', defaultCurrency: 'AUD', secondaryCurrencies: ['KID'] },
  { code: 'KM', name: 'Comoros', defaultCurrency: 'KMF' },
  { code: 'KN', name: 'Saint Kitts and Nevis', defaultCurrency: 'XCD' },
  { code: 'KP', name: 'North Korea', defaultCurrency: 'KPW' },
  { code: 'KR', name: 'South Korea', defaultCurrency: 'KRW' },
  { code: 'KW', name: 'Kuwait', defaultCurrency: 'KWD' },
  { code: 'KY', name: 'Cayman Islands', defaultCurrency: 'KYD' },
  { code: 'KZ', name: 'Kazakhstan', defaultCurrency: 'KZT' },
  { code: 'LA', name: 'Laos', defaultCurrency: 'LAK' },
  { code: 'LB', name: 'Lebanon', defaultCurrency: 'LBP', secondaryCurrencies: ['USD'] },
  { code: 'LC', name: 'Saint Lucia', defaultCurrency: 'XCD' },
  { code: 'LI', name: 'Liechtenstein', defaultCurrency: 'CHF' },
  { code: 'LK', name: 'Sri Lanka', defaultCurrency: 'LKR' },
  { code: 'LR', name: 'Liberia', defaultCurrency: 'LRD', secondaryCurrencies: ['USD'] },
  { code: 'LS', name: 'Lesotho', defaultCurrency: 'LSL', secondaryCurrencies: ['ZAR'] },
  { code: 'LT', name: 'Lithuania', defaultCurrency: 'EUR' },
  { code: 'LU', name: 'Luxembourg', defaultCurrency: 'EUR' },
  { code: 'LV', name: 'Latvia', defaultCurrency: 'EUR' },
  { code: 'LY', name: 'Libya', defaultCurrency: 'LYD' },
  { code: 'MA', name: 'Morocco', defaultCurrency: 'MAD' },
  { code: 'MC', name: 'Monaco', defaultCurrency: 'EUR' },
  { code: 'MD', name: 'Moldova', defaultCurrency: 'MDL' },
  { code: 'ME', name: 'Montenegro', defaultCurrency: 'EUR' },
  { code: 'MF', name: 'Saint Martin (French part)', defaultCurrency: 'EUR' },
  { code: 'MG', name: 'Madagascar', defaultCurrency: 'MGA' },
  { code: 'MH', name: 'Marshall Islands', defaultCurrency: 'USD' },
  { code: 'MK', name: 'North Macedonia', defaultCurrency: 'MKD' },
  { code: 'ML', name: 'Mali', defaultCurrency: 'XOF' },
  { code: 'MM', name: 'Myanmar', defaultCurrency: 'MMK' },
  { code: 'MN', name: 'Mongolia', defaultCurrency: 'MNT' },
  { code: 'MO', name: 'Macao', defaultCurrency: 'MOP', secondaryCurrencies: ['HKD'] },
  { code: 'MP', name: 'Northern Mariana Islands', defaultCurrency: 'USD' },
  { code: 'MQ', name: 'Martinique', defaultCurrency: 'EUR' },
  { code: 'MR', name: 'Mauritania', defaultCurrency: 'MRU' },
  { code: 'MS', name: 'Montserrat', defaultCurrency: 'XCD' },
  { code: 'MT', name: 'Malta', defaultCurrency: 'EUR' },
  { code: 'MU', name: 'Mauritius', defaultCurrency: 'MUR' },
  { code: 'MV', name: 'Maldives', defaultCurrency: 'MVR' },
  { code: 'MW', name: 'Malawi', defaultCurrency: 'MWK' },
  { code: 'MX', name: 'Mexico', defaultCurrency: 'MXN' },
  { code: 'MY', name: 'Malaysia', defaultCurrency: 'MYR' },
  { code: 'MZ', name: 'Mozambique', defaultCurrency: 'MZN' },
  { code: 'NA', name: 'Namibia', defaultCurrency: 'NAD', secondaryCurrencies: ['ZAR'] },
  { code: 'NC', name: 'New Caledonia', defaultCurrency: 'XPF' },
  { code: 'NE', name: 'Niger', defaultCurrency: 'XOF' },
  { code: 'NF', name: 'Norfolk Island', defaultCurrency: 'AUD' },
  { code: 'NG', name: 'Nigeria', defaultCurrency: 'NGN' },
  { code: 'NI', name: 'Nicaragua', defaultCurrency: 'NIO', secondaryCurrencies: ['USD'] },
  { code: 'NL', name: 'Netherlands', defaultCurrency: 'EUR' },
  { code: 'NO', name: 'Norway', defaultCurrency: 'NOK' },
  { code: 'NP', name: 'Nepal', defaultCurrency: 'NPR', secondaryCurrencies: ['INR'] },
  { code: 'NR', name: 'Nauru', defaultCurrency: 'AUD' },
  { code: 'NU', name: 'Niue', defaultCurrency: 'NZD' },
  { code: 'NZ', name: 'New Zealand', defaultCurrency: 'NZD' },
  { code: 'OM', name: 'Oman', defaultCurrency: 'OMR' },
  { code: 'PA', name: 'Panama', defaultCurrency: 'USD', secondaryCurrencies: ['PAB'] },
  { code: 'PE', name: 'Peru', defaultCurrency: 'PEN' },
  { code: 'PF', name: 'French Polynesia', defaultCurrency: 'XPF' },
  { code: 'PG', name: 'Papua New Guinea', defaultCurrency: 'PGK' },
  { code: 'PH', name: 'Philippines', defaultCurrency: 'PHP' },
  { code: 'PK', name: 'Pakistan', defaultCurrency: 'PKR' },
  { code: 'PL', name: 'Poland', defaultCurrency: 'PLN' },
  { code: 'PM', name: 'Saint Pierre and Miquelon', defaultCurrency: 'EUR' },
  { code: 'PN', name: 'Pitcairn', defaultCurrency: 'NZD' },
  { code: 'PR', name: 'Puerto Rico', defaultCurrency: 'USD' },
  { code: 'PS', name: 'Palestine, State of', defaultCurrency: 'ILS', secondaryCurrencies: ['JOD'] },
  { code: 'PT', name: 'Portugal', defaultCurrency: 'EUR' },
  { code: 'PW', name: 'Palau', defaultCurrency: 'USD' },
  { code: 'PY', name: 'Paraguay', defaultCurrency: 'PYG' },
  { code: 'QA', name: 'Qatar', defaultCurrency: 'QAR' },
  { code: 'RE', name: 'Réunion', defaultCurrency: 'EUR' },
  { code: 'RO', name: 'Romania', defaultCurrency: 'RON' },
  { code: 'RS', name: 'Serbia', defaultCurrency: 'RSD' },
  { code: 'RU', name: 'Russia', defaultCurrency: 'RUB' },
  { code: 'RW', name: 'Rwanda', defaultCurrency: 'RWF' },
  { code: 'SA', name: 'Saudi Arabia', defaultCurrency: 'SAR' },
  { code: 'SB', name: 'Solomon Islands', defaultCurrency: 'SBD' },
  { code: 'SC', name: 'Seychelles', defaultCurrency: 'SCR' },
  { code: 'SD', name: 'Sudan', defaultCurrency: 'SDG' },
  { code: 'SE', name: 'Sweden', defaultCurrency: 'SEK' },
  { code: 'SG', name: 'Singapore', defaultCurrency: 'SGD' },
  { code: 'SH', name: 'Saint Helena, Ascension and Tristan da Cunha', defaultCurrency: 'SHP', secondaryCurrencies: ['GBP'] },
  { code: 'SI', name: 'Slovenia', defaultCurrency: 'EUR' },
  { code: 'SJ', name: 'Svalbard and Jan Mayen', defaultCurrency: 'NOK' },
  { code: 'SK', name: 'Slovakia', defaultCurrency: 'EUR' },
  { code: 'SL', name: 'Sierra Leone', defaultCurrency: 'SLE' },
  { code: 'SM', name: 'San Marino', defaultCurrency: 'EUR' },
  { code: 'SN', name: 'Senegal', defaultCurrency: 'XOF' },
  { code: 'SO', name: 'Somalia', defaultCurrency: 'SOS', secondaryCurrencies: ['USD'] },
  { code: 'SR', name: 'Suriname', defaultCurrency: 'SRD' },
  { code: 'SS', name: 'South Sudan', defaultCurrency: 'SSP' },
  { code: 'ST', name: 'São Tomé and Príncipe', defaultCurrency: 'STN' },
  { code: 'SV', name: 'El Salvador', defaultCurrency: 'USD' },
  { code: 'SX', name: 'Sint Maarten (Dutch part)', defaultCurrency: 'ANG', secondaryCurrencies: ['USD'] },
  { code: 'SY', name: 'Syria', defaultCurrency: 'SYP' },
  { code: 'SZ', name: 'Eswatini', defaultCurrency: 'SZL', secondaryCurrencies: ['ZAR'] },
  { code: 'TC', name: 'Turks and Caicos Islands', defaultCurrency: 'USD' },
  { code: 'TD', name: 'Chad', defaultCurrency: 'XAF' },
  { code: 'TF', name: 'French Southern Territories', defaultCurrency: 'EUR' },
  { code: 'TG', name: 'Togo', defaultCurrency: 'XOF' },
  { code: 'TH', name: 'Thailand', defaultCurrency: 'THB' },
  { code: 'TJ', name: 'Tajikistan', defaultCurrency: 'TJS' },
  { code: 'TK', name: 'Tokelau', defaultCurrency: 'NZD' },
  { code: 'TL', name: 'Timor-Leste', defaultCurrency: 'USD' },
  { code: 'TM', name: 'Turkmenistan', defaultCurrency: 'TMT' },
  { code: 'TN', name: 'Tunisia', defaultCurrency: 'TND' },
  { code: 'TO', name: 'Tonga', defaultCurrency: 'TOP' },
  { code: 'TR', name: 'Turkey', defaultCurrency: 'TRY' },
  { code: 'TT', name: 'Trinidad and Tobago', defaultCurrency: 'TTD' },
  { code: 'TV', name: 'Tuvalu', defaultCurrency: 'AUD', secondaryCurrencies: ['TVD'] },
  { code: 'TW', name: 'Taiwan', defaultCurrency: 'TWD' },
  { code: 'TZ', name: 'Tanzania', defaultCurrency: 'TZS' },
  { code: 'UA', name: 'Ukraine', defaultCurrency: 'UAH' },
  { code: 'UG', name: 'Uganda', defaultCurrency: 'UGX' },
  { code: 'UM', name: 'United States Minor Outlying Islands', defaultCurrency: 'USD' },
  { code: 'US', name: 'United States', defaultCurrency: 'USD' },
  { code: 'UY', name: 'Uruguay', defaultCurrency: 'UYU' },
  { code: 'UZ', name: 'Uzbekistan', defaultCurrency: 'UZS' },
  { code: 'VA', name: 'Holy See (Vatican City State)', defaultCurrency: 'EUR' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', defaultCurrency: 'XCD' },
  { code: 'VE', name: 'Venezuela', defaultCurrency: 'VES' },
  { code: 'VG', name: 'Virgin Islands, British', defaultCurrency: 'USD' },
  { code: 'VI', name: 'Virgin Islands, U.S.', defaultCurrency: 'USD' },
  { code: 'VN', name: 'Vietnam', defaultCurrency: 'VND' },
  { code: 'VU', name: 'Vanuatu', defaultCurrency: 'VUV' },
  { code: 'WF', name: 'Wallis and Futuna', defaultCurrency: 'XPF' },
  { code: 'WS', name: 'Samoa', defaultCurrency: 'WST' },
  { code: 'YE', name: 'Yemen', defaultCurrency: 'YER' },
  { code: 'YT', name: 'Mayotte', defaultCurrency: 'EUR' },
  { code: 'ZA', name: 'South Africa', defaultCurrency: 'ZAR' },
  { code: 'ZM', name: 'Zambia', defaultCurrency: 'ZMW' },
  { code: 'ZW', name: 'Zimbabwe', defaultCurrency: 'ZWL', secondaryCurrencies: ['USD'] },
];

export const ISO_COUNTRIES_MAP = new Map<string, IsoCountry>(
  ISO_COUNTRIES.map((c) => [c.code, c])
);

/**
 * Validates whether a 3-letter currency code is a recognized circulating ISO 4217 fiat currency.
 */
export function isValidCurrencyCode(code: string | undefined | null): boolean {
  if (!code || typeof code !== 'string') return false;
  const upper = code.trim().toUpperCase();
  return ISO_CURRENCIES_MAP.has(upper);
}

/**
 * Look up currency details by ISO code.
 */
export function getCurrencyDetails(code: string | undefined | null): IsoCurrency | undefined {
  if (!code || typeof code !== 'string') return undefined;
  return ISO_CURRENCIES_MAP.get(code.trim().toUpperCase());
}

/**
 * Look up country details by ISO 3166-1 alpha-2 code.
 */
export function getCountryDetails(code: string | undefined | null): IsoCountry | undefined {
  if (!code || typeof code !== 'string') return undefined;
  return ISO_COUNTRIES_MAP.get(code.trim().toUpperCase());
}

/**
 * Softly detect initial country and currency suggestion from browser locale / timezone without GPS.
 */
export function detectInitialCountryAndCurrency(): { countryCode: string; currencyCode: string } {
  const fallback = { countryCode: 'US', currencyCode: 'USD' };

  if (typeof navigator === 'undefined') {
    return fallback;
  }

  try {
    // 1. Try detecting country code from navigator.languages or navigator.language
    const languages = navigator.languages || [navigator.language];
    for (const lang of languages) {
      if (!lang) continue;
      // Format: "en-US", "fr-FR", "pt-BR", "es-AR", "en-GB"
      const parts = lang.split('-');
      if (parts.length >= 2) {
        const potentialCountry = parts[parts.length - 1].toUpperCase();
        if (potentialCountry.length === 2 && ISO_COUNTRIES_MAP.has(potentialCountry)) {
          const country = ISO_COUNTRIES_MAP.get(potentialCountry)!;
          return {
            countryCode: country.code,
            currencyCode: country.defaultCurrency || 'USD',
          };
        }
      }
    }

    // 2. Try timezone mapping if locale was generic (e.g. "en")
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (timeZone.startsWith('Asia/Kolkata') || timeZone.startsWith('Asia/Calcutta')) {
      return { countryCode: 'IN', currencyCode: 'INR' };
    }
    if (timeZone.startsWith('Europe/London')) {
      return { countryCode: 'GB', currencyCode: 'GBP' };
    }
    if (timeZone.startsWith('Asia/Tokyo')) {
      return { countryCode: 'JP', currencyCode: 'JPY' };
    }
    if (timeZone.startsWith('Australia/')) {
      return { countryCode: 'AU', currencyCode: 'AUD' };
    }
    if (timeZone.startsWith('America/Toronto') || timeZone.startsWith('America/Vancouver')) {
      return { countryCode: 'CA', currencyCode: 'CAD' };
    }
    if (timeZone.startsWith('Europe/Paris') || timeZone.startsWith('Europe/Berlin') || timeZone.startsWith('Europe/Madrid') || timeZone.startsWith('Europe/Rome')) {
      return { countryCode: 'FR', currencyCode: 'EUR' };
    }
  } catch {
    // Graceful fallback
  }

  return fallback;
}

/**
 * Converts standard ISO 3166-1 alpha-2 code to Unicode regional indicator flag emoji.
 * e.g. "US" -> 🇺🇸, "IN" -> 🇮🇳, "GB" -> 🇬🇧, "FR" -> 🇫🇷, "JP" -> 🇯🇵
 */
export function getCountryFlagEmoji(countryCode: string | undefined | null): string {
  if (!countryCode || countryCode.trim().length !== 2) return '🌐';
  const clean = countryCode.trim().toUpperCase();
  const codePoints = clean.split('').map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Canonical mapping of prominent currency codes to primary country/region definitions.
 */
export const PROMINENT_CURRENCY_COUNTRIES: Record<
  string,
  { countryCode: string; countryName: string; flagEmoji?: string }
> = {
  USD: { countryCode: 'US', countryName: 'United States & territories' },
  EUR: { countryCode: 'EU', countryName: 'Eurozone (20+ European nations)' },
  GBP: { countryCode: 'GB', countryName: 'United Kingdom' },
  INR: { countryCode: 'IN', countryName: 'India' },
  CAD: { countryCode: 'CA', countryName: 'Canada' },
  AUD: { countryCode: 'AU', countryName: 'Australia & territories' },
  JPY: { countryCode: 'JP', countryName: 'Japan' },
  CHF: { countryCode: 'CH', countryName: 'Switzerland & Liechtenstein' },
  CNY: { countryCode: 'CN', countryName: 'China' },
  SGD: { countryCode: 'SG', countryName: 'Singapore' },
  AED: { countryCode: 'AE', countryName: 'United Arab Emirates' },
  BRL: { countryCode: 'BR', countryName: 'Brazil' },
  ZAR: { countryCode: 'ZA', countryName: 'South Africa & CMA' },
  NZD: { countryCode: 'NZ', countryName: 'New Zealand & territories' },
  MXN: { countryCode: 'MX', countryName: 'Mexico' },
  HKD: { countryCode: 'HK', countryName: 'Hong Kong' },
  SEK: { countryCode: 'SE', countryName: 'Sweden' },
  NOK: { countryCode: 'NO', countryName: 'Norway' },
  DKK: { countryCode: 'DK', countryName: 'Denmark, Greenland & Faroe' },
  KRW: { countryCode: 'KR', countryName: 'South Korea' },
  PLN: { countryCode: 'PL', countryName: 'Poland' },
  TRY: { countryCode: 'TR', countryName: 'Turkey' },
  RUB: { countryCode: 'RU', countryName: 'Russia' },
  THB: { countryCode: 'TH', countryName: 'Thailand' },
  IDR: { countryCode: 'ID', countryName: 'Indonesia' },
  MYR: { countryCode: 'MY', countryName: 'Malaysia' },
  PHP: { countryCode: 'PH', countryName: 'Philippines' },
  ILS: { countryCode: 'IL', countryName: 'Israel & territories' },
  CLP: { countryCode: 'CL', countryName: 'Chile' },
  COP: { countryCode: 'CO', countryName: 'Colombia' },
  EGP: { countryCode: 'EG', countryName: 'Egypt' },
  SAR: { countryCode: 'SA', countryName: 'Saudi Arabia' },
  KWD: { countryCode: 'KW', countryName: 'Kuwait' },
  QAR: { countryCode: 'QA', countryName: 'Qatar' },
  VND: { countryCode: 'VN', countryName: 'Vietnam' },
  NGN: { countryCode: 'NG', countryName: 'Nigeria' },
  PKR: { countryCode: 'PK', countryName: 'Pakistan' },
  BDT: { countryCode: 'BD', countryName: 'Bangladesh' },
  ARS: { countryCode: 'AR', countryName: 'Argentina' },
  XCD: { countryCode: 'AG', countryName: 'East Caribbean States (OECS)', flagEmoji: '🌐' },
  XAF: { countryCode: 'CF', countryName: 'Central African States (CEMAC)', flagEmoji: '🌐' },
  XOF: { countryCode: 'SN', countryName: 'West African States (UEMOA)', flagEmoji: '🌐' },
  XPF: { countryCode: 'PF', countryName: 'French Pacific Territories (CFP)', flagEmoji: '🇵🇫' },
};

export interface RichCurrencyItem {
  code: string;
  name: string;
  symbol: string;
  decimalDigits: number;
  countryCode: string;
  countryName: string;
  flagEmoji: string;
}

/**
 * Returns complete rich currency info including flag emoji, country/region name, currency name, code, and symbol.
 */
export function getCurrencyCountryAndFlag(currencyCode: string | undefined | null): {
  countryCode: string;
  countryName: string;
  flagEmoji: string;
} {
  if (!currencyCode) {
    return { countryCode: 'US', countryName: 'United States & territories', flagEmoji: '🇺🇸' };
  }
  const clean = currencyCode.trim().toUpperCase();

  // 1. Direct prominent match
  if (PROMINENT_CURRENCY_COUNTRIES[clean]) {
    const p = PROMINENT_CURRENCY_COUNTRIES[clean];
    return {
      countryCode: p.countryCode,
      countryName: p.countryName,
      flagEmoji: p.flagEmoji || getCountryFlagEmoji(p.countryCode),
    };
  }

  // 2. Lookup by default currency in ISO_COUNTRIES
  const country = ISO_COUNTRIES.find((c) => c.defaultCurrency === clean);
  if (country) {
    return {
      countryCode: country.code,
      countryName: country.name,
      flagEmoji: getCountryFlagEmoji(country.code),
    };
  }

  return {
    countryCode: 'UN',
    countryName: 'International',
    flagEmoji: '🌐',
  };
}

/**
 * Returns full list of circulating currencies with associated country flag, region name, symbol, and ISO code.
 */
export function getRichCurrenciesList(): RichCurrencyItem[] {
  return ISO_CURRENCIES.map((curr) => {
    const geo = getCurrencyCountryAndFlag(curr.code);
    return {
      ...curr,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      flagEmoji: geo.flagEmoji,
    };
  });
}

