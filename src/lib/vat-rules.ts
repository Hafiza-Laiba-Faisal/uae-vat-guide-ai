/**
 * Layer 7: UAE VAT Rule Engine
 * Deterministic rules — no LLM involved.
 * These are hard facts from UAE VAT Law that never need AI interpretation.
 */

// ── Registration Thresholds ───────────────────────────────────────────────────

export const VAT_RULES = {
  standard_rate: 0.05,
  zero_rate: 0,
  introduced: "2018-01-01",
  authority: "Federal Tax Authority (FTA)",
  governing_law: "Federal Decree-Law No. 8 of 2017",

  registration: {
    mandatory_threshold_aed: 375_000,
    voluntary_threshold_aed: 187_500,
    non_resident_threshold_aed: 0, // must register regardless of turnover
    deadline_days: 30, // days after exceeding threshold
  },

  filing: {
    standard_period: "quarterly",
    large_business_period: "monthly",
    large_business_threshold_aed: 150_000_000,
    deadline_days_after_period: 28,
  },

  penalties: {
    late_registration_min_aed: 10_000,
    late_registration_max_aed: 20_000,
    late_filing_aed: 1_000, // first time
    late_filing_repeat_aed: 2_000,
    late_payment_percent_month1: 0.02,
    late_payment_percent_month6: 0.04,
  },

  zero_rated_categories: [
    "exports of goods outside UAE",
    "international transport",
    "certain healthcare services",
    "certain educational services",
    "first supply of residential buildings",
    "bare land",
    "crude oil and natural gas",
    "precious metals (investment grade)",
  ],

  exempt_categories: [
    "financial services (implicit margin)",
    "residential property (subsequent supply)",
    "bare land",
    "local passenger transport",
  ],

  designated_zones: {
    treated_as: "outside UAE for goods (conditions apply)",
    key_condition: "goods must not enter free circulation in UAE mainland",
    dz_to_dz_vat: "no VAT if conditions met (Article 51)",
    dz_to_mainland: "standard VAT applies",
    mainland_to_dz: "treated as local supply, VAT applies",
  },

  rcm_applies_to: [
    "import of services from non-resident supplier",
    "purchase of crude oil/gas from non-resident",
    "scrap metal (Cabinet Decision 153 of 2025)",
    "precious metals (Cabinet Decision 127 of 2024, effective 26 Feb 2025)",
  ],

  amendments_2026: [
    "RCM self-invoice requirement removed (effective 1 Jan 2026)",
    "FTA can deny input VAT if linked to tax evasion (effective 1 Jan 2026)",
    "VAT credits older than 5 years expire — deadline 31 Dec 2026",
    "Audit time limits now governed by Tax Procedures Law",
  ],
} as const;

// ── VAT Calculator ────────────────────────────────────────────────────────────

export interface VatCalculation {
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  rate: number;
  rate_type: "standard" | "zero" | "exempt";
}

export function calculateVat(
  amount: number,
  supplyType: "standard" | "zero" | "exempt" = "standard",
): VatCalculation {
  const rate = supplyType === "standard" ? VAT_RULES.standard_rate : 0;
  const vat = amount * rate;
  return {
    net_amount: Math.round(amount * 100) / 100,
    vat_amount: Math.round(vat * 100) / 100,
    gross_amount: Math.round((amount + vat) * 100) / 100,
    rate,
    rate_type: supplyType,
  };
}

export function vatFromGross(
  grossAmount: number,
  supplyType: "standard" | "zero" | "exempt" = "standard",
): VatCalculation {
  const rate = supplyType === "standard" ? VAT_RULES.standard_rate : 0;
  const net = grossAmount / (1 + rate);
  const vat = grossAmount - net;
  return {
    net_amount: Math.round(net * 100) / 100,
    vat_amount: Math.round(vat * 100) / 100,
    gross_amount: Math.round(grossAmount * 100) / 100,
    rate,
    rate_type: supplyType,
  };
}

// ── Registration checker ──────────────────────────────────────────────────────

export interface RegistrationCheck {
  must_register: boolean;
  can_voluntarily_register: boolean;
  reason: string;
  threshold_aed: number;
}

export function checkRegistrationObligation(
  annualTurnoverAed: number,
  isNonResident = false,
): RegistrationCheck {
  if (isNonResident && annualTurnoverAed > 0) {
    return {
      must_register: true,
      can_voluntarily_register: true,
      reason: "Non-resident making taxable supplies in UAE must register regardless of turnover",
      threshold_aed: 0,
    };
  }
  if (annualTurnoverAed >= VAT_RULES.registration.mandatory_threshold_aed) {
    return {
      must_register: true,
      can_voluntarily_register: true,
      reason: `Annual taxable turnover AED ${annualTurnoverAed.toLocaleString()} exceeds mandatory threshold of AED ${VAT_RULES.registration.mandatory_threshold_aed.toLocaleString()}`,
      threshold_aed: VAT_RULES.registration.mandatory_threshold_aed,
    };
  }
  if (annualTurnoverAed >= VAT_RULES.registration.voluntary_threshold_aed) {
    return {
      must_register: false,
      can_voluntarily_register: true,
      reason: `Annual taxable turnover AED ${annualTurnoverAed.toLocaleString()} is above voluntary threshold (AED ${VAT_RULES.registration.voluntary_threshold_aed.toLocaleString()}) but below mandatory threshold (AED ${VAT_RULES.registration.mandatory_threshold_aed.toLocaleString()})`,
      threshold_aed: VAT_RULES.registration.voluntary_threshold_aed,
    };
  }
  return {
    must_register: false,
    can_voluntarily_register: false,
    reason: `Annual taxable turnover AED ${annualTurnoverAed.toLocaleString()} is below voluntary threshold of AED ${VAT_RULES.registration.voluntary_threshold_aed.toLocaleString()}`,
    threshold_aed: VAT_RULES.registration.voluntary_threshold_aed,
  };
}

// ── Intent detection helpers ──────────────────────────────────────────────────

export type VatIntent =
  | "registration_check"
  | "vat_calculation"
  | "zero_rating"
  | "exemption"
  | "designated_zone"
  | "rcm"
  | "real_estate"
  | "healthcare"
  | "financial_services"
  | "export"
  | "input_tax_recovery"
  | "filing_deadline"
  | "penalty"
  | "general_vat"
  | "out_of_scope";

export interface IntentResult {
  intent: VatIntent;
  confidence: "high" | "medium" | "low";
  is_deterministic: boolean; // true = can answer from rule engine alone
  rule_engine_answer?: string;
  suggested_doc_types?: string[];
}

const INTENT_PATTERNS: Array<{
  intent: VatIntent;
  patterns: RegExp[];
  deterministic?: boolean;
  doc_types?: string[];
}> = [
  {
    intent: "registration_check",
    patterns: [/registr/i, /threshold/i, /375,?000/i, /187,?500/i, /must.*register/i, /do i need to register/i],
    deterministic: true,
    doc_types: ["vat_law", "fta_guide"],
  },
  {
    intent: "vat_calculation",
    patterns: [/how much.*vat/i, /calculate.*vat/i, /vat.*amount/i, /\d+.*aed.*vat/i, /5%/i],
    deterministic: true,
    doc_types: ["vat_law"],
  },
  {
    intent: "designated_zone",
    patterns: [/designated zone/i, /free zone/i, /jafza/i, /jebel ali/i, /dz/i, /article 51/i, /article 50/i],
    deterministic: false,
    doc_types: ["vat_law", "cabinet_decision", "fta_guide"],
  },
  {
    intent: "rcm",
    patterns: [/reverse charge/i, /rcm/i, /import.*service/i, /imported service/i, /scrap metal/i, /precious metal/i, /gold.*vat/i],
    deterministic: false,
    doc_types: ["vat_law", "cabinet_decision", "public_clarification"],
  },
  {
    intent: "real_estate",
    patterns: [/real estate/i, /property/i, /residential/i, /commercial.*property/i, /lease.*property/i, /rent.*property/i, /building/i, /land/i],
    deterministic: false,
    doc_types: ["vat_law", "fta_guide", "executive_regulation"],
  },
  {
    intent: "healthcare",
    patterns: [/health/i, /medical/i, /hospital/i, /medicine/i, /pharmaceutical/i, /doctor/i, /clinic/i],
    deterministic: false,
    doc_types: ["vat_law", "fta_guide"],
  },
  {
    intent: "financial_services",
    patterns: [/bank/i, /insurance/i, /financial service/i, /interest/i, /loan/i, /margin/i, /investment fund/i],
    deterministic: false,
    doc_types: ["vat_law", "fta_guide"],
  },
  {
    intent: "export",
    patterns: [/export/i, /outside.*uae/i, /international.*supply/i, /zero.*rated.*export/i, /gcc/i],
    deterministic: false,
    doc_types: ["vat_law", "executive_regulation"],
  },
  {
    intent: "zero_rating",
    patterns: [/zero.?rated/i, /0%.*vat/i, /zero.*vat/i],
    deterministic: false,
    doc_types: ["vat_law", "executive_regulation"],
  },
  {
    intent: "exemption",
    patterns: [/exempt/i, /exemption/i, /no vat/i, /vat.*free/i],
    deterministic: false,
    doc_types: ["vat_law", "executive_regulation"],
  },
  {
    intent: "input_tax_recovery",
    patterns: [/input tax/i, /input vat/i, /recover.*vat/i, /claim.*vat/i, /apportionment/i],
    deterministic: false,
    doc_types: ["vat_law", "executive_regulation", "fta_guide"],
  },
  {
    intent: "filing_deadline",
    patterns: [/filing/i, /deadline/i, /return/i, /quarterly/i, /monthly.*return/i, /28 days/i],
    deterministic: true,
    doc_types: ["vat_law"],
  },
  {
    intent: "penalty",
    patterns: [/penalty/i, /penalt/i, /fine/i, /late.*payment/i, /late.*registration/i],
    deterministic: true,
    doc_types: ["tax_procedures", "vat_law"],
  },
];

export function detectIntent(query: string): IntentResult {
  for (const rule of INTENT_PATTERNS) {
    const matched = rule.patterns.some((p) => p.test(query));
    if (!matched) continue;

    // Check if rule engine can answer directly
    let ruleAnswer: string | undefined;
    if (rule.deterministic) {
      ruleAnswer = buildDeterministicAnswer(rule.intent, query);
    }

    return {
      intent: rule.intent,
      confidence: "high",
      is_deterministic: !!ruleAnswer,
      rule_engine_answer: ruleAnswer,
      suggested_doc_types: rule.doc_types,
    };
  }

  // Check if out of scope
  const outOfScope = [
    /saudi arabia|ksa|zatca/i,
    /corporate tax/i,
    /customs duty/i,
    /income tax/i,
    /personal finance/i,
    /stock market/i,
  ];
  if (outOfScope.some((p) => p.test(query))) {
    return {
      intent: "out_of_scope",
      confidence: "high",
      is_deterministic: true,
      rule_engine_answer: getOutOfScopeMessage(query),
    };
  }

  return {
    intent: "general_vat",
    confidence: "low",
    is_deterministic: false,
    suggested_doc_types: ["vat_law", "fta_guide"],
  };
}

function buildDeterministicAnswer(intent: VatIntent, query: string): string | undefined {
  if (intent === "filing_deadline") {
    return `UAE VAT filing deadlines:
• Standard businesses: quarterly VAT return, due within **28 days** after the end of each tax period.
• Large businesses (annual turnover > AED 150 million): monthly VAT return, due within **28 days** after month end.
• Source: Federal Decree-Law No. 8 of 2017, Articles 67–69.`;
  }

  if (intent === "vat_calculation") {
    // Try to extract amount from query
    const amountMatch = query.match(/[\d,]+(?:\.\d+)?/);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[0].replace(/,/g, ""));
      if (!isNaN(amount) && amount > 0) {
        const calc = calculateVat(amount);
        return `VAT calculation for AED ${amount.toLocaleString()}:
• Net amount: AED ${calc.net_amount.toLocaleString()}
• VAT (5%): AED ${calc.vat_amount.toLocaleString()}
• Gross (incl. VAT): AED ${calc.gross_amount.toLocaleString()}
_Note: This assumes standard 5% VAT rate. Zero-rated or exempt supplies have 0% VAT._`;
      }
    }
    return `UAE standard VAT rate is **5%**.
Formula: VAT = Net Amount × 0.05 | Gross = Net × 1.05 | Net from Gross = Gross ÷ 1.05`;
  }

  if (intent === "registration_check") {
    return `UAE VAT Registration Thresholds:
• **Mandatory registration**: Annual taxable turnover ≥ **AED 375,000** — must register within 30 days of exceeding.
• **Voluntary registration**: Annual taxable turnover ≥ **AED 187,500** — may register voluntarily.
• **Non-residents**: Must register if making taxable supplies in UAE, regardless of turnover.
• Source: Federal Decree-Law No. 8 of 2017, Article 17.`;
  }

  if (intent === "penalty") {
    return `UAE VAT Penalties (key amounts):
• Late registration: AED 10,000–20,000
• Late filing (1st time): AED 1,000 | Repeat: AED 2,000
• Late payment: 2% of unpaid tax (first month) + 4% per month from month 6
• Source: Federal Decree-Law No. 28 of 2022 — Tax Procedures Law.`;
  }

  return undefined;
}

function getOutOfScopeMessage(query: string): string {
  if (/saudi arabia|ksa|zatca/i.test(query))
    return "This question appears to relate to Saudi Arabia VAT (ZATCA), which is different from UAE VAT (FTA). I can only assist with UAE VAT matters.";
  if (/corporate tax/i.test(query))
    return "UAE Corporate Tax is governed by a separate law (Federal Decree-Law No. 47 of 2022) and is outside my scope. I can only assist with UAE VAT.";
  return "This question appears to be outside the scope of UAE VAT. I can only assist with UAE VAT matters administered by the Federal Tax Authority (FTA).";
}

/** Build a deterministic fact block to prepend to the RAG prompt */
export function buildRuleContext(intent: IntentResult): string {
  const parts: string[] = [];

  parts.push(`=== UAE VAT RULE ENGINE ===`);
  parts.push(`Detected intent: ${intent.intent}`);
  parts.push(`Standard rate: ${VAT_RULES.standard_rate * 100}% | Mandatory registration: AED ${VAT_RULES.registration.mandatory_threshold_aed.toLocaleString()}`);

  if (intent.intent === "designated_zone") {
    const dz = VAT_RULES.designated_zones;
    parts.push(`Designated Zone rules:`);
    parts.push(`• DZ to DZ: ${dz.dz_to_dz_vat}`);
    parts.push(`• DZ to Mainland: ${dz.dz_to_mainland}`);
    parts.push(`• Mainland to DZ: ${dz.mainland_to_dz}`);
    parts.push(`• Key condition: ${dz.key_condition}`);
  }

  if (intent.intent === "rcm") {
    parts.push(`RCM applies to: ${VAT_RULES.rcm_applies_to.join("; ")}`);
  }

  if (intent.intent === "zero_rating") {
    parts.push(`Zero-rated categories: ${VAT_RULES.zero_rated_categories.join("; ")}`);
  }

  if (intent.intent === "exemption") {
    parts.push(`Exempt categories: ${VAT_RULES.exempt_categories.join("; ")}`);
  }

  parts.push(`2026 amendments: ${VAT_RULES.amendments_2026.join(" | ")}`);
  parts.push(`=== END RULE ENGINE ===`);

  return parts.join("\n");
}
