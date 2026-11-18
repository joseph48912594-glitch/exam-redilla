-- Run AFTER migration.sql and AFTER creating the staff user in
-- Supabase -> Authentication -> Users -> Add user (tick "Auto Confirm User").
-- Replace PASTE-STAFF-UUID-HERE with that user's UUID.
insert into public.profiles (id, role, full_name)
values ('PASTE-STAFF-UUID-HERE', 'staff', 'Scholarship Staff');
