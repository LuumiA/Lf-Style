-- LF-Style: schema de base pour les comptes, produits et images.
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  first_name text not null,
  birth_date date,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists birth_date date;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(10, 2) not null check (price >= 0),
  old_price numeric(10, 2) check (old_price is null or old_price >= price),
  description text,
  image_url text not null,
  tag text,
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  stock integer not null default 0 check (stock >= 0),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products add column if not exists sizes text[] not null default '{}';
alter table public.products add column if not exists colors text[] not null default '{}';

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'preparing', 'shipped', 'completed', 'cancelled')),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

alter table public.orders add column if not exists stripe_session_id text unique;
alter table public.orders add column if not exists paypal_order_id text unique;
alter table public.orders add column if not exists shipping jsonb;

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders on delete cascade not null,
  product_id uuid references public.products on delete restrict not null,
  product_name text not null,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  size text,
  color text
);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.categories enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.newsletter_subscribers enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

create policy "Profiles are visible to their owner"
on public.profiles for select
to authenticated
using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, birth_date)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', 'Client'),
    nullif(new.raw_user_meta_data ->> 'birth_date', '')::date
  )
  on conflict (id) do update set
    first_name = excluded.first_name,
    birth_date = excluded.birth_date;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create policy "Anyone can view active products"
on public.products for select
to anon, authenticated
using (is_active = true or public.is_admin());

create policy "Admins can create products"
on public.products for insert
to authenticated
with check (public.is_admin());

create policy "Admins can update products"
on public.products for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete products"
on public.products for delete
to authenticated
using (public.is_admin());

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

create policy "Users can view their orders"
on public.orders for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "Admins can update orders"
on public.orders for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete orders"
on public.orders for delete
to authenticated
using (public.is_admin());

create policy "Users can view their order items"
on public.order_items for select
to authenticated
using (exists (select 1 from public.orders where orders.id = order_id and (orders.user_id = auth.uid() or public.is_admin())));

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

create or replace function public.cancel_order(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders%rowtype;
  item record;
begin
  select * into current_order from public.orders where id = target_order_id for update;
  if not public.is_admin() and current_order.user_id <> auth.uid() then raise exception 'ADMIN_REQUIRED'; end if;
  if not found or current_order.status in ('cancelled', 'completed') then raise exception 'ORDER_CANNOT_BE_CANCELLED'; end if;
  if not public.is_admin() and current_order.status <> 'pending' then raise exception 'ORDER_CANNOT_BE_CANCELLED'; end if;
  for item in select product_id, quantity from public.order_items where order_id = target_order_id loop
    update public.products set stock = stock + item.quantity where id = item.product_id;
  end loop;
  update public.orders set status = 'cancelled' where id = target_order_id;
end;
$$;

create or replace function public.create_order(order_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id uuid;
  item jsonb;
  current_product public.products%rowtype;
  computed_total numeric(10, 2) := 0;
  item_quantity integer;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if jsonb_array_length(order_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  for item in select * from jsonb_array_elements(order_items)
  loop
    item_quantity := (item ->> 'quantity')::integer;
    select * into current_product from public.products
      where id = (item ->> 'product_id')::uuid and is_active = true for update;
    if not found or current_product.stock < item_quantity then
      raise exception 'INSUFFICIENT_STOCK';
    end if;
    computed_total := computed_total + current_product.price * item_quantity;
  end loop;

  insert into public.orders (user_id, total) values (auth.uid(), computed_total)
  returning id into new_order_id;

  for item in select * from jsonb_array_elements(order_items)
  loop
    select * into current_product from public.products where id = (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, size, color)
    values (new_order_id, current_product.id, current_product.name, current_product.price, item_quantity, item ->> 'size', item ->> 'color');
    update public.products set stock = stock - item_quantity where id = current_product.id;
  end loop;

  return new_order_id;
end;
$$;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "Anyone can view product images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

create policy "Admins can upload product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_admin());

create policy "Admins can update product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images' and public.is_admin())
with check (bucket_id = 'product-images' and public.is_admin());

create policy "Admins can delete product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images' and public.is_admin());
