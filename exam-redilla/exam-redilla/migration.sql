-- Scholarship Monitoring and Academic Compliance System
-- Run this file once in Supabase SQL Editor (new/empty project).
-- Fixes included: approval guard handles NULL compliance, and submitted_at is set by the server.

begin;
create extension if not exists pgcrypto;

-- 1. Core tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('scholar','staff')),
  student_id text unique,
  full_name text not null,
  created_at timestamptz not null default now(),
  constraint scholar_profile_requires_student_id check (role <> 'scholar' or student_id is not null)
);

create table if not exists public.scholarship_programs (
  id text primary key,
  name text not null,
  max_gwa numeric(4,2) not null check (max_gwa between 1.00 and 5.00),
  min_units integer not null check (min_units >= 0),
  failed_allowed integer not null default 0 check (failed_allowed >= 0),
  incomplete_allowed integer not null default 0 check (incomplete_allowed >= 0),
  dropped_allowed integer not null default 0 check (dropped_allowed >= 0),
  submission_deadline timestamptz not null default '2026-11-06 17:00:00+08'
);

create table if not exists public.scholar_assignments (
  scholar_id text primary key,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  program_id text not null references public.scholarship_programs(id),
  full_name text not null,
  assigned_at timestamptz not null default now()
);

create table if not exists public.semester_submissions (
  id uuid primary key default gen_random_uuid(),
  scholar_id text not null references public.scholar_assignments(scholar_id) on delete restrict,
  academic_year text not null,
  semester text not null check (semester in ('1','2','Summer')),
  gwa numeric(4,2) not null check (gwa between 1.00 and 5.00),
  enrolled_units integer not null check (enrolled_units >= 0),
  failed_count integer not null check (failed_count >= 0),
  incomplete_count integer not null check (incomplete_count >= 0),
  dropped_count integer not null check (dropped_count >= 0),
  evidence_reference text not null check (length(trim(evidence_reference)) > 0),
  submitted_at timestamptz not null default now(),
  verification_status text not null default 'Pending' check (verification_status in ('Pending','Verified','Returned')),
  verification_reason text,
  compliance_result text check (compliance_result in ('Compliant','With Deficiency')),
  deficiency_reasons text[] not null default '{}',
  renewal_decision text not null default 'Held' check (renewal_decision in ('Approved','Held')),
  renewal_note text,
  unique (scholar_id, academic_year, semester)
);

create table if not exists public.decision_history (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.semester_submissions(id) on delete cascade,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_submissions_semester on public.semester_submissions(academic_year, semester);
create index if not exists idx_submissions_status on public.semester_submissions(verification_status, compliance_result);
create index if not exists idx_history_submission on public.decision_history(submission_id, created_at desc);

-- 2. Helper functions (avoid recursive RLS checks)
create or replace function public.current_user_is_staff()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff'); $$;

create or replace function public.current_user_is_assigned_to(target_scholar_id text)
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.scholar_assignments a where a.scholar_id = target_scholar_id and a.profile_id = auth.uid()); $$;

revoke all on function public.current_user_is_staff() from public;
revoke all on function public.current_user_is_assigned_to(text) from public;
grant execute on function public.current_user_is_staff() to authenticated;
grant execute on function public.current_user_is_assigned_to(text) to authenticated;

-- 3. Row Level Security
alter table public.profiles enable row level security;
alter table public.scholarship_programs enable row level security;
alter table public.scholar_assignments enable row level security;
alter table public.semester_submissions enable row level security;
alter table public.decision_history enable row level security;

drop policy if exists "profiles_select_self_or_staff" on public.profiles;
drop policy if exists "profiles_insert_staff_only" on public.profiles;
drop policy if exists "profiles_update_staff_only" on public.profiles;
drop policy if exists "programs_read_authenticated" on public.scholarship_programs;
drop policy if exists "assignments_staff_all" on public.scholar_assignments;
drop policy if exists "assignments_scholar_read_own" on public.scholar_assignments;
drop policy if exists "submissions_staff_read" on public.semester_submissions;
drop policy if exists "submissions_scholar_read_own" on public.semester_submissions;
drop policy if exists "submissions_scholar_insert_own_pending" on public.semester_submissions;
drop policy if exists "submissions_staff_update" on public.semester_submissions;
drop policy if exists "submissions_scholar_correct_returned" on public.semester_submissions;
drop policy if exists "history_staff_read" on public.decision_history;
drop policy if exists "history_scholar_read_own" on public.decision_history;

create policy "profiles_select_self_or_staff" on public.profiles
for select to authenticated using (id = auth.uid() or public.current_user_is_staff());
create policy "profiles_insert_staff_only" on public.profiles
for insert to authenticated with check (public.current_user_is_staff() and role = 'scholar');
create policy "profiles_update_staff_only" on public.profiles
for update to authenticated using (public.current_user_is_staff()) with check (public.current_user_is_staff() and role = 'scholar');

create policy "programs_read_authenticated" on public.scholarship_programs
for select to authenticated using (true);

create policy "assignments_staff_all" on public.scholar_assignments
for all to authenticated
using (public.current_user_is_staff())
with check (public.current_user_is_staff() and exists (select 1 from public.profiles p where p.id = profile_id and p.role = 'scholar'));
create policy "assignments_scholar_read_own" on public.scholar_assignments
for select to authenticated using (profile_id = auth.uid());

create policy "submissions_staff_read" on public.semester_submissions
for select to authenticated using (public.current_user_is_staff());
create policy "submissions_scholar_read_own" on public.semester_submissions
for select to authenticated using (public.current_user_is_assigned_to(scholar_id));
create policy "submissions_scholar_insert_own_pending" on public.semester_submissions
for insert to authenticated
with check (
  public.current_user_is_assigned_to(scholar_id)
  and verification_status = 'Pending'
  and compliance_result is null
  and cardinality(deficiency_reasons) = 0
  and renewal_decision = 'Held'
);
create policy "submissions_staff_update" on public.semester_submissions
for update to authenticated
using (public.current_user_is_staff()) with check (public.current_user_is_staff());
create policy "submissions_scholar_correct_returned" on public.semester_submissions
for update to authenticated
using (public.current_user_is_assigned_to(scholar_id) and verification_status = 'Returned')
with check (
  public.current_user_is_assigned_to(scholar_id)
  and verification_status = 'Pending'
  and compliance_result is null
  and cardinality(deficiency_reasons) = 0
  and renewal_decision = 'Held'
);

create policy "history_staff_read" on public.decision_history
for select to authenticated using (public.current_user_is_staff());
create policy "history_scholar_read_own" on public.decision_history
for select to authenticated
using (exists (
  select 1 from public.semester_submissions s
  where s.id = decision_history.submission_id and public.current_user_is_assigned_to(s.scholar_id)
));

-- 4. Guard trigger (FIXED: NULL-safe approval check, server-side submitted_at)
create or replace function public.guard_submission_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if public.current_user_is_staff() then
    if new.renewal_decision = 'Approved'
       and (new.verification_status is distinct from 'Verified'
            or new.compliance_result is distinct from 'Compliant') then
      raise exception 'Renewal approval requires verified evidence and a Compliant evaluation.';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.current_user_is_assigned_to(new.scholar_id)
       or new.verification_status <> 'Pending'
       or new.compliance_result is not null
       or new.renewal_decision <> 'Held' then
      raise exception 'Scholars may only submit their own records as Pending and Held.';
    end if;
    new.submitted_at := now();
    new.verification_reason := null;
    new.renewal_note := null;
    return new;
  end if;

  if not public.current_user_is_assigned_to(old.scholar_id)
     or old.verification_status <> 'Returned'
     or new.scholar_id is distinct from old.scholar_id
     or new.academic_year is distinct from old.academic_year
     or new.semester is distinct from old.semester
     or new.submitted_at is distinct from old.submitted_at
     or new.verification_status <> 'Pending'
     or new.compliance_result is not null
     or new.renewal_decision <> 'Held' then
    raise exception 'Scholars may only correct their own Returned submission and resubmit it as Pending.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_submission_write() from public;
drop trigger if exists guard_submission_write on public.semester_submissions;
create trigger guard_submission_write
before insert or update on public.semester_submissions
for each row execute function public.guard_submission_write();

-- 5. Audit history trigger
create or replace function public.write_submission_history()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  action_name text;
  detail text;
begin
  if tg_op = 'INSERT' then
    action_name := 'Submitted';
    detail := 'Academic summary submitted and pending verification.';
  elsif new.verification_status is distinct from old.verification_status then
    action_name := case new.verification_status
      when 'Verified' then 'Verified'
      when 'Returned' then 'Returned'
      else 'Correction resubmitted'
    end;
    detail := coalesce(new.verification_reason, 'Verification status changed.');
  elsif new.compliance_result is distinct from old.compliance_result
     or new.deficiency_reasons is distinct from old.deficiency_reasons then
    action_name := 'Compliance evaluated';
    detail := concat_ws(': ', new.compliance_result, array_to_string(new.deficiency_reasons, ' '));
  elsif new.renewal_decision is distinct from old.renewal_decision then
    action_name := case new.renewal_decision when 'Approved' then 'Renewal approved' else 'Renewal held' end;
    detail := coalesce(new.renewal_note, 'Renewal decision changed.');
  else
    return new;
  end if;

  insert into public.decision_history(submission_id, action, actor_id, note)
  values (new.id, action_name, auth.uid(), detail);
  return new;
end;
$$;

revoke all on function public.write_submission_history() from public;
drop trigger if exists write_submission_history on public.semester_submissions;
create trigger write_submission_history
after insert or update on public.semester_submissions
for each row execute function public.write_submission_history();

-- 6. Seed scholarship policies
insert into public.scholarship_programs
  (id, name, max_gwa, min_units, failed_allowed, incomplete_allowed, dropped_allowed, submission_deadline)
values
  ('EXC', 'Excellence Scholar', 2.00, 18, 0, 0, 0, '2026-11-06 17:00:00+08'),
  ('ACC', 'Access Scholar', 2.50, 15, 0, 0, 1, '2026-11-06 17:00:00+08')
on conflict (id) do update set
  name = excluded.name, max_gwa = excluded.max_gwa, min_units = excluded.min_units,
  failed_allowed = excluded.failed_allowed, incomplete_allowed = excluded.incomplete_allowed,
  dropped_allowed = excluded.dropped_allowed, submission_deadline = excluded.submission_deadline;

-- 7. Grants
grant select on public.scholarship_programs to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.scholar_assignments to authenticated;
grant select, insert, update on public.semester_submissions to authenticated;
grant select on public.decision_history to authenticated;
grant usage, select on sequence public.decision_history_id_seq to authenticated;

commit;
