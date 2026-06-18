-- Update metadata for all 32 indexed documents
-- Run in Supabase SQL Editor

-- ── RANK 1 — Binding Legislation ─────────────────────────────────────────────

UPDATE fta_documents SET
  doc_type = 'vat_law', priority = 10, legal_rank = 1,
  authority = 'UAE Federal Government',
  effective_date = '2018-01-01',
  version = 'Amended (Federal Decree-Law No. 18/2022, No. 16/2024, No. 16/2025)',
  covers = 'Core UAE VAT law — definitions, scope, registration, rates, returns, penalties, designated zones, zero-rating, exemptions'
WHERE source_url = 'pdf://01-vat-law-decree-8-2017.pdf';

UPDATE fta_documents SET
  doc_type = 'executive_regulation', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2018-01-01',
  version = 'Amended (Cabinet Decision No. 100/2024)',
  covers = 'Detailed implementing rules for VAT Law — place of supply, zero-rating conditions, registration procedures, invoicing'
WHERE source_url = 'pdf://02-executive-regulations-cab-52-2017.pdf';

UPDATE fta_documents SET
  doc_type = 'executive_regulation', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2018-01-01',
  version = 'Amended (Cabinet Decision No. 100/2024)',
  covers = 'Detailed implementing rules for VAT Law — full text from UAE Legislation Portal'
WHERE source_url = 'pdf://02b-exec-reg-cab-52-2017-leg.pdf';

UPDATE fta_documents SET
  doc_type = 'tax_procedures', priority = 10, legal_rank = 1,
  authority = 'UAE Federal Government',
  effective_date = '2023-03-01',
  version = 'v1 — Federal Decree-Law No. 28 of 2022',
  covers = 'Tax procedures — registration, filing, audits, disputes, voluntary disclosure, penalties'
WHERE source_url = 'pdf://02c-tax-procedures-1625.pdf';

-- ── RANK 2 — Cabinet Decisions ───────────────────────────────────────────────

UPDATE fta_documents SET
  doc_type = 'cabinet_decision', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2018-01-01',
  version = 'v1',
  covers = 'Official list of UAE Designated Zones for VAT purposes'
WHERE source_url = 'pdf://20-cab-59-2017-designated-zones.pdf';

UPDATE fta_documents SET
  doc_type = 'cabinet_decision', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2018-10-18',
  version = 'v1',
  covers = 'VAT refund system for tourists — conditions, eligible goods, process'
WHERE source_url = 'pdf://02e-cab-1230-tourist-refund.pdf';

UPDATE fta_documents SET
  doc_type = 'cabinet_decision', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2018-09-01',
  version = 'v1',
  covers = 'VAT refund on services in exhibitions and conferences'
WHERE source_url = 'pdf://02f-cab-1229-exhibitions.pdf';

UPDATE fta_documents SET
  doc_type = 'cabinet_decision', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2025-02-26',
  version = 'v1 — Cabinet Decision No. 127 of 2024',
  covers = 'Reverse Charge Mechanism for gold, silver, platinum, palladium and precious stones between UAE VAT registered businesses'
WHERE source_url = 'pdf://03-cab-127-2024-rcm-precious-metals.pdf';

UPDATE fta_documents SET
  doc_type = 'cabinet_decision', priority = 10, legal_rank = 2,
  authority = 'UAE Cabinet',
  effective_date = '2025-01-01',
  version = 'v1 — Cabinet Decision No. 153 of 2025',
  covers = 'Reverse Charge Mechanism for scrap metal trade between UAE VAT registered businesses'
WHERE source_url = 'pdf://02d-cab-3860-scrap-metal.pdf';

-- ── RANK 3 — FTA Public Clarifications ───────────────────────────────────────

UPDATE fta_documents SET
  doc_type = 'public_clarification', priority = 9, legal_rank = 3,
  authority = 'Federal Tax Authority',
  effective_date = '2018-11-01',
  version = 'VATP001',
  covers = 'VAT treatment of compensation-type payments — penalties, damages, deposits, liquidated damages, insurance payouts'
WHERE source_url = 'pdf://16-vatp001-compensation-payments.pdf';

UPDATE fta_documents SET
  doc_type = 'public_clarification', priority = 9, legal_rank = 3,
  authority = 'Federal Tax Authority',
  effective_date = '2019-07-18',
  version = 'VATP015',
  covers = 'VAT treatment of Transfer of Going Concern (TOGC) — conditions for non-supply treatment'
WHERE source_url = 'pdf://17-vatp015-togc.pdf';

UPDATE fta_documents SET
  doc_type = 'public_clarification', priority = 9, legal_rank = 3,
  authority = 'Federal Tax Authority',
  effective_date = '2022-11-17',
  version = 'VATP031',
  covers = 'VAT treatment of director services — whether director fees are subject to VAT'
WHERE source_url = 'pdf://18-vatp031-director-services.pdf';

UPDATE fta_documents SET
  doc_type = 'public_clarification', priority = 9, legal_rank = 3,
  authority = 'Federal Tax Authority',
  effective_date = '2024-11-18',
  version = 'Private Clarifications Nov 2024',
  covers = 'FTA private clarifications on various VAT topics — November 2024 edition'
WHERE source_url = 'pdf://Private-Clarifications-EN-18-11-2024.pdf';

UPDATE fta_documents SET
  doc_type = 'public_clarification', priority = 9, legal_rank = 3,
  authority = 'Federal Tax Authority',
  effective_date = '2025-07-24',
  version = 'Private Clarifications Jul 2025',
  covers = 'FTA private clarifications on various VAT topics — July 2025 edition'
WHERE source_url = 'pdf://Private-Clarifications-EN-24-07-2025.pdf';

-- ── RANK 4 — FTA Guides ───────────────────────────────────────────────────────

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2018-01-01',
  version = 'VATGDZ1',
  covers = 'VAT treatment for Designated Zones — difference from free zones, goods/services rules, Article 51 conditions'
WHERE source_url = 'pdf://04-designated-zones-guide-vatgdz1.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2021-04-19',
  version = 'VATGRE1',
  covers = 'VAT on real estate — residential vs commercial, first supply, bare land, conversion, developer obligations'
WHERE source_url = 'pdf://05-real-estate-guide-vatgre1.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2023-06-16',
  version = 'VATGIT1',
  covers = 'Input tax apportionment — standard SRP method, special methods, adjustments for mixed-use businesses'
WHERE source_url = 'pdf://06-input-tax-apportionment-vatgit1.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2021-11-16',
  version = 'v9.0',
  covers = 'VAT registration on EmaraTax — step-by-step guide, required documents, thresholds, deregistration'
WHERE source_url = 'pdf://07-vat-registration-user-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2020-08-09',
  version = 'v1',
  covers = 'VAT on e-commerce — online sales, digital services, marketplaces, non-resident sellers'
WHERE source_url = 'pdf://08-ecommerce-vat-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2021-06-29',
  version = 'v1',
  covers = 'VAT in automotive sector — new/used cars, warranties, leasing, fleet management, spare parts'
WHERE source_url = 'pdf://09-automotive-vat-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2018-09-01',
  version = 'VATGIN1',
  covers = 'VAT on insurance — life insurance exempt, general insurance standard-rated, reinsurance, claims handling'
WHERE source_url = 'pdf://10-insurance-vat-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2021-10-28',
  version = 'v4.1',
  covers = 'VAT refund process on EmaraTax — eligible claimants, documentation, timeline'
WHERE source_url = 'pdf://11-vat-refund-user-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2018-01-01',
  version = 'v1',
  covers = 'Tax invoices — mandatory fields, simplified invoices, credit notes, record-keeping requirements'
WHERE source_url = 'pdf://12-tax-invoices-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2026-01-02',
  version = '2026 edition',
  covers = 'Profit Margin Scheme — eligible goods, calculation method, record-keeping, 2026 updates'
WHERE source_url = 'pdf://13-profit-margin-scheme-2026.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2025-12-05',
  version = '2025 edition',
  covers = 'VAT administrative exceptions — how to apply for exceptions, eligible scenarios, FTA process'
WHERE source_url = 'pdf://14-vat-admin-exceptions-guide-2025.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2026-06-09',
  version = 'Jun 2026',
  covers = 'VAT refund for UAE nationals building new residences — eligibility, process, documentation (Jun 2026 update)'
WHERE source_url = 'pdf://15-vat-refund-nationals-jun-2026.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2019-01-01',
  version = 'VATGFS1',
  covers = 'VAT on financial services — banking, insurance, investment funds, interest margin, exempt vs standard-rated'
WHERE source_url = 'pdf://21-financial-services-guide-vatgfs1.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 9, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2026-04-10',
  version = 'Apr 2026',
  covers = 'VAT refund for UAE nationals building new residences — April 2026 update'
WHERE source_url LIKE 'pdf://VAT-Refund-for-UAE-Nationals%';

UPDATE fta_documents SET
  doc_type = 'vat_law', priority = 9, legal_rank = 1,
  authority = 'UAE Federal Government',
  effective_date = '2017-01-01',
  version = 'Federal Decree-Law No. 13 of 2016',
  covers = 'Establishment of Federal Tax Authority — mandate, powers, governance'
WHERE source_url = 'pdf://law-2572-en.pdf';

-- ── Reference Documents (Priority 8–7) ───────────────────────────────────────

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 8, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2018-01-01',
  version = 'v1',
  covers = 'VAT on healthcare — zero-rated medicines/equipment/services, conditions, private vs public healthcare'
WHERE source_url = 'pdf://22-healthcare-vat-guide.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 8, legal_rank = 4,
  authority = 'UAE Government (u.ae)',
  effective_date = '2018-01-01',
  version = 'v1',
  covers = 'VAT treatment overview for selected industries — summary reference from official UAE government portal'
WHERE source_url = 'pdf://19-uae-gov-vat-selected-industries.pdf';

UPDATE fta_documents SET
  doc_type = 'fta_guide', priority = 7, legal_rank = 4,
  authority = 'Federal Tax Authority',
  effective_date = '2020-01-01',
  version = '2020 edition',
  covers = 'VAT refund guide for UAE nationals building new residences — 2020 version (superseded by 2026 update)'
WHERE source_url = 'pdf://23-vat-refund-nationals-2020.pdf';

-- Verify all updated
SELECT title, doc_type, legal_rank, priority, effective_date, authority, version
FROM fta_documents
ORDER BY legal_rank, priority DESC, title;
