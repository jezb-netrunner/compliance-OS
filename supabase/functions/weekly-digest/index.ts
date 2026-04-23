// supabase/functions/weekly-digest/index.ts
//
// Weekly compliance digest. Triggered via Supabase cron (pg_cron):
//   schedule:  0 0 * * 1          (Monday 00:00 UTC = 08:00 PHT)
//
// Required secrets (set with `supabase secrets set …`):
//   RESEND_API_KEY  — Resend API key (required)
//   APP_URL         — absolute URL to the app, used in the email body
//   DIGEST_FROM     — verified Resend From: address
//
// Auto-injected by the Edge runtime:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// One-time DB migration:
//   alter table practitioners
//     add column if not exists email_reminders boolean not null default true;

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')!
const APP_URL      = Deno.env.get('APP_URL')     ?? 'https://app.present-value.ph'
const FROM_ADDR    = Deno.env.get('DIGEST_FROM') ?? 'The Present Value <digest@present-value.ph>'

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const iso     = (d: Date) => d.toISOString().slice(0, 10)
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

async function sendEmail(to: string, subject: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDR, to, subject, text }),
  })
  if (!res.ok) console.error('resend:', res.status, await res.text())
  return res.ok
}

Deno.serve(async () => {
  const today    = new Date(); today.setUTCHours(0, 0, 0, 0)
  const todayStr = iso(today)
  const in7Str   = iso(new Date(today.getTime() + 7 * 86_400_000))

  const { data: practitioners, error: pErr } = await supa
    .from('practitioners')
    .select('id, email, email_reminders')
    .eq('email_reminders', true)

  if (pErr) {
    console.error('practitioners:', pErr)
    return new Response(pErr.message, { status: 500 })
  }

  let sent = 0
  for (const p of practitioners ?? []) {
    if (!p.email) continue

    const { data: clients } = await supa
      .from('clients')
      .select('id, display_name')
      .eq('practitioner_id', p.id)
      .eq('is_active', true)

    const clientIds = (clients ?? []).map(c => c.id)
    if (!clientIds.length) continue
    const nameOf: Record<string, string> = {}
    for (const c of clients ?? []) nameOf[c.id] = c.display_name

    const [{ data: dueRows }, { data: overdueRows }] = await Promise.all([
      supa.from('compliance_records')
        .select('client_id, form, due_date')
        .in('client_id', clientIds)
        .is('filed_date', null)
        .gte('due_date', todayStr)
        .lte('due_date', in7Str)
        .order('due_date'),
      supa.from('compliance_records')
        .select('client_id, form, due_date')
        .in('client_id', clientIds)
        .is('filed_date', null)
        .lt('due_date', todayStr)
        .order('due_date'),
    ])

    const due     = dueRows     ?? []
    const overdue = overdueRows ?? []
    if (!due.length && !overdue.length) continue

    const dueLines = due.map(r =>
      `· ${nameOf[r.client_id] ?? '—'} — ${r.form ?? '—'} — Due ${fmtDate(r.due_date)}`
    ).join('\n')

    const overdueLines = overdue.map(r => {
      const days = Math.max(0, Math.floor((today.getTime() - new Date(r.due_date).getTime()) / 86_400_000))
      return `· ${nameOf[r.client_id] ?? '—'} — ${r.form ?? '—'} — ${days} days late`
    }).join('\n')

    const sections: string[] = []
    if (due.length)     sections.push(`DUE THIS WEEK (${due.length}):\n${dueLines}`)
    if (overdue.length) sections.push(`OVERDUE (${overdue.length}):\n${overdueLines}`)
    sections.push(`Log in to update filing status: ${APP_URL}`)

    const subject = `Your compliance digest — ${due.length} deadlines this week`
    const ok = await sendEmail(p.email, subject, sections.join('\n\n'))
    if (ok) sent++
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { 'content-type': 'application/json' },
  })
})
