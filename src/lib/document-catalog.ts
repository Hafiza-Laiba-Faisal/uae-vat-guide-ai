/**
 * Master catalog of official UAE VAT documents.
 * AI uses this to identify authoritative sources and their coverage.
 * Update "indexed: true" when a document is added to the knowledge base.
 */

export type DocType =
  | "law"
  | "law_amendment"
  | "regulation"
  | "regulation_amendment"
  | "cabinet_decision"
  | "fta_guide"
  | "public_clarification";

export interface CatalogDocument {
  id: string;
  name: string;
  short_name: string;
  type: DocType;
  year: number;
  effective_date?: string;
  status: "active" | "active_amended" | "superseded";
  covers: string;
  indexed: boolean;
}

export const CATALOG_VERSION = "1.0";
export const CATALOG_LAST_UPDATED = "2026-06-17";

export const UAE_VAT_QUICK_REFERENCE = {
  standard_rate: "5%",
  vat_introduced: "2018-01-01",
  governing_authority: "Federal Tax Authority (FTA)",
  mandatory_registration_threshold: "AED 375,000",
  voluntary_registration_threshold: "AED 187,500",
  filing_frequency_standard: "Quarterly",
  filing_frequency_large: "Monthly (if annual turnover > AED 150 million)",
  filing_deadline: "28 days after end of tax period",
  key_2026_changes: [
    "RCM self-invoice requirement removed (effective 1 Jan 2026)",
    "FTA can deny input VAT if linked to tax evasion (effective 1 Jan 2026)",
    "VAT credits older than 5 years expire — deadline 31 Dec 2026",
    "Audit time limits now governed by Tax Procedures Law",
  ],
};

export const DOCUMENT_CATALOG: CatalogDocument[] = [
  // ── Laws ──────────────────────────────────────────────────────────────────
  {
    id: "VAT-LAW-2017",
    name: "Federal Decree-Law No. 8 of 2017 on Value Added Tax",
    short_name: "UAE VAT Law",
    type: "law",
    year: 2017,
    effective_date: "2018-01-01",
    status: "active_amended",
    covers: "Core UAE VAT legislation — definitions, scope, rates, registration, returns, penalties",
    indexed: true,
  },
  {
    id: "VAT-LAW-AMD-2023",
    name: "Federal Decree-Law No. 18 of 2022 — VAT Law Amendment",
    short_name: "VAT Law 2023 Amendment",
    type: "law_amendment",
    year: 2022,
    effective_date: "2023-01-01",
    status: "active",
    covers: "24 articles amended — audit timeline extended, voluntary disclosure rules, government entity transactions",
    indexed: false,
  },
  {
    id: "VAT-LAW-AMD-2024",
    name: "Federal Decree-Law No. 16 of 2024 — VAT Law Amendment",
    short_name: "VAT Law Oct 2024 Amendment",
    type: "law_amendment",
    year: 2024,
    effective_date: "2024-10-30",
    status: "active",
    covers: "Interim amendments before 2026 overhaul",
    indexed: false,
  },
  {
    id: "VAT-LAW-AMD-2026",
    name: "Federal Decree-Law No. 16 of 2025 — VAT Law Amendment",
    short_name: "VAT Law 2026 Amendment",
    type: "law_amendment",
    year: 2025,
    effective_date: "2026-01-01",
    status: "active",
    covers: "RCM self-invoice removed, input VAT denial for evasion, audit time limits removed, VAT credit expiry 5 years",
    indexed: false,
  },

  // ── Regulations ───────────────────────────────────────────────────────────
  {
    id: "EXEC-REG-2017",
    name: "Cabinet Decision No. 52 of 2017 — VAT Executive Regulations",
    short_name: "VAT Executive Regulations",
    type: "regulation",
    year: 2017,
    effective_date: "2018-01-01",
    status: "active_amended",
    covers: "Detailed implementation rules for VAT Law — place of supply, zero-rating conditions, registration process",
    indexed: true,
  },
  {
    id: "EXEC-REG-AMD-2024",
    name: "Cabinet Decision No. 100 of 2024 — VAT Executive Regulations Amendment",
    short_name: "Executive Reg Nov 2024 Amendment",
    type: "regulation_amendment",
    year: 2024,
    effective_date: "2024-11-15",
    status: "active",
    covers: "33 articles revised — export documentation flexible, virtual assets defined, employee health insurance input VAT, financial services, zero-rating restrictions",
    indexed: false,
  },

  // ── Cabinet Decisions ─────────────────────────────────────────────────────
  {
    id: "CAB-59-2017",
    name: "Cabinet Decision No. 59 of 2017 — Designated Zones",
    short_name: "Designated Zones Cabinet Decision",
    type: "cabinet_decision",
    year: 2017,
    effective_date: "2018-01-01",
    status: "active",
    covers: "List of UAE Designated Zones for VAT purposes",
    indexed: true,
  },
  {
    id: "CAB-127-2024",
    name: "Cabinet Decision No. 127 of 2024 — Reverse Charge Precious Metals",
    short_name: "RCM Precious Metals Decision",
    type: "cabinet_decision",
    year: 2024,
    effective_date: "2025-02-26",
    status: "active",
    covers: "Expands RCM to gold, silver, platinum, palladium and precious stones between UAE VAT registered businesses",
    indexed: true,
  },

  // ── FTA Guides ────────────────────────────────────────────────────────────
  {
    id: "GUIDE-GENERAL",
    name: "VAT General Guide",
    short_name: "VAT General Guide",
    type: "fta_guide",
    year: 2018,
    status: "active",
    covers: "Overview of UAE VAT — how it works, who pays, registration, filing, invoicing",
    indexed: false,
  },
  {
    id: "GUIDE-VATGDZ1",
    name: "VAT Guide for Designated Zones (VATGDZ1)",
    short_name: "Designated Zones Guide",
    type: "fta_guide",
    year: 2018,
    status: "active",
    covers: "VAT treatment of goods and services in designated zones, difference between free zones and designated zones",
    indexed: false,
  },
  {
    id: "GUIDE-VATGRE1",
    name: "Real Estate VAT Guide (VATGRE1)",
    short_name: "Real Estate Guide",
    type: "fta_guide",
    year: 2021,
    status: "active",
    covers: "VAT on residential vs commercial property, first supply, bare land, conversion",
    indexed: false,
  },
  {
    id: "GUIDE-VATGFS1",
    name: "Financial Services VAT Guide (VATGFS1)",
    short_name: "Financial Services Guide",
    type: "fta_guide",
    year: 2019,
    status: "active",
    covers: "VAT on banking, insurance, investment funds, interest, margin",
    indexed: false,
  },
  {
    id: "GUIDE-HEALTHCARE",
    name: "Healthcare VAT Guide",
    short_name: "Healthcare Guide",
    type: "fta_guide",
    year: 2018,
    status: "active",
    covers: "Zero-rated medicines, medical equipment, healthcare services",
    indexed: false,
  },
  {
    id: "GUIDE-VATGIT1",
    name: "Input Tax Apportionment Guide (VATGIT1)",
    short_name: "Input Tax Apportionment Guide",
    type: "fta_guide",
    year: 2023,
    status: "active",
    covers: "How to apportion input VAT for businesses making both taxable and exempt supplies, SRP method",
    indexed: false,
  },
  {
    id: "GUIDE-REGISTRATION",
    name: "VAT Registration User Guide",
    short_name: "Registration Guide",
    type: "fta_guide",
    year: 2021,
    status: "active",
    covers: "Step by step VAT registration on EmaraTax, required documents, thresholds",
    indexed: false,
  },
  {
    id: "GUIDE-ECOMMERCE",
    name: "E-Commerce VAT Guide",
    short_name: "E-Commerce Guide",
    type: "fta_guide",
    year: 2020,
    status: "active",
    covers: "VAT on online sales, digital services, marketplaces, non-resident sellers",
    indexed: false,
  },
  {
    id: "GUIDE-INSURANCE",
    name: "Insurance VAT Guide (VATGIN1)",
    short_name: "Insurance Guide",
    type: "fta_guide",
    year: 2018,
    status: "active",
    covers: "Life insurance exempt, general insurance standard rated, reinsurance, claims",
    indexed: false,
  },
  {
    id: "GUIDE-AUTOMOTIVE",
    name: "Automotive Sector VAT Guide",
    short_name: "Automotive Guide",
    type: "fta_guide",
    year: 2021,
    status: "active",
    covers: "VAT on new and used cars, warranties, leasing, spare parts",
    indexed: false,
  },

  // ── Public Clarifications ─────────────────────────────────────────────────
  {
    id: "VATP001",
    name: "VATP001 — Compensation Type Payments",
    short_name: "VATP001",
    type: "public_clarification",
    year: 2018,
    status: "active",
    covers: "VAT on penalties, damages, deposits, liquidated damages",
    indexed: false,
  },
  {
    id: "VATP015",
    name: "VATP015 — Transfer of Going Concern (TOGC)",
    short_name: "VATP015 TOGC",
    type: "public_clarification",
    year: 2019,
    status: "active",
    covers: "VAT treatment when selling a business as going concern",
    indexed: false,
  },
  {
    id: "VATP031",
    name: "VATP031 — Director Services",
    short_name: "VATP031",
    type: "public_clarification",
    year: 2022,
    status: "active",
    covers: "Whether director fees are subject to VAT",
    indexed: false,
  },
  {
    id: "VATP040",
    name: "VATP040 — Executive Regulations Amendment Clarification",
    short_name: "VATP040",
    type: "public_clarification",
    year: 2025,
    status: "active",
    covers: "FTA interpretation of Cabinet Decision 100 of 2024 amendments",
    indexed: false,
  },
  {
    id: "VATP043",
    name: "VATP043 — Precious Metals and Stones RCM",
    short_name: "VATP043",
    type: "public_clarification",
    year: 2025,
    status: "active",
    covers: "Reverse charge on gold, silver, platinum, precious stones — Cabinet Decision 127/2024",
    indexed: true,
  },
  {
    id: "VATP044",
    name: "VATP044 — Import of Services RCM",
    short_name: "VATP044",
    type: "public_clarification",
    year: 2024,
    status: "active",
    covers: "How to account for VAT on imported services, self-invoicing rules",
    indexed: true,
  },
];

/** Documents not yet indexed — admin should add these */
export const UNINDEXED_DOCUMENTS = DOCUMENT_CATALOG.filter((d) => !d.indexed);

/** Build a compact catalog summary for the AI system prompt */
export function buildCatalogSummary(): string {
  const indexed = DOCUMENT_CATALOG.filter((d) => d.indexed);
  const unindexed = DOCUMENT_CATALOG.filter((d) => !d.indexed);

  const lines: string[] = [
    "=== UAE VAT DOCUMENT CATALOG ===",
    `Quick Reference: Standard rate ${UAE_VAT_QUICK_REFERENCE.standard_rate} | Mandatory registration AED ${UAE_VAT_QUICK_REFERENCE.mandatory_registration_threshold} | Filing deadline ${UAE_VAT_QUICK_REFERENCE.filing_deadline}`,
    `Key 2026 changes: ${UAE_VAT_QUICK_REFERENCE.key_2026_changes.join("; ")}`,
    "",
    `INDEXED DOCUMENTS (${indexed.length} — use these for citations):`,
  ];

  for (const d of indexed) {
    lines.push(`  [${d.id}] ${d.short_name} (${d.year}) — ${d.covers}`);
  }

  lines.push("");
  lines.push(`NOT YET INDEXED (${unindexed.length} — may be relevant but not in knowledge base):`);
  for (const d of unindexed) {
    lines.push(`  [${d.id}] ${d.short_name} (${d.year}) — ${d.covers}`);
  }

  lines.push("=== END CATALOG ===");
  return lines.join("\n");
}
