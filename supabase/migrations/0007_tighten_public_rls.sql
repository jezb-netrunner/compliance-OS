-- 0007_tighten_public_rls.sql
--
-- 0001 declared three "public" RLS policies that are wide-open:
--
--   • "enrollment_tokens: public read by token"  (using true)
--   • "clients: public enrollment insert"         (with check true)
--   • "enrollment_tokens: public mark used"       (using true / check true)
--
-- Net effect: any anonymous caller could enumerate every pending token,
-- inject a client under any practitioner's account, or arbitrarily
-- update token rows. The public enrollment flow now goes through the
-- claim-enrollment-token Edge Function, which uses the service role to
-- atomically validate the token, insert the client, seed the calendar,
-- and mark the token used. The RLS layer drops the open policies.

drop policy if exists "enrollment_tokens: public read by token"  on enrollment_tokens;
drop policy if exists "enrollment_tokens: public mark used"      on enrollment_tokens;
drop policy if exists "clients: public enrollment insert"        on clients;

-- Rebuild authenticated-side policies (the original ones in 0001 were
-- fine; this is just defense-in-depth in case any of them were dropped
-- by hand).
do $$
begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'enrollment_tokens'
       and policyname = 'enrollment_tokens: own practitioner'
  ) then
    create policy "enrollment_tokens: own practitioner" on enrollment_tokens
      using (practitioner_id = auth_practitioner_id())
      with check (practitioner_id = auth_practitioner_id());
  end if;

  if not exists (
    select 1 from pg_policies
     where tablename = 'clients'
       and policyname = 'clients: own practitioner'
  ) then
    create policy "clients: own practitioner" on clients
      using (practitioner_id = auth_practitioner_id())
      with check (practitioner_id = auth_practitioner_id());
  end if;
end $$;
