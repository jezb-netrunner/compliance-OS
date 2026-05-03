// supabase/functions/claim-enrollment-token/index.ts
//
// Public Edge Function that backs enroll.html. Replaces the open
// "clients: public enrollment insert" RLS policy that 0007 drops.
//
// Flow:
//   1. Caller POSTs { token, profile } to /claim-enrollment-token.
//   2. We validate the token (must exist, not used, not expired) using
//      the service role.
//   3. We insert a clients row with needs_review=true (the practitioner
//      reviews before obligations are seeded).
//   4. We mark the token used.
//
// All three steps happen with the service role; no public RLS is
// required on clients or enrollment_tokens.
//
// Deploy:
//   supabase functions deploy claim-enrollment-token --no-verify-jwt
//
// Required secrets (auto-provided by the Edge runtime):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

const VALID_TAXPAYER_TYPES = new Set([
  'Self-Employed', 'Mixed Income', 'Employee', 'Estate', 'Trust',
  'Corporation', 'One Person Corporation', 'General Partnership',
  'General Professional Partnership', 'Cooperative',
])
const VALID_VAT_STATUSES = new Set([
  'VAT-Registered', 'Non-VAT (8% Option)',
  'Non-VAT (Percentage Tax)', 'Non-VAT (Graduated)',
])
const VALID_DEDUCTIONS = new Set(['Itemized', 'OSD', '8%'])
const VALID_CLASSIFICATIONS = new Set(['Micro', 'Small', 'Medium', 'Large'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return jsonResponse({ error: 'method_not_allowed' }, 405)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const token   = String(payload.token   ?? '').trim()
  const mode    = String(payload.mode    ?? 'claim')
  const profile = (payload.profile ?? {}) as Record<string, unknown>

  if (!token) return jsonResponse({ error: 'missing_token' }, 400)

  // Token validation pre-flight (used by enroll.html on page load to
  // decide whether to render the form or the "expired/used" message).
  if (mode === 'validate') {
    const { data: t, error } = await supa
      .from('enrollment_tokens')
      .select('used, expires_at, client_name_hint')
      .eq('token', token)
      .maybeSingle()
    if (error)  return jsonResponse({ error: 'lookup_failed' }, 500)
    if (!t)     return jsonResponse({ error: 'invalid_token' }, 404)
    if (t.used) return jsonResponse({ error: 'token_already_used' }, 409)
    if (new Date(t.expires_at) <= new Date()) {
      return jsonResponse({ error: 'token_expired' }, 410)
    }
    return jsonResponse({ ok: true, client_name_hint: t.client_name_hint ?? null })
  }

  const displayName = String(profile.display_name ?? '').trim()
  if (!displayName) return jsonResponse({ error: 'missing_display_name' }, 400)

  // Validate enums (silently coerce invalid to null for optional fields,
  // reject only the truly required ones).
  const taxpayerType = String(profile.taxpayer_type ?? '')
  if (!VALID_TAXPAYER_TYPES.has(taxpayerType)) {
    return jsonResponse({ error: 'invalid_taxpayer_type' }, 400)
  }

  const vatStatus = String(profile.vat_status ?? '')
  if (!VALID_VAT_STATUSES.has(vatStatus)) {
    return jsonResponse({ error: 'invalid_vat_status' }, 400)
  }

  const deduction = profile.deduction_method
    ? (VALID_DEDUCTIONS.has(String(profile.deduction_method)) ? String(profile.deduction_method) : null)
    : null
  const classification = profile.tax_classification
    ? (VALID_CLASSIFICATIONS.has(String(profile.tax_classification)) ? String(profile.tax_classification) : null)
    : null

  const fiscalStartMonth = Number(profile.fiscal_start_month) || 1
  if (fiscalStartMonth < 1 || fiscalStartMonth > 12) {
    return jsonResponse({ error: 'invalid_fiscal_start_month' }, 400)
  }

  // 1. Validate token using service role
  const { data: tokenRow, error: tokenErr } = await supa
    .from('enrollment_tokens')
    .select('id, practitioner_id, used, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (tokenErr) return jsonResponse({ error: 'lookup_failed' }, 500)
  if (!tokenRow) return jsonResponse({ error: 'invalid_token' }, 404)
  if (tokenRow.used) return jsonResponse({ error: 'token_already_used' }, 409)
  if (new Date(tokenRow.expires_at) <= new Date()) {
    return jsonResponse({ error: 'token_expired' }, 410)
  }

  // 2. Insert client (needs_review = true; practitioner seeds obligations)
  const clientRow = {
    practitioner_id:       tokenRow.practitioner_id,
    display_name:          displayName,
    tin:                   String(profile.tin ?? '').trim() || null,
    rdo_code:              String(profile.rdo_code ?? '').trim() || null,
    industry:              String(profile.industry ?? '').trim() || null,
    taxpayer_type:         taxpayerType,
    vat_status:            vatStatus,
    tax_classification:    classification,
    deduction_method:      deduction,
    fiscal_start_month:    fiscalStartMonth,
    has_employees:         !!profile.has_employees,
    withholds_expanded:    !!profile.withholds_expanded,
    withholds_final:       !!profile.withholds_final,
    owner_pays_sss:        !!profile.owner_pays_sss,
    owner_pays_philhealth: !!profile.owner_pays_philhealth,
    owner_pays_pagibig:    !!profile.owner_pays_pagibig,
    requires_audited_fs:   !!profile.requires_audited_fs,
    has_related_party_txn: !!profile.has_related_party_txn,
    needs_review:          true,
    is_active:             true,
  }

  const { error: insErr } = await supa.from('clients').insert(clientRow)
  if (insErr) {
    console.error('claim-enrollment-token insert:', insErr)
    return jsonResponse({ error: 'insert_failed' }, 500)
  }

  // 3. Mark token used
  const { error: updErr } = await supa
    .from('enrollment_tokens')
    .update({ used: true })
    .eq('id', tokenRow.id)
  if (updErr) {
    // Soft-fail: client was created; practitioner will see it. Log and continue.
    console.warn('claim-enrollment-token mark-used:', updErr)
  }

  return jsonResponse({ ok: true })
})
