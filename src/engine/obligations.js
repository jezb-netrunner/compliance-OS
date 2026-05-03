// src/engine/obligations.js
//
// Canonical obligation-generation engine for Philippine BIR compliance.
// Pure functions — no DOM, no Supabase, no globals — so they can run
// in Node (Vitest), Deno (edge functions), and the browser bundle alike.
//
// Current through:
//   - RA 11976 (EOPT) — 2550M and 0605 ARF abolished; VAT filed quarterly only.
//   - RA 12066 (CREATE MORE) — 20% RCIT for RBEs under EDR.
//   - RR 11-2025 as amended by RR 26-2025, and RR 1-2026 — e-invoicing.
//   - RMC 30-2026 (EO 110, s. 2026) — CY 2025 annual ITR override.

const _MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December']

/**
 * Local-timezone-safe ISO date formatter.  date.toISOString() converts
 * to UTC, which silently shifts a local-midnight date back by 24 hours
 * for any user east of UTC (Asia/Manila is UTC+8) — making every
 * persisted due date wrong by one day.  Format the local components
 * directly instead.
 */
function _iso(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Philippine non-working days (regular holidays + special non-working
 * days) for years the app actually generates obligations for.  When a
 * BIR deadline falls on any of these dates — or on a Sat/Sun — the
 * deadline shifts to the next regular business day per the long-
 * standing BIR practice codified in RMC 1-2009 ("Whenever a tax
 * payment falls due on a Saturday, Sunday or legal holiday, the same
 * may be paid on the next succeeding business day").
 *
 * Sources:
 *   • Proclamation No. 368 s.2023 — 2024 holidays
 *   • Proclamation Nos. 514, 579 s.2024 — 2024 Eid'l Fitr / Adha
 *   • Proclamation No. 727 s.2024 — 2025 holidays
 *   • Proclamation Nos. 839, 911 s.2025 — 2025 Eid'l Fitr / Adha
 *   • Proclamation No. 878 s.2025 — additional 12 May 2025 SNW
 *   • Proclamation No. 1006 s.2025 — 2026 holidays
 *
 * Eid'l Fitr and Eid'l Adha for any future year are added once the
 * Office of the President issues the individual proclamation (the
 * dates depend on Hijri / lunar calculation and are not fixed in
 * the annual omnibus proclamation).
 */
const _PH_HOLIDAYS = new Set([
  // 2024
  '2024-01-01', // New Year's Day
  '2024-02-10', // Chinese New Year
  '2024-03-28', // Maundy Thursday
  '2024-03-29', // Good Friday
  '2024-03-30', // Black Saturday
  '2024-04-09', // Araw ng Kagitingan
  '2024-04-10', // Eid'l Fitr (Proc 514)
  '2024-05-01', // Labor Day
  '2024-06-12', // Independence Day
  '2024-06-17', // Eid'l Adha (Proc 579)
  '2024-08-21', // Ninoy Aquino Day
  '2024-08-26', // National Heroes Day
  '2024-11-01', // All Saints' Day
  '2024-11-02', // additional SNW
  '2024-11-30', // Bonifacio Day
  '2024-12-08', // Immaculate Conception
  '2024-12-24', // Christmas Eve
  '2024-12-25', // Christmas Day
  '2024-12-30', // Rizal Day
  '2024-12-31', // Last Day of the Year
  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-29', // Chinese New Year
  '2025-04-01', // Eid'l Fitr (Proc 839)
  '2025-04-09', // Araw ng Kagitingan
  '2025-04-17', // Maundy Thursday
  '2025-04-18', // Good Friday
  '2025-04-19', // Black Saturday
  '2025-05-01', // Labor Day
  '2025-05-12', // additional SNW (Proc 878)
  '2025-06-06', // Eid'l Adha (Proc 911)
  '2025-06-12', // Independence Day
  '2025-08-21', // Ninoy Aquino Day
  '2025-08-25', // National Heroes Day
  '2025-11-01', // All Saints' Day
  '2025-11-30', // Bonifacio Day
  '2025-12-08', // Immaculate Conception
  '2025-12-24', // Christmas Eve
  '2025-12-25', // Christmas Day
  '2025-12-30', // Rizal Day
  '2025-12-31', // Last Day of the Year
  // 2026 — Eid'l Fitr/Adha pending separate proclamations
  '2026-01-01', // New Year's Day
  '2026-02-17', // Chinese New Year
  '2026-04-02', // Maundy Thursday
  '2026-04-03', // Good Friday
  '2026-04-04', // Black Saturday
  '2026-04-09', // Araw ng Kagitingan
  '2026-05-01', // Labor Day
  '2026-06-12', // Independence Day
  '2026-08-21', // Ninoy Aquino Day
  '2026-08-31', // National Heroes Day
  '2026-11-01', // All Saints' Day
  '2026-11-02', // All Souls' Day
  '2026-11-30', // Bonifacio Day
  '2026-12-08', // Immaculate Conception
  '2026-12-24', // Christmas Eve
  '2026-12-25', // Christmas Day
  '2026-12-30', // Rizal Day
  '2026-12-31', // Last Day of the Year
])

/**
 * Move a date forward to the next regular business day, skipping
 * Saturdays, Sundays, and Philippine non-working days (see
 * _PH_HOLIDAYS).  Capped at 14 iterations as a safety net — the
 * longest non-working stretch in PH practice is the Holy Week +
 * weekend run, which is at most 5 consecutive days.
 */
function _nextBusinessDay(date) {
  const d = new Date(date)
  for (let i = 0; i < 14; i++) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6 && !_PH_HOLIDAYS.has(_iso(d))) return d
    d.setDate(d.getDate() + 1)
  }
  console.warn('_nextBusinessDay: exceeded 14-day cap for', _iso(date))
  return d
}

/**
 * Returns an array of obligation objects for the current calendar year
 * based on the client's taxpayer profile.
 *
 * Each object: { id, form, name, period, dueDate, category }
 *
 * Current through:
 *   - RA 11976 (EOPT) — 2550M and 0605 ARF abolished; VAT filed quarterly only.
 *   - RA 12066 (CREATE MORE) — 20% RCIT for RBEs under EDR (rate flag only;
 *     obligation set is the same as other domestic corporations).
 *   - RR 11-2025 as amended by RR 26-2025, and RR 1-2026 — e-invoicing.
 *   - RMC 30-2026 (EO 110, s. 2026) — CY 2025 annual ITR deadline overridden
 *     from 15 Apr 2026 to 15 May 2026.
 */
function generateObligations(profile, year) {
  const {
    taxpayer_type,
    vat_status,
    tax_classification,        // 'Micro' | 'Small' | 'Medium' | 'Large' | null  (RR 8-2024)
    deduction_method,          // 'Itemized' | 'OSD' | '8%' | null
    has_employees        = false,
    withholds_expanded   = false,
    withholds_final      = false,
    fiscal_year_start    = 1,  // 1 = calendar year
    owner_pays_sss       = false,
    owner_pays_philhealth= false,
    owner_pays_pagibig   = false,
    requires_audited_fs  = false,
    has_business_income  = true,  // for Estate/Trust: defaults to true to preserve
                                   // the previous behavior; set false for fiduciaries
                                   // not engaged in trade or business.
  } = profile
  const yr  = year ?? new Date().getFullYear()
  const obs = []

  /** Build one obligation entry */
  const ob = (localId, form, name, period, rawDate, category) => ({
    id:       `${yr}-${localId}`,
    form,
    name,
    period,
    dueDate:  _nextBusinessDay(rawDate),
    category,
  })

  /** Shorthand: new Date(year, month-1, day) */
  const d = (month, day, y) => new Date(y ?? yr, month - 1, day)

  /**
   * Annual ITR due date for the given covered year.
   *
   * NIRC Sec. 77(B) / Sec. 51: due on or before the 15th day of the
   * fourth month following the close of the taxable year. Calendar-
   * year filers ⇒ 15 April; fiscal-year filers ⇒ 4 months and 15 days
   * after fiscal year-end.
   *
   * RMC 30-2026 (EO 110, s. 2026) extended *calendar-year* CY 2025
   * filers from 15 Apr 2026 to 15 May 2026 — fiscal-year corps are
   * not affected.
   */
  const annualItrDueDate = (coveredYear) => {
    const isCalendarFiler = fiscal_year_start === 1
    if (isCalendarFiler && coveredYear === 2025) return new Date(2026, 4, 15) // RMC 30-2026
    if (isCalendarFiler) return new Date(coveredYear + 1, 3, 15)              // default: 15 April

    // Fiscal-year close: month index = (fiscal_year_start - 2) mod 12,
    // landing in (coveredYear + 1) when fiscal_year_start > 1.
    const fyEndMonthIdx = (fiscal_year_start - 2 + 12) % 12
    const fyEndYear     = coveredYear + 1
    // Statutory deadline = end-of-fy-month + 4 months + 15 days,
    // expressed as the 15th of the (fy-end-month + 4) month.
    const dueMonthZero  = fyEndMonthIdx + 4
    return new Date(fyEndYear + Math.floor(dueMonthZero / 12),
                    dueMonthZero % 12, 15)
  }

  /**
   * eAFS submission deadline (annual ITR + 15 calendar days), per
   * RMC 76-2020 and prior issuances. Generated as a separate
   * obligation so the practitioner has a real deadline to track
   * after the ITR itself is filed.
   */
  const eafsDueDate = (coveredYear) => {
    const itr = annualItrDueDate(coveredYear)
    const eafs = new Date(itr); eafs.setDate(eafs.getDate() + 15)
    return eafs
  }

  /** Add months to a (month, day) pair with year roll-over. */
  const addMonths = (month, day, addM, baseY = yr) => {
    const abs = (month - 1) + addM
    const y   = baseY + Math.floor(abs / 12)
    const m   = (abs % 12 + 12) % 12
    return new Date(y, m, day)
  }

  /** End-of-quarter { y, m } for the Nth quarter, honoring fiscal_year_start. */
  const quarterEndMonth = (qIdx) => {
    const absZero = (fiscal_year_start - 1) + qIdx * 3 - 1
    const y = yr + Math.floor(absZero / 12)
    const m = (absZero % 12 + 12) % 12 + 1
    return { y, m }
  }

  // ── Taxpayer typology ────────────────────────────────────────
  // NIRC distinguishes "individuals" (natural persons, plus estates &
  // trusts taxed via fiduciary under Sec. 60) from "corporations" — the
  // latter defined in Sec. 22(B) to include partnerships (no matter how
  // created), joint-stock companies, joint accounts, associations, and
  // insurance companies, EXCEPT general professional partnerships (GPPs)
  // and joint ventures formed for construction or energy operations.
  // GPPs and qualifying tax-exempt cooperatives are non-individuals but
  // file information returns (1702-EX) rather than paying corporate tax.
  const isEmployee    = taxpayer_type === 'Employee'
  const isSelfEmp     = taxpayer_type === 'Self-Employed'
  const isMixed       = taxpayer_type === 'Mixed Income'
  const isFiduciary   = taxpayer_type === 'Estate' || taxpayer_type === 'Trust'
  const isCorporation = taxpayer_type === 'Corporation'
                        || taxpayer_type === 'One Person Corporation'
                        || taxpayer_type === 'General Partnership'
  const isGPP         = taxpayer_type === 'General Professional Partnership'
  const isCoop        = taxpayer_type === 'Cooperative'
  const isIndividual  = isEmployee || isSelfEmp || isMixed || isFiduciary
  const isSEOrMixed   = isSelfEmp || isMixed
  // Fiduciaries (Estate/Trust) only have business filings if they're
  // actually engaged in trade or business. Pure passive estates/trusts
  // file only the annual 1701.
  const fiduciaryHasBusiness = isFiduciary && has_business_income
  // "Business" here means anyone with a trade/business or practice of
  // profession — i.e. anyone other than a pure-compensation employee
  // or a passive (non-business) fiduciary.
  const isBusiness    = !isEmployee && !(isFiduciary && !has_business_income)
  const isVAT         = vat_status === 'VAT-Registered'

  // NOTE: BIR Form 0605 (Annual Registration Fee) is intentionally NOT
  // generated. The ₱500 ARF was abolished by RA 11976 (EOPT) Sec. 21 and
  // RR 7-2024, effective 22 January 2024.

  // ── VAT-registered: 2550Q quarterly ───────────────────────────
  // NIRC Sec. 114 as amended by EOPT: quarterly only, due the 25th day
  // following the close of each taxable quarter. BIR Form 2550M is abolished
  // (RA 11976, RR 3-2024).
  if (isVAT) {
    for (let q = 1; q <= 4; q++) {
      const { y: qy, m: qm } = quarterEndMonth(q)
      const due = addMonths(qm, 25, 1, qy)
      obs.push(ob(`2550Q-q${q}`, 'BIR Form 2550Q',
        'Quarterly VAT Return (+ SLSP)', `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr} Q${q}`,
        due, 'vat'))
    }
  }

  // ── Non-VAT business: 2551Q quarterly percentage tax ──────────
  // NIRC Sec. 116 (3% of gross quarterly sales/receipts) applies to any
  // person — individual or non-individual — whose receipts are exempt
  // from VAT under Sec. 109(BB) and who is not VAT-registered. Two
  // exclusions in the current rules:
  //   (a) Individuals who opted for the 8% income tax rate under
  //       Sec. 24(A)(2)(b) as amended by RA 10963 (TRAIN). The 8% rate
  //       substitutes both the graduated income tax and percentage tax.
  //       Only individuals (SE / professional / Mixed Income on the
  //       business side) may elect 8% — corporations, partnerships,
  //       cooperatives, estates, and trusts cannot.
  //   (b) GPPs (Sec. 26) and tax-exempt cooperatives don't pay income
  //       or business tax at the entity level, so 2551Q does not apply.
  // The rate reverted from 1% back to 3% on 1 July 2023 (per CREATE Act
  // sunset; see RMC 69-2023).
  const isEightPercentOption = vat_status === 'Non-VAT (8% Option)'
  if (isBusiness && !isVAT && !isEightPercentOption && !isGPP && !isCoop) {
    for (let q = 1; q <= 4; q++) {
      const { y: qy, m: qm } = quarterEndMonth(q)
      const due = addMonths(qm, 25, 1, qy)
      obs.push(ob(`2551Q-q${q}`, 'BIR Form 2551Q',
        'Quarterly Percentage Tax', `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr} Q${q}`,
        due, 'tax'))
    }
  }

  // ── Individual business / fiduciary: 1701Q + annual ITR ──────
  // 1701Q is cumulative YTD (NIRC Sec. 74; TRAIN deadlines May 15 /
  // Aug 15 / Nov 15). It applies to anyone with business or professional
  // income filing on the individual ITR — that is, SE, Mixed Income,
  // and fiduciaries of estates/trusts engaged in trade or business.
  // Passive fiduciaries (no business income) skip the quarterly cycle
  // and only file the annual 1701.
  const filesQuarterlyIndIncome = isSEOrMixed || fiduciaryHasBusiness
  const filesAnnualIndIncome    = isSEOrMixed || isFiduciary
  if (filesQuarterlyIndIncome) {
    obs.push(ob('1701Q-q1', 'BIR Form 1701Q',
      'Quarterly ITR (Q1 cumulative)', `${yr} Q1 (covers Jan–Mar)`,
      d(5, 15), 'income'))
    obs.push(ob('1701Q-q2', 'BIR Form 1701Q',
      'Quarterly ITR (Q2 cumulative YTD)', `${yr} Q2 (covers Apr–Jun)`,
      d(8, 15), 'income'))
    obs.push(ob('1701Q-q3', 'BIR Form 1701Q',
      'Quarterly ITR (Q3 cumulative YTD)', `${yr} Q3 (covers Jul–Sep)`,
      d(11, 15), 'income'))
  }
  if (filesAnnualIndIncome) {

    // Annual ITR form selection per RMC 17-2019 / current BIR guidance:
    //   • 1701A — pure SE/professional whose ONLY income is from
    //     business/profession AND who uses the 8% rate or OSD.
    //   • 1701  — Mixed Income earners (compensation + business), or
    //     SE/professional using Itemized Deduction, or estates/trusts
    //     (1701A is for natural persons only).
    // For micro/small individuals (RR 8-2024 EOPT classification),
    // RMC 34-2025 introduced 1701-MS as an OPTIONAL alternative form —
    // 1701/1701A remain valid (and 1701-MS is not yet on eFPS, per
    // RMC 49-2025), so we keep the primary form and just append the
    // 1701-MS alias to flag it for the practitioner.
    const usesShortForm =
      isSelfEmp && (isEightPercentOption || deduction_method === 'OSD')
    let annualForm = usesShortForm ? 'BIR Form 1701A' : 'BIR Form 1701'
    if (!isFiduciary
        && (tax_classification === 'Micro' || tax_classification === 'Small')) {
      annualForm += ' (or 1701-MS)'
    }
    obs.push(ob('1701', annualForm,
      'Annual ITR', `CY ${yr}`,
      annualItrDueDate(yr), 'income'))
  }

  // ── Corporation / partnership: 1702Q + annual corporate ITR ──
  // NIRC Sec. 22(B): "corporation" includes general partnerships, joint
  // stock companies, and associations. NIRC Sec. 75: 1702Q within 60
  // days after each of the first three quarter-ends.
  if (isCorporation) {
    for (let q = 1; q <= 3; q++) {
      const { y: qy, m: qm } = quarterEndMonth(q)
      // NIRC Sec. 75: due "within sixty (60) days following the close
      // of each of the first three (3) quarters". Compute the actual
      // 60-day offset from the quarter-end rather than approximating
      // it as "the 29th of the second month" — that approximation
      // produces May 29 for calendar-year Q1, which is one day early
      // (Mar 31 + 60 days = May 30).
      const qEnd = new Date(qy, qm, 0)            // last day of quarter month
      const due  = new Date(qEnd)
      due.setDate(due.getDate() + 60)
      obs.push(ob(`1702Q-q${q}`, 'BIR Form 1702Q',
        `Quarterly Corporate ITR Q${q}`, `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr} Q${q}`,
        due, 'income'))
    }
    obs.push(ob('1702', 'BIR Form 1702',
      'Annual Corporate ITR — RT (regular) / MX (mixed) / EX (information)', `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr}`,
      annualItrDueDate(yr), 'income'))
  }

  // ── GPP: information return only (1702-EX) ───────────────────
  // Sec. 26: a general professional partnership is not subject to
  // income tax as such; it files 1702-EX as an information return.
  // Each partner reports their distributive share on their own 1701.
  if (isGPP) {
    obs.push(ob('1702EX', 'BIR Form 1702-EX',
      'Annual Information Return (GPP — partners taxed individually)',
      `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr}`, annualItrDueDate(yr), 'income'))
  }

  // ── Cooperative: information return (1702-EX) ────────────────
  // CDA-registered cooperatives transacting only with members are
  // generally exempt under RA 9520 / NIRC Sec. 30 and file 1702-EX as
  // an information return. (Coops with non-member transactions above
  // the threshold should be reclassified as 'Corporation' to pick up
  // 1702Q + 1702-RT instead.)
  if (isCoop) {
    obs.push(ob('1702EX', 'BIR Form 1702-EX',
      'Annual Information Return (Cooperative)', `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr}`,
      annualItrDueDate(yr), 'income'))
  }

  // ── eAFS attachment (RMC 76-2020 et seq.) ────────────────────
  // The audited Financial Statements + supporting attachments must be
  // submitted via eafs.bir.gov.ph within 15 calendar days after the
  // statutory deadline of the income tax return. Tracked as its own
  // obligation so practitioners who file the ITR on the deadline still
  // see the AFS submission as a separate countdown.
  if (requires_audited_fs && (isCorporation || filesAnnualIndIncome || isGPP || isCoop)) {
    obs.push(ob('eAFS', 'eAFS Submission',
      'AFS + supporting attachments (eafs.bir.gov.ph)',
      `${fiscal_year_start === 1 ? 'CY' : 'FY'} ${yr}`,
      eafsDueDate(yr), 'income'))
  }

  // ── Employee: 1700 annual ────────────────────────────────────
  if (isEmployee) {
    obs.push(ob('1700', 'BIR Form 1700',
      'Annual ITR (Compensation)', `CY ${yr}`,
      annualItrDueDate(yr), 'income'))
  }

  // ── Employer: compensation withholding ───────────────────────
  // 1601-C due on the 10th of the month following the month of withholding.
  // 1604-C + Alphalist + 2316 distribution due 31 January; 2316 BIR-submission 28 February.
  if (has_employees) {
    for (let m = 1; m <= 12; m++) {
      const due = addMonths(m, 10, 1)
      obs.push(ob(`1601C-${_MONTHS[m-1].toLowerCase().slice(0,3)}`, 'BIR Form 1601-C',
        'Monthly Compensation Withholding', `${_MONTHS[m-1]} ${yr}`,
        due, 'withholding'))
    }
    obs.push(ob('1604C', 'BIR Form 1604-C',
      'Annual WT Summary — Compensation (+ Alphalist)', `CY ${yr}`,
      d(1, 31, yr + 1), 'withholding'))
    obs.push(ob('2316-issue', 'BIR Form 2316',
      'Issue 2316 to Employees', `CY ${yr}`,
      d(1, 31, yr + 1), 'withholding'))
    obs.push(ob('2316-submit', 'BIR Form 2316',
      'Submit 2316 Duplicates to BIR', `CY ${yr}`,
      d(2, 28, yr + 1), 'withholding'))
  }

  // ── Withholding agent (EWT) ──────────────────────────────────
  // 0619-E for months 1 & 2 of each quarter (10th of next month);
  // 1601-EQ on the last day of the month after quarter-end (with QAP);
  // 1604-E + Alphalist by 1 March of the following year.
  if (withholds_expanded) {
    for (let q = 1; q <= 4; q++) {
      const { y: qy, m: qm } = quarterEndMonth(q)
      for (let mInQ = 0; mInQ < 2; mInQ++) {
        const coveredMonth = qm - 2 + mInQ
        const covered      = addMonths(coveredMonth, 1, 0, qy)
        const due          = addMonths(coveredMonth, 10, 1, qy)
        obs.push(ob(`0619E-q${q}m${mInQ+1}`, 'BIR Form 0619-E',
          'Monthly EWT Remittance',
          `${_MONTHS[covered.getMonth()]} ${covered.getFullYear()}`,
          due, 'withholding'))
      }
      const nextMonthStart = addMonths(qm, 1, 1, qy)
      const lastDayOfNext  = new Date(nextMonthStart.getFullYear(),
                                      nextMonthStart.getMonth() + 1, 0)
      obs.push(ob(`1601EQ-q${q}`, 'BIR Form 1601-EQ',
        'Quarterly EWT Return (+ QAP)', `${yr} Q${q}`,
        lastDayOfNext, 'withholding'))
    }
    obs.push(ob('1604E', 'BIR Form 1604-E',
      'Annual EWT Summary (+ Alphalist)', `CY ${yr}`,
      d(3, 1, yr + 1), 'withholding'))
  }

  // ── Withholding agent (FWT) ──────────────────────────────────
  if (withholds_final) {
    for (let q = 1; q <= 4; q++) {
      const { y: qy, m: qm } = quarterEndMonth(q)
      for (let mInQ = 0; mInQ < 2; mInQ++) {
        const coveredMonth = qm - 2 + mInQ
        const covered      = addMonths(coveredMonth, 1, 0, qy)
        const due          = addMonths(coveredMonth, 10, 1, qy)
        obs.push(ob(`0619F-q${q}m${mInQ+1}`, 'BIR Form 0619-F',
          'Monthly Final WT Remittance',
          `${_MONTHS[covered.getMonth()]} ${covered.getFullYear()}`,
          due, 'withholding'))
      }
      const nextMonthStart = addMonths(qm, 1, 1, qy)
      const lastDayOfNext  = new Date(nextMonthStart.getFullYear(),
                                      nextMonthStart.getMonth() + 1, 0)
      obs.push(ob(`1601FQ-q${q}`, 'BIR Form 1601-FQ',
        'Quarterly Final WT Return', `${yr} Q${q}`,
        lastDayOfNext, 'withholding'))
    }
    obs.push(ob('1604F', 'BIR Form 1604-F',
      'Annual Final WT Summary (+ Alphalist)', `CY ${yr}`,
      d(1, 31, yr + 1), 'withholding'))
  }

  // ── Employer: government mandatory contributions ──────────────
  // SSS (RA 11199, eff. Jan 2025): 15% of MSC (ER 10% + EE 5%).
  //   Deadline: last business day of the month following the applicable month
  //   (staggered by last digit of employer SSS number; tracked here at latest
  //   possible deadline — verify your specific schedule with SSS).
  // PhilHealth (RA 11223, 2025 rate): 5% of basic salary (ER 2.5% + EE 2.5%).
  //   Floor ₱10,000 / Ceiling ₱100,000.
  //   Deadline: last day of the month following the applicable month.
  // Pag-IBIG / HDMF (RA 9679): 2% each (ER + member) for compensation > ₱1,500.
  //   Contribution ceiling ₱10,000/month → max ₱200 each side (HDMF Circular 460, eff. Feb 2024).
  //   Deadline: 10th of the month following the applicable month.
  if (has_employees) {
    for (let m = 1; m <= 12; m++) {
      const mnth = _MONTHS[m - 1]
      const mAbb = mnth.toLowerCase().slice(0, 3)
      // SSS & PhilHealth: last day of the following month
      const nx           = addMonths(m, 1, 1)
      const followingEnd = new Date(nx.getFullYear(), nx.getMonth() + 1, 0)
      obs.push(ob(`SSS-emp-${mAbb}`, 'SSS Employer Remittance',
        'Monthly SSS Contribution Remittance', `${mnth} ${yr}`,
        followingEnd, 'government'))
      obs.push(ob(`PHIC-emp-${mAbb}`, 'PhilHealth Employer Remittance',
        'Monthly PhilHealth Premium Remittance', `${mnth} ${yr}`,
        followingEnd, 'government'))
      // Pag-IBIG: 10th of the following month (same cadence as BIR 1601-C)
      obs.push(ob(`HDMF-emp-${mAbb}`, 'Pag-IBIG Employer Remittance',
        'Monthly Pag-IBIG Contribution Remittance', `${mnth} ${yr}`,
        addMonths(m, 10, 1), 'government'))
    }
  }

  // ── Owner/operator: voluntary government contributions ────────
  // Self-employed individuals and sole operators not covered by an
  // employer may voluntarily contribute to SSS, PhilHealth, and/or
  // Pag-IBIG. Cadences and deadlines per current circulars:
  //
  //   • SSS voluntary (SSS Circular 2019-009): self-employed/voluntary
  //     members may pay for the applicable month or quarter on or
  //     before the LAST DAY OF THE MONTH FOLLOWING the applicable
  //     month/quarter. Tracked monthly here at the conservative end of
  //     the staggered window.
  //   • PhilHealth voluntary (PhilHealth Circular 2020-0014):
  //     individually-paying members file QUARTERLY, by the last day of
  //     the applicable quarter. Tracked quarterly.
  //   • Pag-IBIG voluntary (HDMF Circular 274 / 460): self-paying
  //     members remit monthly by the last day of the applicable month.
  if (owner_pays_sss) {
    for (let m = 1; m <= 12; m++) {
      const mnth = _MONTHS[m - 1]
      const mAbb = mnth.toLowerCase().slice(0, 3)
      // Last day of (m + 1) — i.e. last day of the next month
      const volDue = new Date(yr, m + 1, 0)
      obs.push(ob(`SSS-vol-${mAbb}`, 'SSS Voluntary Contribution',
        'Monthly SSS Voluntary Contribution', `${mnth} ${yr}`,
        volDue, 'government'))
    }
  }
  if (owner_pays_philhealth) {
    for (let q = 1; q <= 4; q++) {
      const { y: qy, m: qm } = quarterEndMonth(q)
      // Last day of the applicable quarter (= last day of qm)
      const volDue = new Date(qy, qm, 0)
      obs.push(ob(`PHIC-vol-q${q}`, 'PhilHealth Voluntary Premium',
        'Quarterly PhilHealth Voluntary Premium', `${yr} Q${q}`,
        volDue, 'government'))
    }
  }
  if (owner_pays_pagibig) {
    for (let m = 1; m <= 12; m++) {
      const mnth   = _MONTHS[m - 1]
      const mAbb   = mnth.toLowerCase().slice(0, 3)
      const volDue = new Date(yr, m, 0)  // last day of the applicable month
      obs.push(ob(`HDMF-vol-${mAbb}`, 'Pag-IBIG Voluntary Contribution',
        'Monthly Pag-IBIG Voluntary Contribution', `${mnth} ${yr}`,
        volDue, 'government'))
    }
  }

  return obs
}

export {
  _MONTHS,
  _iso,
  _PH_HOLIDAYS,
  _nextBusinessDay,
  generateObligations,
}
