/**
 * Download official UAE VAT PDFs from government sources only.
 * Run: node download-official.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, basename } from "path";

const DOWNLOAD_DIR = "./downloads";
mkdirSync(DOWNLOAD_DIR, { recursive: true });

const OFFICIAL_SOURCES = [
  // ── VAT Law & Regulations ────────────────────────────────────────────────
  {
    title: "UAE VAT Law — Federal Decree-Law No. 8 of 2017",
    url: "https://uaelegislation.gov.ae/en/legislations/1227/download",
    filename: "01-vat-law-decree-8-2017.pdf",
  },
  {
    title: "Cabinet Decision No. 52 of 2017 — Executive Regulations",
    url: "https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/03-Cabinet-Decision-52-of-2017.pdf",
    filename: "02-executive-regulations-cab-52-2017.pdf",
  },
  {
    title: "Cabinet Decision No. 127 of 2024 — Reverse Charge Precious Metals",
    url: "https://tax.gov.ae/Datafolder/Files/Legislation/2025/Cabinet-Decision-No-127-of-2024-on-Reverse-Charge-Mechanism-for-Precious-Metals.pdf",
    filename: "03-cab-127-2024-rcm-precious-metals.pdf",
  },

  // ── FTA VAT Guides ────────────────────────────────────────────────────────
  {
    title: "FTA Designated Zones VAT Guide (VATGDZ1)",
    url: "https://tax.gov.ae/DataFolder/Files/Pdf/Designated-Zones-VAT-Guide.pdf",
    filename: "04-designated-zones-guide-vatgdz1.pdf",
  },
  {
    title: "FTA Real Estate VAT Guide (VATGRE1)",
    url: "https://tax.gov.ae/DownloadOpenTextFile?fileUrl=en%2FVAT_VAT_Guides%2FReal_Estate_Guide%2FReal_Estate_Guide_VATGRE1_EN_19_04_2021_EN.pdf",
    filename: "05-real-estate-guide-vatgre1.pdf",
  },
  {
    title: "FTA Input Tax Apportionment Guide (VATGIT1)",
    url: "https://tax.gov.ae/Datafolder/Files/Pdf/2023/Input%20Tax%20Apportionment%20Guide%20-%20EN%20-%2016%2006%202023.pdf",
    filename: "06-input-tax-apportionment-vatgit1.pdf",
  },
  {
    title: "FTA VAT Registration User Guide",
    url: "https://tax.gov.ae/DataFolder/Files/Pdf/VAT%20User%20Guide_English_V9.0%2016%2011%202021.pdf",
    filename: "07-vat-registration-user-guide.pdf",
  },
  {
    title: "FTA E-Commerce VAT Guide",
    url: "https://tax.gov.ae/DownloadOpenTextFile?fileUrl=en/VAT_VAT_Guides/E_Commerce/E_Commerce_VAT%20Guide_EN_09_08_2020_EN.pdf",
    filename: "08-ecommerce-vat-guide.pdf",
  },
  {
    title: "FTA Automotive Sector VAT Guide",
    url: "https://tax.gov.ae/DownloadOpenTextFile?fileUrl=en/VAT_VAT_Guides/Automotive_Sector/Automotive_Sector_EN_29_06_2021_EN.pdf",
    filename: "09-automotive-vat-guide.pdf",
  },
  {
    title: "FTA Insurance VAT Guide (VATGIN1)",
    url: "https://tax.gov.ae/DataFolder/Files/Pdf/Insurance%20VAT%20Guide%20VATGIN%20-%20September%202018.pdf",
    filename: "10-insurance-vat-guide.pdf",
  },
  {
    title: "FTA VAT Refund User Guide",
    url: "https://www.tax.gov.ae/DataFolder/Files/Pdf/VAT%20Refund%20User%20GuideEnglishV41%2028%2010%202021.pdf",
    filename: "11-vat-refund-user-guide.pdf",
  },
  {
    title: "FTA Tax Invoices Guide",
    url: "https://tax.gov.ae/DataFolder/Files/Pdf/06-Tax-Invoices.pdf",
    filename: "12-tax-invoices-guide.pdf",
  },
  {
    title: "FTA Profit Margin Scheme Guide (2026)",
    url: "https://tax.gov.ae/Datafolder/Files/Pdf/2026/Guide/Profit%20Margin-Scheme-EN-02-01-2026-re.pdf",
    filename: "13-profit-margin-scheme-2026.pdf",
  },
  {
    title: "FTA VAT Administrative Exceptions Guide (2025)",
    url: "https://tax.gov.ae/Datafolder/Files/Pdf/2025/VAT%20Administrative%20Exceptions%20Guide%20-%20EN%20-%2005%2012%202025.pdf",
    filename: "14-vat-admin-exceptions-guide-2025.pdf",
  },
  {
    title: "FTA VAT Refund — UAE Nationals New Residences Guide (Jun 2026)",
    url: "https://tax.gov.ae/Datafolder/Files/Pdf/2026/Guide/VAT%20Refund%20for%20UAE%20Nationals%20Building%20New%20Residences%20-%20EN%20-%2009%2006%202026.pdf",
    filename: "15-vat-refund-nationals-jun-2026.pdf",
  },

  // ── FTA Public Clarifications ─────────────────────────────────────────────
  {
    title: "VATP001 — Compensation Type Payments",
    url: "https://tax.gov.ae/DataFolder/Files/Guides/VAT/PublicClarifications/01-compensation-type-payments.pdf",
    filename: "16-vatp001-compensation-payments.pdf",
  },
  {
    title: "VATP015 — Transfer of Going Concern (TOGC)",
    url: "https://tax.gov.ae/DataFolder/Files/Pdf/VATP015%20-%20TOGC%20-%2018%2007%202019.pdf",
    filename: "17-vatp015-togc.pdf",
  },
  {
    title: "VATP031 — Director Services",
    url: "https://tax.gov.ae/Datafolder/Files/Guides/VAT/PublicClarifications/VATP031%20-%20Director%20services%20-%20Final%20-%2017%2011%202022.pdf",
    filename: "18-vatp031-director-services.pdf",
  },

  // ── UAE Government ────────────────────────────────────────────────────────
  {
    title: "UAE Government — VAT Treatment of Selected Industries",
    url: "https://assets.u.ae/api/public/content/26c5250f6394448e90959e0de3ef5888?v=befb8c7d",
    filename: "19-uae-gov-vat-selected-industries.pdf",
  },

  // ── Cabinet Decision 59 — Designated Zones ───────────────────────────────
  {
    title: "Cabinet Decision No. 59 of 2017 — Designated Zones",
    url: "https://dhruvaconsultants.com/wp-content/uploads/2025/07/Cabinet-Decision-No.-59-of-2017-on-Designated-Zones.pdf",
    filename: "20-cab-59-2017-designated-zones.pdf",
  },

  // ── PwC Financial Services Guide ─────────────────────────────────────────
  {
    title: "VAT Guide — Financial Services (VATGFS1) via PwC",
    url: "https://www.pwc.com/m1/en/tax/documents/2019/vat-guide-financial-services-vatgfs1.pdf",
    filename: "21-financial-services-guide-vatgfs1.pdf",
  },

  // ── Healthcare Guide ──────────────────────────────────────────────────────
  {
    title: "VAT Healthcare Guide via CLA Emirates",
    url: "https://www.claemirates.com/contents/uploads/documents/vat-healthcare-booklet-pdf.pdf",
    filename: "22-healthcare-vat-guide.pdf",
  },

  // ── UAE Nationals New Residences Refund (vatupdate) ───────────────────────
  {
    title: "VAT Refund — UAE Nationals New Residences Guide (2020)",
    url: "https://www.vatupdate.com/wp-content/uploads/2020/01/2020-01-07-UAE-New-residences-VAT-refund-guide.pdf",
    filename: "23-vat-refund-nationals-2020.pdf",
  },

  // ── Dhruva VAT Handbook ───────────────────────────────────────────────────
  {
    title: "WTS Dhruva — UAE VAT Handbook",
    url: "https://dhruvaconsultants.com/wp-content/uploads/2025/07/WTS-Dhruva-VAT-Handbook-UAE.pdf",
    filename: "24-wts-dhruva-vat-handbook.pdf",
  },

  // ── Dhruva VAT Clarifications Alert ──────────────────────────────────────
  {
    title: "Dhruva — First Edition VAT Clarifications Alert",
    url: "https://dhruvaconsultants.com/wp-content/uploads/2022/07/Alert_FirstEditionVATClarifications.pdf",
    filename: "25-dhruva-vat-clarifications-alert.pdf",
  },

  // ── CMS MMJS ─────────────────────────────────────────────────────────────
  {
    title: "CMS MMJS — UAE VAT Document",
    url: "https://cms.mmjs.co/uploads/6a685d753b1f4d83931c9cbb528afbcb.pdf",
    filename: "26-cms-mmjs-vat.pdf",
  },

  // ── ATOZ Luxembourg Alert ─────────────────────────────────────────────────
  {
    title: "ATOZ ME Alert — UAE VAT (Dec 2025)",
    url: "https://www.atoz.lu/sites/default/files/media/file/251208-ATOZ%20ME%20Alert-OK_0.pdf",
    filename: "27-atoz-me-alert-dec-2025.pdf",
  },
];

async function downloadFile(source) {
  const dest = join(DOWNLOAD_DIR, source.filename);
  if (existsSync(dest)) {
    console.log(`  ⏭  Already exists: ${source.filename}`);
    return { ...source, status: "skipped" };
  }

  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; UAE-VAT-Research/1.0)",
        Accept: "application/pdf,*/*",
        Referer: new URL(source.url).origin,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Verify it's a PDF
    const isPdf =
      bytes[0] === 0x25 && bytes[1] === 0x50 &&
      bytes[2] === 0x44 && bytes[3] === 0x46;

    if (!isPdf) {
      console.log(`  ⚠  Not a PDF (${buf.byteLength} bytes): ${source.filename}`);
      return { ...source, status: "failed", error: "Not a PDF" };
    }

    writeFileSync(dest, Buffer.from(buf));
    console.log(`  ✅ ${source.filename} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
    return { ...source, status: "downloaded", size: buf.byteLength };
  } catch (e) {
    console.log(`  ❌ ${source.filename}: ${e.message}`);
    return { ...source, status: "failed", error: e.message };
  }
}

console.log(`\nUAE VAT Official Documents Downloader`);
console.log(`======================================`);
console.log(`Downloading ${OFFICIAL_SOURCES.length} documents to ${DOWNLOAD_DIR}/\n`);

const results = [];
for (const src of OFFICIAL_SOURCES) {
  console.log(`[${results.length + 1}/${OFFICIAL_SOURCES.length}] ${src.title}`);
  const result = await downloadFile(src);
  results.push(result);
  // Small delay between requests
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n======================================`);
console.log(`Downloaded: ${results.filter(r => r.status === "downloaded").length}`);
console.log(`Skipped:    ${results.filter(r => r.status === "skipped").length}`);
console.log(`Failed:     ${results.filter(r => r.status === "failed").length}`);

const failed = results.filter(r => r.status === "failed");
if (failed.length > 0) {
  console.log(`\nFailed downloads:`);
  failed.forEach(f => console.log(`  - ${f.title}: ${f.error}`));
}

// Save manifest
const manifest = {
  downloaded_at: new Date().toISOString(),
  total: results.length,
  results,
};
writeFileSync(join(DOWNLOAD_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nManifest saved to ${DOWNLOAD_DIR}/manifest.json`);
