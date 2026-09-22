create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "Categories are visible to everyone"
on public.categories for select
to anon, authenticated
using (true);

create policy "Admins can create categories"
on public.categories for insert
to authenticated
with check (public.is_admin());

create policy "Admins can update categories"
on public.categories for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete categories"
on public.categories for delete
to authenticated
using (public.is_admin());

insert into public.categories (name, image_url) values
  ('Robes', 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=700&q=85'),
  ('T-shirts', 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=85'),
  ('Sacs', 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?auto=format&fit=crop&w=700&q=85'),
  ('Pantalons', 'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?auto=format&fit=crop&w=700&q=85')
on conflict (name) do nothing;
