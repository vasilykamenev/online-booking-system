-- Demo data for local development. Mirrors the vessels/initiatives that used
-- to live in src/data/*.ts mocks, so the catalog looks the same once it
-- switches to reading from the database.

-- Users -----------------------------------------------------------------
-- Minimal auth.users rows; public.profiles is populated automatically by
-- the on_auth_user_created trigger, then patched below with role/full_name.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'admin@meridian.travel', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Meridian Beyond Admin"}', false, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'owner1@meridian.travel', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Ana Kovač"}', false, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'owner2@meridian.travel', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Kenji Watanabe"}', false, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'client1@meridian.travel', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Vasily Kamenev"}', false, '', '', '', '');

update public.profiles set role = 'admin', full_name = 'Meridian Beyond Admin' where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'owner', full_name = 'Ana Kovač' where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set role = 'owner', full_name = 'Kenji Watanabe' where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set role = 'client', full_name = 'Vasily Kamenev' where id = '10000000-0000-0000-0000-000000000004';

-- Locations ---------------------------------------------------------------

insert into public.locations (id, country, city, marina, latitude, longitude) values
  ('20000000-0000-0000-0000-000000000001',
   '{"ru": "Хорватия", "en": "Croatia"}', '{"ru": "Сплит", "en": "Split"}', '{"ru": "ACI Marina Сплит", "en": "ACI Marina Split"}',
   43.50848, 16.43965),
  ('20000000-0000-0000-0000-000000000002',
   '{"ru": "Греция", "en": "Greece"}', '{"ru": "Икария", "en": "Ikaria"}', '{"ru": "Порт Икарии", "en": "Ikaria Port"}',
   37.59280, 26.28360),
  ('20000000-0000-0000-0000-000000000003',
   '{"ru": "Экспедиция", "en": "Expedition"}', '{"ru": "Антарктика", "en": "Antarctica"}', null,
   -64.82480, -63.49700),
  ('20000000-0000-0000-0000-000000000004',
   '{"ru": "Япония", "en": "Japan"}', '{"ru": "Йокогама", "en": "Yokohama"}', '{"ru": "Марина Йокогама Бэй", "en": "Yokohama Bay Marina"}',
   35.44370, 139.63800);

-- Amenities -----------------------------------------------------------------

insert into public.amenities (id, key) values
  ('30000000-0000-0000-0000-000000000001', 'wifi'),
  ('30000000-0000-0000-0000-000000000002', 'air_conditioning'),
  ('30000000-0000-0000-0000-000000000003', 'chef'),
  ('30000000-0000-0000-0000-000000000004', 'crew'),
  ('30000000-0000-0000-0000-000000000005', 'snorkeling_gear'),
  ('30000000-0000-0000-0000-000000000006', 'ice_class_hull'),
  ('30000000-0000-0000-0000-000000000007', 'research_lab'),
  ('30000000-0000-0000-0000-000000000008', 'satellite_comms');

-- Vessels ---------------------------------------------------------------

insert into public.vessels (
  id, owner_id, location_id, type, status, name, slug, description,
  length_meters, cabins, guests_capacity, year_built,
  base_price_minor, currency, rating_avg, rating_count
) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'yacht', 'published', 'Adriatic Breeze', 'adriatic-breeze',
   '{"ru": "Классическая моторная яхта, курсирующая вдоль Далматинского побережья — идеальна для семейных чартеров между Сплитом и островами Корнати.", "en": "A classic motor yacht cruising the Dalmatian coast, ideal for family charters between Split and the Kornati islands."}',
   32.0, 4, 8, 2019, 95000, 'USD', 4.8, 24),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
   'catamaran', 'published', 'Aegean Horizon', 'aegean-horizon',
   '{"ru": "Устойчивый просторный парусный катамаран, созданный для путешествий по островам Киклад и побережью Икарии.", "en": "A stable, spacious sailing catamaran built for island-hopping the Cyclades and Ikaria coastline."}',
   15.0, 3, 6, 2021, 62000, 'USD', 4.9, 31),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003',
   'expedition', 'published', 'Polar Frontier', 'polar-frontier',
   '{"ru": "Экспедиционное судно ледового класса, оснащённое для научных чартеров и небольших групп в антарктических плаваниях.", "en": "An ice-class expedition vessel outfitted for scientific charters and small-group Antarctic voyages."}',
   82.0, 12, 24, 2016, 180000, 'USD', 5.0, 9),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004',
   'research', 'published', 'Pacific Explorer', 'pacific-explorer',
   '{"ru": "Исследовательское судно, доступное для чартера между экспедициями, оснащённое для морских научных исследований.", "en": "A research vessel available for charter between survey campaigns, equipped for marine science expeditions."}',
   65.0, 10, 20, 2014, 145000, 'USD', 4.7, 17);

-- Vessel images -----------------------------------------------------------

insert into public.vessel_images (vessel_id, url, alt_text, sort_order) values
  ('40000000-0000-0000-0000-000000000001', '/images/vessels/adriatic-breeze.jpg',
   '{"ru": "Белая моторная яхта на бирюзовой воде у побережья Хорватии", "en": "White motor yacht on turquoise water off the Croatian coast"}', 0),
  ('40000000-0000-0000-0000-000000000002', '/images/vessels/aegean-horizon.jpg',
   '{"ru": "Парусный катамаран на якорной стоянке у побережья острова Икария", "en": "Sailing catamaran anchored off the coast of Ikaria island"}', 0),
  ('40000000-0000-0000-0000-000000000003', '/images/vessels/polar-frontier.jpg',
   '{"ru": "Экспедиционное судно ледового класса с оранжевым корпусом в порту", "en": "Ice-class expedition vessel with an orange hull in port"}', 0),
  ('40000000-0000-0000-0000-000000000004', '/images/vessels/pacific-explorer.jpg',
   '{"ru": "Белое исследовательское судно в открытом море, вид сверху", "en": "White research vessel at sea, aerial view"}', 0);

-- Vessel amenities ----------------------------------------------------------

insert into public.vessel_amenities (vessel_id, amenity_id) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000006'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000008'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000007');

-- Initiatives ---------------------------------------------------------------

insert into public.initiatives (id, author_id, title, description, topic, region, activity_type, status, latitude, longitude) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
   'Svalbard polar expedition', 'A team of glaciologists is looking for partners and an ice-class vessel for a July 2027 glacier expedition.',
   'research', 'Arctic', 'research', 'open', 78.22320, 15.62670),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004',
   'Coral reef monitoring', 'Collecting reef health data near the Maldives, certified volunteer divers needed.',
   'science', 'Indian Ocean', 'science', 'open', 4.17550, 73.50930),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
   'Transatlantic crossing', 'Crew wanted for an Atlantic crossing aboard an 18-metre sailing yacht, departing in November.',
   'sailing', 'Gibraltar — Caribbean', 'sailing', 'open', 36.14080, -5.35360);
