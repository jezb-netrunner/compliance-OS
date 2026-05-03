-- 0008_normalize_period_prefix.sql
--
-- generateObligations now writes the period as "CY 2026 Q1" / "FY 2026 Q1"
-- instead of bare "2026 Q1", so practitioners with fiscal-year clients
-- can disambiguate. This migration backfills the prefix on rows that
-- were written under the old format, so the Filings tab and report
-- exports show one consistent shape.
--
-- Idempotent: rows that already carry CY/FY prefixes are skipped.

-- Calendar-year clients
update compliance_records cr
   set period = 'CY ' || cr.period
  from clients c
 where cr.client_id = c.id
   and c.fiscal_start_month = 1
   and cr.period ~ '^[0-9]{4} Q[1-4]'
   and cr.period not like 'CY %'
   and cr.period not like 'FY %';

-- Fiscal-year clients
update compliance_records cr
   set period = 'FY ' || cr.period
  from clients c
 where cr.client_id = c.id
   and c.fiscal_start_month <> 1
   and cr.period ~ '^[0-9]{4} Q[1-4]'
   and cr.period not like 'FY %'
   and cr.period not like 'CY %';

-- Annual ITRs already used "CY ${yr}" in the old code, so the regex
-- above (which requires "Q[1-4]") naturally skips them. Fiscal-year
-- annuals previously written as "CY ${yr}" should be relabelled.
update compliance_records cr
   set period = 'FY ' || substring(cr.period from 4)
  from clients c
 where cr.client_id = c.id
   and c.fiscal_start_month <> 1
   and cr.period like 'CY %'
   and cr.period !~ ' Q[1-4]';
