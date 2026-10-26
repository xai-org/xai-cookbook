insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', 'a11ce000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'alice@example.com', extensions.crypt('alice-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Alice"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b0b00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'bob@example.com', extensions.crypt('bob-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Bob"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users where email in ('alice@example.com', 'bob@example.com');
