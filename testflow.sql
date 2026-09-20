-- TESTFLOW V4 DATABASE / SECURITY MIGRATION
-- Safe to run on the existing TestFlow schema.
-- It upgrades the previous setup; it does not delete existing data.

create extension if not exists "pgcrypto";

-- Plan pricing is editable here and displayed by the website.
alter table if exists public.plans add column if not exists price_inr numeric(10,2);
alter table if exists public.plans add column if not exists billing_period text;

insert into public.plans(slug,name,description,price_inr,billing_period,features) values
('free','Free','No payment required. Account required.',0,'forever','{"functional_testing":true,"basic_ui_testing":true,"basic_responsive_checks":true,"screenshot_evidence":true,"basic_reports":true,"evidence_collection":true}'::jsonb),
('premium','Premium','Payment + manual approval.',499,'monthly','{"functional_testing":true,"basic_ui_testing":true,"basic_responsive_checks":true,"screenshot_evidence":true,"basic_reports":true,"evidence_collection":true,"white_box_testing":true,"function_analysis":true,"condition_analysis":true,"path_analysis":true,"execution_insight":true,"console_insight":true,"detailed_reports":true}'::jsonb),
('pro','Pro','Payment + manual approval.',999,'monthly','{"functional_testing":true,"basic_ui_testing":true,"basic_responsive_checks":true,"screenshot_evidence":true,"basic_reports":true,"evidence_collection":true,"white_box_testing":true,"function_analysis":true,"condition_analysis":true,"path_analysis":true,"execution_insight":true,"console_insight":true,"detailed_reports":true,"regression_testing":true,"compatibility_testing":true,"cross_browser_testing":true,"performance_testing":true,"history_comparisons":true}'::jsonb)
on conflict(slug) do update set name=excluded.name,description=excluded.description,price_inr=excluded.price_inr,billing_period=excluded.billing_period,features=excluded.features;

-- Robust account/profile trigger. This must succeed before a new Auth user is usable by TestFlow.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,role,plan)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'user','free')
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Profile access: users may edit their own profile; admins may edit any profile.
drop policy if exists profiles_update_admin_only on public.profiles;
drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles for update to authenticated
using(id=auth.uid() or public.is_admin())
with check(id=auth.uid() or public.is_admin());

-- Server-side plan/role gate. Frontend buttons are not the security boundary.
create or replace function public.can_run_test(test_type text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  r text;
  p text;
  t text := lower(trim(coalesce(test_type,'')));
  free_test_label text;
  already_used_today boolean := false;
begin
  if auth.uid() is null then return false; end if;
  -- The client sends either the short test key or the saved full label
  -- such as "Code Testing · Functional testing". Normalize both forms.
  if position('·' in t) > 0 then
    t := lower(trim(split_part(t,'·',2)));
  end if;
  select role,plan into r,p from public.profiles where id=auth.uid();
  if coalesce(r,'')='admin' or public.is_admin() then return true; end if;
  if p is null then return false; end if;

  -- Free users may run each Free test once per calendar day.
  -- Premium and Pro users are unlimited for Free tests.
  if p='free' and t in ('functional','functional testing','ui','ui testing','responsive','responsive testing') then
    free_test_label := case
      when t in ('functional','functional testing') then 'functional testing'
      when t in ('ui','ui testing') then 'ui testing'
      when t in ('responsive','responsive testing') then 'responsive testing'
      else null
    end;
    select exists(
      select 1
      from public.test_sessions s
      where s.user_id=auth.uid()
        and s.completed_at >= date_trunc('day',now())
        and lower(trim(regexp_replace(coalesce(s.test_type,''), '^.*·\s*', ''))) = free_test_label
    ) into already_used_today;
    if already_used_today then return false; end if;
  end if;

  if t in ('functional','functional testing','ui','ui testing','responsive','responsive testing','evidence','evidence collection','report','reports') then return true; end if;
  if t in ('whitebox','white-box testing','function','function analysis','path','condition & path testing','execution','execution & console insight') then return p in ('premium','pro'); end if;
  if t in ('regression','regression testing','compatibility','compatibility testing','performance','performance testing') then return p='pro'; end if;
  return false;
end;
$$;

drop policy if exists sessions_insert on public.test_sessions;
create policy sessions_insert on public.test_sessions for insert to authenticated
with check((user_id=auth.uid() or public.is_admin()) and public.can_run_test(test_type));

drop policy if exists sessions_update on public.test_sessions;
create policy sessions_update on public.test_sessions for update to authenticated
using(user_id=auth.uid() or public.is_admin())
with check((user_id=auth.uid() or public.is_admin()) and public.can_run_test(test_type));

-- Keep child records tied to the same owner. Admin can manage all.
drop policy if exists results_insert on public.test_results;
create policy results_insert on public.test_results for insert to authenticated
with check(public.is_admin() or exists(select 1 from public.test_sessions s where s.id=session_id and s.user_id=auth.uid()));

drop policy if exists evidence_insert on public.test_evidence;
create policy evidence_insert on public.test_evidence for insert to authenticated
with check(public.is_admin() or exists(select 1 from public.test_sessions s where s.id=session_id and s.user_id=auth.uid()));

-- Reports must belong to the current user unless the current user is an admin.
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
with check(user_id=auth.uid() or public.is_admin());

-- Optional helper for admins to clear all test data from the dashboard if needed.
-- The website's Delete all history button uses normal RLS-protected deletes instead.

create index if not exists idx_plans_price on public.plans(price_inr);

-- IMPORTANT AUTH SETTINGS (Dashboard, not SQL):
-- Email provider: ENABLED
-- Allow new users to sign up: ENABLED
-- Confirm Email: DISABLED
-- This gives signUp() an authenticated session immediately instead of email_not_confirmed.
-- Forgot password still uses a secure reset email/link.

-- ADMIN SETUP (run only once for your own account if needed):
-- update public.profiles set role='admin', plan='pro' where id='YOUR-USER-UUID';
-- Never expose the service_role key in config.js.

-- =========================================================
-- TESTFLOW V5 HOTFIX: RELIABLE TEST RUNS + REPORT PERSISTENCE
-- Run this block if an older policy set is already installed.
-- =========================================================

-- A completed test is inserted only after analysis, so no client-side
-- status transition is required. Keep a simple owner/admin update policy
-- for older sessions created by previous versions.
drop policy if exists sessions_update on public.test_sessions;
drop policy if exists test_sessions_update_own_or_admin on public.test_sessions;
create policy test_sessions_update_own_or_admin on public.test_sessions
for update to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

-- Explicit read policies make .select().single() reliable after inserts.
drop policy if exists sessions_select on public.test_sessions;
create policy sessions_select on public.test_sessions
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists results_select on public.test_results;
create policy results_select on public.test_results
for select to authenticated
using (public.is_admin() or exists(
  select 1 from public.test_sessions s
  where s.id = session_id and s.user_id = auth.uid()
));

drop policy if exists evidence_select on public.test_evidence;
create policy evidence_select on public.test_evidence
for select to authenticated
using (public.is_admin() or exists(
  select 1 from public.test_sessions s
  where s.id = session_id and s.user_id = auth.uid()
));

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

-- Keep child inserts explicitly tied to the saved session owner.
drop policy if exists results_insert on public.test_results;
create policy results_insert on public.test_results
for insert to authenticated
with check (public.is_admin() or exists(
  select 1 from public.test_sessions s
  where s.id = session_id and s.user_id = auth.uid()
));

drop policy if exists evidence_insert on public.test_evidence;
create policy evidence_insert on public.test_evidence
for insert to authenticated
with check (public.is_admin() or exists(
  select 1 from public.test_sessions s
  where s.id = session_id and s.user_id = auth.uid()
));

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
for insert to authenticated
with check (user_id = auth.uid() or public.is_admin());

-- TESTFLOW V6: review-gated downloads
-- A review is required before the client unlocks report download.
alter table if exists public.reviews enable row level security;
drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews
for insert to authenticated
with check (user_id = auth.uid() or public.is_admin());
drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

-- =========================================================
-- TESTFLOW V7: PLAN REQUEST / PAYMENT VERIFICATION FLOW
-- Initial request contains only the user's real signed-in email + requested plan.
-- Payment reference is collected only after admin accepts the request.
-- The plan is activated only after admin verifies the submitted payment.
-- =========================================================
alter table if exists public.plan_requests add column if not exists requester_email text;
alter table if exists public.plan_requests add column if not exists payment_submitted_at timestamptz;

-- Existing rows keep their current values. New requests are populated by the website.
update public.plan_requests pr
set requester_email = coalesce(pr.requester_email, u.email)
from auth.users u
where u.id = pr.user_id and pr.requester_email is null;

alter table if exists public.plan_requests enable row level security;

drop policy if exists plan_requests_insert_own on public.plan_requests;
create policy plan_requests_insert_own on public.plan_requests
for insert to authenticated
with check (user_id = auth.uid() and requested_plan in ('premium','pro'));

drop policy if exists plan_requests_select_own_or_admin on public.plan_requests;
create policy plan_requests_select_own_or_admin on public.plan_requests
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists plan_requests_update_own_or_admin on public.plan_requests;
create policy plan_requests_update_own_or_admin on public.plan_requests
for update to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

-- Keep payment reference nullable: it must not be required at initial request time.
-- Admin approval sequence is: pending -> awaiting_payment -> payment_submitted -> approved.

-- ADMIN ACCESS CHECK:
-- Admin access is determined by profiles.role, not by the plan button or frontend UI.
-- Run this once for the account that should be the TestFlow administrator:
-- update public.profiles set role='admin', plan='pro' where id='YOUR-USER-UUID';
-- After running it, log out and log back in so the frontend reloads the profile role.

-- Expand the original status check so the two-step paid activation workflow is valid.
alter table if exists public.plan_requests drop constraint if exists plan_requests_status_check;
alter table if exists public.plan_requests add constraint plan_requests_status_check
check(status in ('pending','awaiting_payment','payment_submitted','approved','rejected'));

drop policy if exists plan_requests_select on public.plan_requests;
drop policy if exists plan_requests_insert on public.plan_requests;
drop policy if exists plan_requests_update_admin on public.plan_requests;

-- Replace the broad V7 update policy with a safer two-role workflow.
drop policy if exists plan_requests_update_own_or_admin on public.plan_requests;
drop policy if exists plan_requests_update_user_payment on public.plan_requests;
drop policy if exists plan_requests_update_admin on public.plan_requests;
create policy plan_requests_update_user_payment on public.plan_requests
for update to authenticated
using (user_id = auth.uid() and status = 'awaiting_payment')
with check (user_id = auth.uid() and status = 'payment_submitted' and requested_plan in ('premium','pro'));
create policy plan_requests_update_admin on public.plan_requests
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- New requests must carry the signed-in account email as the requester email.
drop policy if exists plan_requests_insert_own on public.plan_requests;
create policy plan_requests_insert_own on public.plan_requests
for insert to authenticated
with check (
  user_id = auth.uid()
  and requested_plan in ('premium','pro')
  and requester_email = (auth.jwt() ->> 'email')
  and status = 'pending'
);

-- =========================================================
-- V7 SECURITY HARDENING: PLAN/ROLE CANNOT BE CHANGED FROM THE CLIENT
-- Users may edit their name only. Admin activation uses a protected RPC.
-- =========================================================
revoke update(role, plan) on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;

create or replace function public.admin_activate_plan(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  req public.plan_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  select * into req from public.plan_requests where id=p_request_id for update;
  if req.id is null then raise exception 'Plan request not found'; end if;
  if req.status <> 'payment_submitted' then raise exception 'Payment has not been submitted for this request'; end if;
  update public.profiles set plan=req.requested_plan where id=req.user_id;
  update public.plan_requests
    set status='approved', reviewed_by=auth.uid(), reviewed_at=now()
    where id=req.id;
  return true;
end;
$$;
grant execute on function public.admin_activate_plan(uuid) to authenticated;

-- =========================================================
-- TESTFLOW V8: SIMPLE ADMIN EMAIL + COMPLETE PLAN REQUEST AUDIT
-- =========================================================
-- Replace the email below with the real TestFlow administrator email
-- BEFORE running this SQL for the first time.
create table if not exists public.admin_emails (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

insert into public.admin_emails(email,active)
values ('YOUR-ADMIN-EMAIL@example.com', true)
on conflict(email) do update set active=excluded.active;

-- Admin is determined by either the secure profile role OR the approved admin email.
-- This means an existing admin account can become admin without copying a UUID.
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  return exists(
    select 1 from public.admin_emails a
    where a.active=true
      and lower(a.email)=lower(coalesce(auth.jwt()->>'email',''))
  )
  or exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role='admin'
  );
end;
$$;
grant execute on function public.is_admin() to authenticated;

-- New users matching the configured admin email are created as Admin/Pro automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  make_admin boolean;
begin
  select exists(
    select 1 from public.admin_emails a
    where a.active=true and lower(a.email)=lower(coalesce(new.email,''))
  ) into make_admin;

  insert into public.profiles(id,full_name,role,plan)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    case when make_admin then 'admin' else 'user' end,
    case when make_admin then 'pro' else 'free' end
  )
  on conflict(id) do update set
    role=case when make_admin then 'admin' else public.profiles.role end,
    plan=case when make_admin then 'pro' else public.profiles.plan end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- If the administrator already existed before the admin email was configured,
-- the next profile sync makes that account an admin without exposing role updates to clients.
update public.profiles p
set role='admin', plan='pro'
from auth.users u
where u.id=p.id
  and exists(select 1 from public.admin_emails a where a.active=true and lower(a.email)=lower(coalesce(u.email,'')));

-- Complete request audit timestamps.
alter table if exists public.plan_requests add column if not exists accepted_at timestamptz;
alter table if exists public.plan_requests add column if not exists activated_at timestamptz;
alter table if exists public.plan_requests add column if not exists rejected_at timestamptz;
alter table if exists public.plan_requests add column if not exists activated_by uuid references auth.users(id);

-- Keep the request email tied to the signed-in account when possible.
update public.plan_requests pr
set requester_email=coalesce(pr.requester_email,u.email)
from auth.users u
where u.id=pr.user_id and (pr.requester_email is null or pr.requester_email='');

-- One open request per user per plan keeps the admin dashboard simple.
drop index if exists idx_plan_requests_one_open_per_plan;
create unique index if not exists idx_plan_requests_one_open_per_plan
on public.plan_requests(user_id,requested_plan)
where status in ('pending','awaiting_payment','payment_submitted');

-- Activation records the exact time and admin who activated the plan.
create or replace function public.admin_activate_plan(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  req public.plan_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into req
  from public.plan_requests
  where id=p_request_id
  for update;

  if req.id is null then raise exception 'Plan request not found'; end if;
  if req.status <> 'payment_submitted' then raise exception 'Payment has not been submitted for this request'; end if;
  if req.requested_plan not in ('premium','pro') then raise exception 'Invalid paid plan'; end if;

  update public.profiles
  set plan=req.requested_plan
  where id=req.user_id;

  update public.plan_requests
  set status='approved',
      activated_at=now(),
      activated_by=auth.uid(),
      reviewed_by=auth.uid(),
      reviewed_at=coalesce(reviewed_at,now())
  where id=req.id;

  return true;
end;
$$;
grant execute on function public.admin_activate_plan(uuid) to authenticated;

-- Admin can read/manage all request records; users retain only their own records.
drop policy if exists plan_requests_select_own_or_admin on public.plan_requests;
create policy plan_requests_select_own_or_admin on public.plan_requests
for select to authenticated
using (user_id=auth.uid() or public.is_admin());

drop policy if exists plan_requests_update_user_payment on public.plan_requests;
create policy plan_requests_update_user_payment on public.plan_requests
for update to authenticated
using (user_id=auth.uid() and status='awaiting_payment')
with check (user_id=auth.uid() and status='payment_submitted' and requested_plan in ('premium','pro'));

drop policy if exists plan_requests_update_admin on public.plan_requests;
create policy plan_requests_update_admin on public.plan_requests
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Explicit report read/delete policies help History remain reliable.
drop policy if exists reports_delete_own on public.reports;
create policy reports_delete_own on public.reports
for delete to authenticated
using (user_id=auth.uid() or public.is_admin());

-- Reviews are linked to the downloaded report and remain private to the owner/admin.
alter table if exists public.reviews enable row level security;
drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews
for insert to authenticated
with check (user_id=auth.uid() or public.is_admin());
drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
for select to authenticated
using (user_id=auth.uid() or public.is_admin());

-- =========================================================
-- AUTH DASHBOARD SETTINGS
-- Email provider: ENABLED
-- Allow new users to sign up: ENABLED
-- Confirm Email: DISABLED
-- =========================================================


-- =========================================================
-- TESTFLOW V9: ATOMIC HISTORY + REPORT SAVE
-- This is the reliable history path used by the website.
-- One RPC creates the session, result, evidence and report in
-- one database transaction. It prevents history from disappearing
-- because a child-table RLS/select request failed after the test.
-- =========================================================

create or replace function public.save_test_run(
  p_project_name text,
  p_test_type text,
  p_status text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_result jsonb,
  p_report_kind text,
  p_test_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_report uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.can_run_test(coalesce(p_test_key,p_test_type)) then
    if exists(select 1 from public.profiles p where p.id=v_user and p.plan='free')
       and lower(trim(coalesce(p_test_key,p_test_type))) in ('functional','ui','responsive') then
      raise exception 'Free plan daily limit reached for this test. You can run this Free test again tomorrow.';
    end if;
    raise exception 'Your current plan does not allow this testing type';
  end if;

  -- test_sessions.status is the lifecycle state, not the report verdict.
  -- Existing TestFlow databases use passed/failed/cancelled/error lifecycle values.
  -- The report itself can still contain warning/passed/etc.
  insert into public.test_sessions(user_id,project_name,test_type,status,started_at,completed_at)
  values(
    v_user,
    coalesce(nullif(trim(p_project_name),''),'Untitled project'),
    coalesce(nullif(trim(p_test_type),''),'General test'),
    case when lower(coalesce(trim(p_status),'')) in ('failed','error','cancelled') then 'failed' else 'passed' end,
    p_started_at,
    p_completed_at
  )
  returning id into v_session;

  -- History is the primary record. Child records are best-effort so they can never erase the session.
  begin
    insert into public.test_results(session_id,status,summary,metrics)
    values(v_session,coalesce(p_status,'completed'),coalesce(p_result->>'title','Test result'),coalesce(p_result->'metrics','{}'::jsonb));
  exception when others then null;
  end;

  begin
    insert into public.test_evidence(session_id,evidence_type,metadata)
    values(v_session,case when lower(coalesce(p_report_kind,''))='code' then 'code-test-report' else 'application-test-report' end,jsonb_build_object('test_type',p_test_key,'report',coalesce(p_result,'{}'::jsonb)));
  exception when others then null;
  end;

  begin
    insert into public.reports(session_id,user_id,title,report_data)
    values(v_session,v_user,coalesce(p_result->>'title','TestFlow Test Report'),jsonb_build_object('report_kind',p_report_kind,'test_type',p_test_key,'report',coalesce(p_result,'{}'::jsonb)))
    returning id into v_report;
  exception when others then v_report := null;
  end;

  return jsonb_build_object('session_id',v_session,'report_id',v_report,'history_saved',true);
end;
$$;
grant execute on function public.save_test_run(text,text,text,timestamptz,timestamptz,jsonb,text,text) to authenticated;

-- History read is also server-side so admin-email admins and normal users see
-- exactly the records they are entitled to, without relying on fragile client
-- joins/RLS select chains.
create or replace function public.get_test_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_data jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc),'[]'::jsonb) into v_data
  from (
    select s.id,s.user_id,s.project_name,s.test_type,
      case when lower(s.test_type) like '%application testing%' then 'application'
           when lower(s.test_type) like '%code testing%' then 'code'
           else null end as test_subject,
      s.status,s.started_at,s.completed_at,s.created_at,
      p.full_name as user_name,
      u.email as user_email,
      (select jsonb_build_object('id',r.id,'session_id',r.session_id,'title',r.title,'report_data',r.report_data,'created_at',r.created_at)
       from public.reports r where r.session_id=s.id order by r.created_at desc limit 1) as report
    from public.test_sessions s
    left join public.profiles p on p.id=s.user_id
    left join auth.users u on u.id=s.user_id
    where (v_admin or s.user_id=v_user)
    order by s.created_at desc
    limit 5000
  ) x;
  return v_data;
end;
$$;
grant execute on function public.get_test_history() to authenticated;

-- =========================================================
-- TESTFLOW PAYMENT DESTINATION + PAYMENT PROOF
-- =========================================================
alter table if exists public.plan_requests add column if not exists payment_proof_path text;
alter table if exists public.plan_requests add column if not exists payment_proof_name text;

create table if not exists public.payment_settings (
  id integer primary key check (id=1),
  admin_email text,
  upi_id text,
  qr_url text,
  premium_amount numeric not null default 499 check (premium_amount > 0),
  pro_amount numeric not null default 999 check (pro_amount > 0),
  updated_at timestamptz not null default now()
);

alter table public.payment_settings enable row level security;

drop policy if exists payment_settings_select_authenticated on public.payment_settings;
create policy payment_settings_select_authenticated on public.payment_settings
for select to authenticated
using (true);

drop policy if exists payment_settings_admin_insert on public.payment_settings;
create policy payment_settings_admin_insert on public.payment_settings
for insert to authenticated
with check (public.is_admin());

drop policy if exists payment_settings_admin_update on public.payment_settings;
create policy payment_settings_admin_update on public.payment_settings
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.payment_settings(id,admin_email,upi_id,qr_url,premium_amount,pro_amount)
values (1,'','','',499,999)
on conflict(id) do nothing;

-- Private bucket: users can upload proof only inside their own auth.uid folder;
-- admins can read proof files for verification.
insert into storage.buckets(id,name,public)
values ('payment-proofs','payment-proofs',false)
on conflict(id) do update set public=false;

drop policy if exists payment_proofs_upload_own on storage.objects;
create policy payment_proofs_upload_own on storage.objects
for insert to authenticated
with check (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists payment_proofs_select_own_or_admin on storage.objects;
create policy payment_proofs_select_own_or_admin on storage.objects
for select to authenticated
using (
  bucket_id='payment-proofs'
  and ((storage.foldername(name))[1]=auth.uid()::text or public.is_admin())
);

drop policy if exists payment_proofs_delete_own on storage.objects;
create policy payment_proofs_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=auth.uid()::text
);
