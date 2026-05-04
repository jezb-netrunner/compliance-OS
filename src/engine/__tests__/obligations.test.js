// Vitest fixtures for the obligation generator. Each test pins one
// taxpayer-type × VAT × deduction × fiscal-year combination so a future
// rule change visibly breaks the right cases.

import { describe, it, expect } from 'vitest'
import {
  _iso,
  _nextBusinessDay,
  _PH_HOLIDAYS,
  generateObligations,
} from '../obligations.js'

const idsOf = (obs) => obs.map((o) => o.id).sort()
// Substring match — use sparingly. For exact id lookups (e.g. the
// annual 1701 vs the 1701Q quarters), prefer findById.
const findOne  = (obs, fragment) => obs.find((o) => o.id.includes(fragment))
const findById = (obs, id)       => obs.find((o) => o.id === id)

describe('_iso', () => {
  it('formats local-midnight without UTC drift', () => {
    expect(_iso(new Date(2026, 0, 15))).toBe('2026-01-15')
    expect(_iso(new Date(2025, 11, 31))).toBe('2025-12-31')
  })
})

describe('_PH_HOLIDAYS', () => {
  it('includes core regular holidays for the in-app years', () => {
    for (const yr of [2024, 2025, 2026]) {
      expect(_PH_HOLIDAYS.has(`${yr}-01-01`)).toBe(true) // New Year
      expect(_PH_HOLIDAYS.has(`${yr}-05-01`)).toBe(true) // Labor Day
      expect(_PH_HOLIDAYS.has(`${yr}-06-12`)).toBe(true) // Independence
      expect(_PH_HOLIDAYS.has(`${yr}-12-25`)).toBe(true) // Christmas
    }
  })
})

describe('_nextBusinessDay', () => {
  it('skips Saturdays', () => {
    // 2026-04-25 is a Saturday — should roll to Mon 2026-04-27
    const result = _nextBusinessDay(new Date(2026, 3, 25))
    expect(_iso(result)).toBe('2026-04-27')
  })

  it('skips Sundays', () => {
    // 2026-04-26 is a Sunday → Mon 2026-04-27
    const result = _nextBusinessDay(new Date(2026, 3, 26))
    expect(_iso(result)).toBe('2026-04-27')
  })

  it('skips the Holy Week stretch (Apr 2 - Apr 4 2026 + weekend)', () => {
    // 2026-04-02 is Maundy Thursday; rolls past Easter weekend to Mon 2026-04-06
    const result = _nextBusinessDay(new Date(2026, 3, 2))
    expect(_iso(result)).toBe('2026-04-06')
  })

  it('returns the input unchanged when already a business day', () => {
    const result = _nextBusinessDay(new Date(2026, 3, 6)) // Mon
    expect(_iso(result)).toBe('2026-04-06')
  })
})

describe('generateObligations — Self-Employed, Non-VAT (Percentage Tax)', () => {
  const profile = {
    taxpayer_type: 'Self-Employed',
    vat_status: 'Non-VAT (Percentage Tax)',
    deduction_method: 'Itemized',
    fiscal_year_start: 1,
  }
  const obs = generateObligations(profile, 2026)

  it('emits 4 quarterly 2551Q + 3 quarterly 1701Q + 1 annual ITR', () => {
    expect(obs).toHaveLength(8)
    expect(idsOf(obs)).toEqual([
      '2026-1701',
      '2026-1701Q-q1',
      '2026-1701Q-q2',
      '2026-1701Q-q3',
      '2026-2551Q-q1',
      '2026-2551Q-q2',
      '2026-2551Q-q3',
      '2026-2551Q-q4',
    ])
  })

  it('routes the annual ITR to 1701 (Itemized SE)', () => {
    const annual = findById(obs, '2026-1701')
    expect(annual.form).toBe('BIR Form 1701')
  })

  it('uses CY (calendar year) period prefix', () => {
    const q1 = findOne(obs, '2551Q-q1')
    expect(q1.period).toMatch(/^CY 2026 Q1/)
  })
})

describe('generateObligations — Self-Employed, OSD', () => {
  const profile = {
    taxpayer_type: 'Self-Employed',
    vat_status: 'Non-VAT (Percentage Tax)',
    deduction_method: 'OSD',
    fiscal_year_start: 1,
  }
  const obs = generateObligations(profile, 2026)

  it('routes the annual ITR to 1701A for SE+OSD', () => {
    const annual = findById(obs, '2026-1701')
    expect(annual.form).toBe('BIR Form 1701A')
  })
})

describe('generateObligations — Self-Employed, 8% option', () => {
  const profile = {
    taxpayer_type: 'Self-Employed',
    vat_status: 'Non-VAT (8% Option)',
    deduction_method: '8%',
    fiscal_year_start: 1,
  }
  const obs = generateObligations(profile, 2026)

  it('removes percentage tax (8% substitutes both income and percentage tax)', () => {
    expect(obs.find((o) => o.id.includes('2551Q'))).toBeUndefined()
  })

  it('routes the annual ITR to 1701A', () => {
    const annual = findById(obs, '2026-1701')
    expect(annual.form).toBe('BIR Form 1701A')
  })
})

describe('generateObligations — Mixed Income, Itemized', () => {
  const profile = {
    taxpayer_type: 'Mixed Income',
    vat_status: 'Non-VAT (Percentage Tax)',
    deduction_method: 'Itemized',
    fiscal_year_start: 1,
  }
  const obs = generateObligations(profile, 2026)

  it('keeps annual ITR on 1701 (Mixed Income always 1701)', () => {
    expect(findById(obs, '2026-1701').form).toBe('BIR Form 1701')
  })
})

describe('generateObligations — VAT-Registered Corporation, calendar year', () => {
  const profile = {
    taxpayer_type: 'Corporation',
    vat_status: 'VAT-Registered',
    deduction_method: 'Itemized',
    fiscal_year_start: 1,
  }
  const obs = generateObligations(profile, 2025)

  it('emits 4 × 2550Q + 3 × 1702Q + 1 annual', () => {
    expect(idsOf(obs)).toEqual([
      '2025-1702',
      '2025-1702Q-q1',
      '2025-1702Q-q2',
      '2025-1702Q-q3',
      '2025-2550Q-q1',
      '2025-2550Q-q2',
      '2025-2550Q-q3',
      '2025-2550Q-q4',
    ])
  })

  it('honours RMC 30-2026 / EO 110 — CY 2025 annual ITR moves to 15 May 2026', () => {
    const annual = findById(obs, '2025-1702')
    expect(_iso(annual.dueDate)).toBe('2026-05-15')
  })
})

describe('generateObligations — fiscal-year corporation', () => {
  // Fiscal year ending June 30 (fiscal_start_month = 7).
  // Annual ITR statutory deadline: Oct 15 of the following year.
  const profile = {
    taxpayer_type: 'Corporation',
    vat_status: 'VAT-Registered',
    deduction_method: 'Itemized',
    fiscal_year_start: 7,
  }
  const obs = generateObligations(profile, 2026)

  it('lands the annual ITR 4 months 15 days after fiscal year-end', () => {
    const annual = findById(obs, '2026-1702')
    // FY 2026 ends 2027-06-30; deadline 2027-10-15 (Friday, business day).
    expect(_iso(annual.dueDate)).toBe('2027-10-15')
  })

  it('does NOT apply the RMC 30-2026 extension to fiscal-year filers', () => {
    const obs2025 = generateObligations(profile, 2025)
    const annual  = findById(obs2025, '2025-1702')
    // FY 2025 ends 2026-06-30; deadline 2026-10-15.
    expect(_iso(annual.dueDate)).toBe('2026-10-15')
  })

  it('uses FY (fiscal year) prefix for periods', () => {
    const q1 = findOne(obs, '2550Q-q1')
    expect(q1.period).toMatch(/^FY 2026 Q1/)
  })
})

describe('generateObligations — eAFS attachment', () => {
  it('emits a separate eAFS obligation when requires_audited_fs is true', () => {
    const obs = generateObligations({
      taxpayer_type: 'Corporation',
      vat_status: 'VAT-Registered',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      requires_audited_fs: true,
    }, 2026)
    const eafs = findOne(obs, '2026-eAFS')
    expect(eafs).toBeDefined()
    expect(eafs.form).toBe('eAFS Submission')
  })

  it('does not emit eAFS when requires_audited_fs is false', () => {
    const obs = generateObligations({
      taxpayer_type: 'Corporation',
      vat_status: 'VAT-Registered',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      requires_audited_fs: false,
    }, 2026)
    expect(obs.find((o) => o.id.includes('eAFS'))).toBeUndefined()
  })
})

describe('generateObligations — Estate / Trust gating on has_business_income', () => {
  it('with business income: emits 1701Q quarters + annual', () => {
    const obs = generateObligations({
      taxpayer_type: 'Estate',
      vat_status: 'Non-VAT (Graduated)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      has_business_income: true,
    }, 2026)
    expect(obs.find((o) => o.id === '2026-1701Q-q1')).toBeDefined()
    expect(obs.find((o) => o.id === '2026-1701')).toBeDefined()
  })

  it('without business income: only the annual 1701 is emitted, no 1701Q / 2551Q', () => {
    const obs = generateObligations({
      taxpayer_type: 'Estate',
      vat_status: 'Non-VAT (Graduated)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      has_business_income: false,
    }, 2026)
    expect(obs.find((o) => o.id.includes('1701Q'))).toBeUndefined()
    expect(obs.find((o) => o.id.includes('2551Q'))).toBeUndefined()
    expect(obs.find((o) => o.id === '2026-1701')).toBeDefined()
  })
})

describe('generateObligations — GPP & Cooperative information returns', () => {
  it('GPP emits 1702-EX only', () => {
    const obs = generateObligations({
      taxpayer_type: 'General Professional Partnership',
      vat_status: 'Non-VAT (Graduated)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
    }, 2026)
    expect(idsOf(obs)).toEqual(['2026-1702EX'])
    expect(findOne(obs, '1702EX').form).toBe('BIR Form 1702-EX')
  })

  it('Cooperative emits 1702-EX only (member-only transactions assumed)', () => {
    const obs = generateObligations({
      taxpayer_type: 'Cooperative',
      vat_status: 'Non-VAT (Graduated)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
    }, 2026)
    expect(idsOf(obs)).toEqual(['2026-1702EX'])
  })
})

describe('generateObligations — Employee', () => {
  it('emits 1700 only', () => {
    const obs = generateObligations({
      taxpayer_type: 'Employee',
      vat_status: 'Non-VAT (Graduated)',
      fiscal_year_start: 1,
    }, 2026)
    expect(idsOf(obs)).toEqual(['2026-1700'])
  })
})

describe('generateObligations — Employer obligations (has_employees)', () => {
  const obs = generateObligations({
    taxpayer_type: 'Self-Employed',
    vat_status: 'Non-VAT (Percentage Tax)',
    deduction_method: 'Itemized',
    fiscal_year_start: 1,
    has_employees: true,
  }, 2026)

  it('emits 12 monthly 1601-C', () => {
    const monthly = obs.filter((o) => o.id.startsWith('2026-1601C-'))
    expect(monthly).toHaveLength(12)
  })

  it('emits annual 1604-C, 2316 issuance, and 2316 BIR submission', () => {
    expect(findOne(obs, '1604C')).toBeDefined()
    expect(findOne(obs, '2316-issue')).toBeDefined()
    expect(findOne(obs, '2316-submit')).toBeDefined()
  })

  it('emits 12 SSS / PhilHealth / Pag-IBIG remittances', () => {
    expect(obs.filter((o) => o.id.startsWith('2026-SSS-emp-'))).toHaveLength(12)
    expect(obs.filter((o) => o.id.startsWith('2026-PHIC-emp-'))).toHaveLength(12)
    expect(obs.filter((o) => o.id.startsWith('2026-HDMF-emp-'))).toHaveLength(12)
  })
})

describe('generateObligations — Withholding agent', () => {
  it('EWT: 8 monthly 0619-E + 4 quarterly 1601-EQ + annual 1604-E', () => {
    const obs = generateObligations({
      taxpayer_type: 'Self-Employed',
      vat_status: 'Non-VAT (Percentage Tax)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      withholds_expanded: true,
    }, 2026)
    expect(obs.filter((o) => o.id.startsWith('2026-0619E-'))).toHaveLength(8)
    expect(obs.filter((o) => o.id.startsWith('2026-1601EQ-'))).toHaveLength(4)
    expect(findOne(obs, '1604E')).toBeDefined()
  })

  it('FWT: 8 monthly 0619-F + 4 quarterly 1601-FQ + annual 1604-F', () => {
    const obs = generateObligations({
      taxpayer_type: 'Corporation',
      vat_status: 'VAT-Registered',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      withholds_final: true,
    }, 2026)
    expect(obs.filter((o) => o.id.startsWith('2026-0619F-'))).toHaveLength(8)
    expect(obs.filter((o) => o.id.startsWith('2026-1601FQ-'))).toHaveLength(4)
    expect(findOne(obs, '1604F')).toBeDefined()
  })
})

describe('generateObligations — Voluntary contributions', () => {
  it('SSS voluntary: 12 monthly entries due last day of NEXT month', () => {
    const obs = generateObligations({
      taxpayer_type: 'Self-Employed',
      vat_status: 'Non-VAT (Percentage Tax)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      owner_pays_sss: true,
    }, 2026)
    const sssVol = obs.filter((o) => o.id.startsWith('2026-SSS-vol-'))
    expect(sssVol).toHaveLength(12)
    // January's contribution falls due last day of February. 2026-02-28
    // is a Saturday, so the business-day rollover lands on 2026-03-02.
    const jan = obs.find((o) => o.id === '2026-SSS-vol-jan')
    expect(_iso(jan.dueDate)).toBe('2026-03-02')
  })

  it('PhilHealth voluntary: quarterly, due last day of the quarter', () => {
    const obs = generateObligations({
      taxpayer_type: 'Self-Employed',
      vat_status: 'Non-VAT (Percentage Tax)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      owner_pays_philhealth: true,
    }, 2026)
    const phicVol = obs.filter((o) => o.id.startsWith('2026-PHIC-vol-'))
    expect(phicVol).toHaveLength(4)
    // Q1 ends 2026-03-31; due_date should be in March 2026
    const q1 = obs.find((o) => o.id === '2026-PHIC-vol-q1')
    expect(_iso(q1.dueDate).slice(0, 7)).toBe('2026-03')
  })

  it('Pag-IBIG voluntary: 12 monthly entries due last day of applicable month', () => {
    const obs = generateObligations({
      taxpayer_type: 'Self-Employed',
      vat_status: 'Non-VAT (Percentage Tax)',
      deduction_method: 'Itemized',
      fiscal_year_start: 1,
      owner_pays_pagibig: true,
    }, 2026)
    expect(obs.filter((o) => o.id.startsWith('2026-HDMF-vol-'))).toHaveLength(12)
  })
})

describe('generateObligations — EOPT classification suffix on annual ITR', () => {
  it('Micro/Small individual: appends 1701-MS optional alternative', () => {
    const obs = generateObligations({
      taxpayer_type: 'Self-Employed',
      vat_status: 'Non-VAT (Percentage Tax)',
      deduction_method: 'Itemized',
      tax_classification: 'Micro',
      fiscal_year_start: 1,
    }, 2026)
    expect(findById(obs, '2026-1701').form).toContain('1701-MS')
  })

  it('Medium / Large: no 1701-MS suffix', () => {
    const obs = generateObligations({
      taxpayer_type: 'Self-Employed',
      vat_status: 'Non-VAT (Percentage Tax)',
      deduction_method: 'Itemized',
      tax_classification: 'Medium',
      fiscal_year_start: 1,
    }, 2026)
    expect(findById(obs, '2026-1701').form).not.toContain('1701-MS')
  })
})
