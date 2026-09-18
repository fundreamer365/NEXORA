# NEXORA

> **Connect without limits.**

A modern, real-time web messenger built with vanilla JavaScript, HTML, CSS, and Supabase.

## Features

- Email + password registration and login (Supabase Auth)
- Unique, immutable **NEXORA ID** (e.g. `NXR-7K4P92`) per user
- Search users by NEXORA ID or username
- Personal 1:1 chats with real-time message delivery (Supabase Realtime)
- Message editing and deletion
- Rich text formatting: **bold**, *italic*, ~~strike~~, `code`, > quote, [links](https://example.com), auto-linked URLs
- TOTP two-factor authentication (via Supabase Auth MFA)
- Online/offline presence
- Privacy controls (discoverability, messaging policy, online status visibility)
- Dark / Light / System themes
- Responsive design (desktop, tablet, mobile)

## Security

- All tables protected by Row Level Security (RLS)
- Users can only read chats they are members of
- Users can only edit/delete their own messages
- Users cannot modify other users' profiles
- Emails are never exposed via the public `profiles` table
- All user-generated content is HTML-escaped before rendering (XSS protection)
- Only the Supabase **anon** key is used on the client — **never** put your `service_role` key anywhere in this repository

## Setup

### 1. Create Supabase project
Go to https://app.supabase.com, create a new project. Wait for the DB to be ready.

### 2. Run the SQL schema
Open **SQL Editor → New query** and paste the entire SQL block from the project documentation (PART 1). Run it. This will create:
- tables `profiles`, `contacts`, `chats`, `chat_members`, `messages`
- triggers for auto-profile creation and `updated_at`
- RPCs `get_or_create_direct_chat`, `search_user`
- all RLS policies
- realtime publication for `messages` and `profiles`

### 3. Configure Auth
- **Authentication → Providers → Email**: enable "Email" and (for testing) disable "Confirm email" if you don't want to check the inbox.
- **Authentication → URL Configuration**: set **Site URL** to your GitHub Pages URL, and add it to **Redirect URLs**.
- **Authentication → Multi-Factor Auth**: enable **TOTP** factor.

### 4. Configure Storage
- **Storage → New bucket**: create a bucket named `avatars`, mark it **Public**.
- Add a policy on `storage.objects` allowing authenticated users to `INSERT`/`UPDATE`/`SELECT` files where `bucket_id = 'avatars'` and `(storage.foldername(name))[1] = auth.uid()::text`.

Example policy (SQL):
```sql
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_select_all" on storage.objects
  for select using (bucket_id = 'avatars');
