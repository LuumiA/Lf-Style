-- LF-Style: migration catalogue, panier et commandes.
-- A executer dans Supabase SQL Editor apres schema.sql.

alter table public.products add column if not exists sizes text[] not null default '{}';
alter table public.products add column if not exists colors text[] not null default '{}';
alter table public.products add column if not exists description text;
alter table public.products add column if not exists stock integer not null default 0;
alter table public.products add column if not exists is_active boolean not null default true;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'preparing', 'shipped', 'completed', 'cancelled')),
  total numeric(10, 2) not null check (total >= 0),
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

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Users can view their orders" on public.orders;
create policy "Users can view their orders"
on public.orders for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
on public.orders for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete orders" on public.orders;
create policy "Admins can delete orders"
on public.orders for delete to authenticated
using (public.is_admin());

drop policy if exists "Users can view their order items" on public.order_items;
create policy "Users can view their order items"
on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders
  where public.orders.id = order_items.order_id
    and (public.orders.user_id = auth.uid() or public.is_admin())
));

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
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if jsonb_array_length(order_items) = 0 then raise exception 'EMPTY_ORDER'; end if;

  for item in select * from jsonb_array_elements(order_items) loop
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity is null or item_quantity < 1 then raise exception 'INVALID_QUANTITY'; end if;
    select * into current_product from public.products
      where id = (item ->> 'product_id')::uuid and is_active = true for update;
    if not found or current_product.stock < item_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
    computed_total := computed_total + current_product.price * item_quantity;
  end loop;

  insert into public.orders (user_id, total) values (auth.uid(), computed_total) returning id into new_order_id;

  for item in select * from jsonb_array_elements(order_items) loop
    select * into current_product from public.products where id = (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, size, color)
    values (new_order_id, current_product.id, current_product.name, current_product.price, item_quantity, item ->> 'size', item ->> 'color');
    update public.products set stock = stock - item_quantity where id = current_product.id;
  end loop;

  return new_order_id;
end;
$$;
