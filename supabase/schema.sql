-- 潔牙記錄系統 V1.2
-- 請以 Supabase Dashboard > SQL Editor 執行本檔。
-- 本檔不建立 Auth 帳號，也不包含任何密碼或 service_role key。

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null constraint app_users_role_check check (role in ('kiosk', 'teacher')),
  display_name text not null constraint app_users_display_name_check check (char_length(btrim(display_name)) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brushing_records (
  id uuid primary key default gen_random_uuid(),
  student_no smallint not null constraint brushing_records_student_check check (student_no in (1, 2)),
  record_date date not null default ((now() at time zone 'Asia/Taipei')::date),
  status text not null constraint brushing_records_status_check check (status in ('completed', 'leave')),
  recorded_at timestamptz not null default now(),
  constraint brushing_records_student_date_key unique (student_no, record_date)
);

create index if not exists brushing_records_record_date_idx
  on public.brushing_records (record_date);

create table if not exists public.school_calendar (
  id uuid primary key default gen_random_uuid(),
  date date not null constraint school_calendar_date_key unique,
  is_school_day boolean not null,
  label text not null constraint school_calendar_label_check check (char_length(btrim(label)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.app_settings (
  id smallint primary key constraint app_settings_singleton_check check (id = 1),
  usage_day_mode text not null default 'weekdays'
    constraint app_settings_usage_day_mode_check check (usage_day_mode in ('weekdays', 'everyday')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings (id, usage_day_mode)
values (1, 'weekdays')
on conflict (id) do nothing;

create table if not exists public.report_settings (
  id uuid primary key default gen_random_uuid(),
  school_name text not null constraint report_settings_school_name_check check (char_length(btrim(school_name)) between 1 and 80),
  class_name text not null constraint report_settings_class_name_check check (char_length(btrim(class_name)) between 1 and 40),
  academic_year smallint not null constraint report_settings_academic_year_check check (academic_year between 1 and 999),
  semester smallint not null constraint report_settings_semester_check check (semester in (1, 2)),
  effective_start date not null,
  effective_end date not null,
  form_title text not null default '學生潔牙紀錄表'
    constraint report_settings_form_title_check check (char_length(btrim(form_title)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint report_settings_period_check check (effective_end >= effective_start),
  constraint report_settings_term_key unique (academic_year, semester),
  constraint report_settings_no_overlapping_periods
    exclude using gist (daterange(effective_start, effective_end, '[]') with &&)
);

create table if not exists public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  report_setting_id uuid not null references public.report_settings(id) on delete restrict,
  student_no smallint not null constraint student_profiles_student_check check (student_no in (1, 2)),
  display_no smallint not null constraint student_profiles_display_no_check check (display_no between 1 and 99),
  display_name text not null
    constraint student_profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 30),
  photo_path text
    constraint student_profiles_photo_path_check check (
      photo_path is null
      or photo_path ~ '^[0-9a-f-]{36}/[12]/[0-9a-f-]{36}\.(jpg|png|webp)$'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint student_profiles_setting_student_key unique (report_setting_id, student_no)
);

-- 舊版資料庫升級：student_no 保留為兩個固定的內部位置，display_no 才是畫面上的可改座號。
alter table public.student_profiles
  add column if not exists display_no smallint;

update public.student_profiles
set display_no = student_no
where display_no is null;

alter table public.student_profiles
  alter column display_no set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_profiles_display_no_check'
      and conrelid = 'public.student_profiles'::regclass
  ) then
    alter table public.student_profiles
      add constraint student_profiles_display_no_check check (display_no between 1 and 99);
  end if;
end;
$$;

create index if not exists student_profiles_report_setting_idx
  on public.student_profiles (report_setting_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-photos',
  'student-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.app_users is 'Supabase Auth 使用者的應用程式角色；不保存密碼。';
comment on table public.brushing_records is '學生每日第一筆有效潔牙或請假狀態。';
comment on table public.school_calendar is '覆寫每週使用模式的特殊上課或非上課日期。';
comment on table public.app_settings is '全系統單例設定；決定一般每週使用日。';
comment on table public.report_settings is '依學期保存的月報行政資料。';
comment on table public.student_profiles is '按學期保存兩位學生的顯示座號、名稱與私人圖片路徑；student_no 是固定內部位置。';

create or replace function private.taipei_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Taipei')::date;
$$;

create or replace function private.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users
    where user_id = auth.uid()
      and role = required_role
      and is_active = true
  );
$$;

create or replace function private.is_school_day(target_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select calendar.is_school_day
      from public.school_calendar as calendar
      where calendar.date = target_date
    ),
    coalesce(
      (
        select settings.usage_day_mode = 'everyday'
        from public.app_settings as settings
        where settings.id = 1
      ),
      false
    ) or extract(isodow from target_date) between 1 and 5
  );
$$;

create or replace function private.is_current_report_setting(setting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.report_settings as settings
    where settings.id = setting_id
      and private.taipei_today() between settings.effective_start and settings.effective_end
  );
$$;

create or replace function private.can_read_current_student_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_profiles as profile
    where profile.photo_path = object_name
      and private.is_current_report_setting(profile.report_setting_id)
  );
$$;

create or replace function private.touch_app_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.touch_teacher_owned_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.set_recorded_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.recorded_at := now();
  return new;
end;
$$;

drop trigger if exists app_users_touch_updated_at on public.app_users;
create trigger app_users_touch_updated_at
before update on public.app_users
for each row execute function private.touch_app_user();

drop trigger if exists school_calendar_touch_metadata on public.school_calendar;
create trigger school_calendar_touch_metadata
before insert or update on public.school_calendar
for each row execute function private.touch_teacher_owned_row();

drop trigger if exists app_settings_touch_metadata on public.app_settings;
create trigger app_settings_touch_metadata
before update on public.app_settings
for each row execute function private.touch_teacher_owned_row();

drop trigger if exists report_settings_touch_metadata on public.report_settings;
create trigger report_settings_touch_metadata
before insert or update on public.report_settings
for each row execute function private.touch_teacher_owned_row();

drop trigger if exists student_profiles_touch_metadata on public.student_profiles;
create trigger student_profiles_touch_metadata
before insert or update on public.student_profiles
for each row execute function private.touch_teacher_owned_row();

drop trigger if exists brushing_records_set_recorded_at on public.brushing_records;
create trigger brushing_records_set_recorded_at
before insert on public.brushing_records
for each row execute function private.set_recorded_at();

revoke all on function private.taipei_today() from public, anon;
revoke all on function private.has_role(text) from public, anon;
revoke all on function private.is_school_day(date) from public, anon;
revoke all on function private.is_current_report_setting(uuid) from public, anon;
revoke all on function private.can_read_current_student_photo(text) from public, anon;
revoke all on function private.touch_app_user() from public, anon, authenticated;
revoke all on function private.touch_teacher_owned_row() from public, anon, authenticated;
revoke all on function private.set_recorded_at() from public, anon, authenticated;
grant execute on function private.taipei_today() to authenticated;
grant execute on function private.has_role(text) to authenticated;
grant execute on function private.is_school_day(date) to authenticated;
grant execute on function private.is_current_report_setting(uuid) to authenticated;
grant execute on function private.can_read_current_student_photo(text) to authenticated;

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.brushing_records from anon, authenticated;
revoke all on table public.school_calendar from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.report_settings from anon, authenticated;
revoke all on table public.student_profiles from anon, authenticated;

grant select on table public.app_users to authenticated;
grant select on table public.brushing_records to authenticated;
grant insert (student_no, record_date, status) on table public.brushing_records to authenticated;
grant delete on table public.brushing_records to authenticated;
grant select, insert, update, delete on table public.school_calendar to authenticated;
grant select on table public.app_settings to authenticated;
grant update (usage_day_mode) on table public.app_settings to authenticated;
grant select, insert, update, delete on table public.report_settings to authenticated;
grant select, insert, update, delete on table public.student_profiles to authenticated;

alter table public.app_users enable row level security;
alter table public.brushing_records enable row level security;
alter table public.school_calendar enable row level security;
alter table public.app_settings enable row level security;
alter table public.report_settings enable row level security;
alter table public.student_profiles enable row level security;

drop policy if exists app_users_select_self on public.app_users;
create policy app_users_select_self
on public.app_users
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists brushing_records_teacher_select on public.brushing_records;
create policy brushing_records_teacher_select
on public.brushing_records
for select
to authenticated
using (private.has_role('teacher'));

drop policy if exists brushing_records_teacher_delete on public.brushing_records;
create policy brushing_records_teacher_delete
on public.brushing_records
for delete
to authenticated
using (private.has_role('teacher'));

drop policy if exists brushing_records_kiosk_select_today on public.brushing_records;
create policy brushing_records_kiosk_select_today
on public.brushing_records
for select
to authenticated
using (
  private.has_role('kiosk')
  and record_date = private.taipei_today()
);

drop policy if exists brushing_records_kiosk_insert_today on public.brushing_records;
create policy brushing_records_kiosk_insert_today
on public.brushing_records
for insert
to authenticated
with check (
  private.has_role('kiosk')
  and student_no in (1, 2)
  and status in ('completed', 'leave')
  and record_date = private.taipei_today()
  and private.is_school_day(record_date)
);

drop policy if exists school_calendar_teacher_select on public.school_calendar;
create policy school_calendar_teacher_select
on public.school_calendar
for select
to authenticated
using (private.has_role('teacher'));

drop policy if exists school_calendar_kiosk_select_today on public.school_calendar;
create policy school_calendar_kiosk_select_today
on public.school_calendar
for select
to authenticated
using (
  private.has_role('kiosk')
  and date = private.taipei_today()
);

drop policy if exists school_calendar_teacher_insert on public.school_calendar;
create policy school_calendar_teacher_insert
on public.school_calendar
for insert
to authenticated
with check (
  private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists school_calendar_teacher_update on public.school_calendar;
create policy school_calendar_teacher_update
on public.school_calendar
for update
to authenticated
using (private.has_role('teacher'))
with check (
  private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists school_calendar_teacher_delete on public.school_calendar;
create policy school_calendar_teacher_delete
on public.school_calendar
for delete
to authenticated
using (private.has_role('teacher'));

drop policy if exists app_settings_authorized_select on public.app_settings;
create policy app_settings_authorized_select
on public.app_settings
for select
to authenticated
using (
  id = 1
  and (private.has_role('kiosk') or private.has_role('teacher'))
);

drop policy if exists app_settings_teacher_update on public.app_settings;
create policy app_settings_teacher_update
on public.app_settings
for update
to authenticated
using (
  id = 1
  and private.has_role('teacher')
)
with check (
  id = 1
  and private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists report_settings_teacher_select on public.report_settings;
create policy report_settings_teacher_select
on public.report_settings
for select
to authenticated
using (private.has_role('teacher'));

drop policy if exists report_settings_teacher_insert on public.report_settings;
create policy report_settings_teacher_insert
on public.report_settings
for insert
to authenticated
with check (
  private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists report_settings_teacher_update on public.report_settings;
create policy report_settings_teacher_update
on public.report_settings
for update
to authenticated
using (private.has_role('teacher'))
with check (
  private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists report_settings_teacher_delete on public.report_settings;
create policy report_settings_teacher_delete
on public.report_settings
for delete
to authenticated
using (private.has_role('teacher'));

drop policy if exists student_profiles_teacher_select on public.student_profiles;
create policy student_profiles_teacher_select
on public.student_profiles
for select
to authenticated
using (private.has_role('teacher'));

drop policy if exists student_profiles_kiosk_select_current on public.student_profiles;
create policy student_profiles_kiosk_select_current
on public.student_profiles
for select
to authenticated
using (
  private.has_role('kiosk')
  and private.is_current_report_setting(report_setting_id)
);

drop policy if exists student_profiles_teacher_insert on public.student_profiles;
create policy student_profiles_teacher_insert
on public.student_profiles
for insert
to authenticated
with check (
  private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists student_profiles_teacher_update on public.student_profiles;
create policy student_profiles_teacher_update
on public.student_profiles
for update
to authenticated
using (private.has_role('teacher'))
with check (
  private.has_role('teacher')
  and updated_by = auth.uid()
);

drop policy if exists student_profiles_teacher_delete on public.student_profiles;
create policy student_profiles_teacher_delete
on public.student_profiles
for delete
to authenticated
using (private.has_role('teacher'));

drop policy if exists student_photos_teacher_select on storage.objects;
create policy student_photos_teacher_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-photos'
  and private.has_role('teacher')
);

drop policy if exists student_photos_kiosk_select_current on storage.objects;
create policy student_photos_kiosk_select_current
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-photos'
  and private.has_role('kiosk')
  and private.can_read_current_student_photo(name)
);

drop policy if exists student_photos_teacher_insert on storage.objects;
create policy student_photos_teacher_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-photos'
  and private.has_role('teacher')
);

drop policy if exists student_photos_teacher_update on storage.objects;
create policy student_photos_teacher_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'student-photos'
  and private.has_role('teacher')
)
with check (
  bucket_id = 'student-photos'
  and private.has_role('teacher')
);

drop policy if exists student_photos_teacher_delete on storage.objects;
create policy student_photos_teacher_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-photos'
  and private.has_role('teacher')
);

commit;
