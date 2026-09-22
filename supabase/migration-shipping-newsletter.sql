alter table public.orders add column if not exists shipping jsonb;

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

create policy "Anyone can subscribe to the newsletter"
on public.newsletter_subscribers for insert
to anon, authenticated
with check (true);

create policy "Admins can view newsletter subscribers"
on public.newsletter_subscribers for select
to authenticated
using (public.is_admin());

create policy "Admins can delete newsletter subscribers"
on public.newsletter_subscribers for delete
to authenticated
using (public.is_admin());
