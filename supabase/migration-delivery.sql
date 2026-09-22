alter table public.orders add column if not exists delivery_method text check (delivery_method in ('home', 'relay'));
alter table public.orders add column if not exists billing jsonb;
