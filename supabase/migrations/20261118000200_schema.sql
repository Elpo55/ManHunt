-- =============================================================================
-- 0200 — Modèle de données principal.
-- Toutes les tables ont des UUID, des timestamps et la RLS activée (cf. 0300).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles : un profil par compte (invité ou permanent). Les statistiques
-- agrégées sont écrites uniquement par le serveur (fin de partie).
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  username          text,
  avatar            text not null default 'orbit:azure',
  is_guest          boolean not null default true,
  is_admin          boolean not null default false,
  games_played      integer not null default 0,
  wins              integer not null default 0,
  losses            integer not null default 0,
  draws             integer not null default 0,
  captures          integer not null default 0,
  times_captured    integer not null default 0,
  survival_seconds  bigint  not null default 0,
  total_score       bigint  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]{2,20}$'
  ),
  constraint profiles_avatar_format check (avatar ~ '^[a-z]{2,12}:[a-z]{2,12}$')
);
create unique index profiles_username_unique on public.profiles (lower(username)) where username is not null;
create index profiles_ranking_idx on public.profiles (wins desc, total_score desc);

-- -----------------------------------------------------------------------------
-- rooms : salon privé identifié par un code d'invitation à 6 caractères
-- (alphabet sans caractères ambigus : pas de I, O, 0, 1).
-- -----------------------------------------------------------------------------
create table public.rooms (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null,
  host_id            uuid not null references public.profiles (id),
  status             text not null default 'lobby',
  config             jsonb not null default '{}'::jsonb,
  allow_team_choice  boolean not null default true,
  max_players        integer not null default 20,
  current_game_id    uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  constraint rooms_name_len check (char_length(name) between 2 and 40),
  constraint rooms_status_check check (status in ('lobby', 'playing', 'results', 'closed')),
  constraint rooms_max_players check (max_players between 2 and 20)
);
create index rooms_host_idx on public.rooms (host_id);
create index rooms_activity_idx on public.rooms (status, last_activity_at);

create table public.room_members (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  team         text,
  is_ready     boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint room_members_team_check check (team is null or team in ('hunter', 'fugitive'))
);
create index room_members_user_idx on public.room_members (user_id);

create table public.room_bans (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- -----------------------------------------------------------------------------
-- abilities : catalogue des capacités (valeurs par défaut). Les paramètres
-- effectifs d'une partie sont figés dans games.config.
-- -----------------------------------------------------------------------------
create table public.abilities (
  key          text primary key,
  team         text not null,
  name         text not null,
  description  text not null,
  targeting    text not null default 'none',
  duration_s   integer not null default 0,
  cooldown_s   integer not null default 60,
  max_uses     integer not null default 0,
  params       jsonb not null default '{}'::jsonb,
  notify       text not null default 'team',
  enabled      boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint abilities_team_check check (team in ('hunter', 'fugitive')),
  constraint abilities_targeting_check check (targeting in ('none', 'cell')),
  constraint abilities_notify_check check (notify in ('team', 'all'))
);

-- -----------------------------------------------------------------------------
-- games : une partie. La configuration et la carte sont figées au démarrage.
-- Machine à états : preparation -> running <-> paused -> finished.
-- -----------------------------------------------------------------------------
create table public.games (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.rooms (id) on delete cascade,
  mode                text not null default 'classic',
  phase               text not null default 'preparation',
  config              jsonb not null,
  map                 jsonb not null,
  seed                bigint not null,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  started_at          timestamptz not null default now(),
  running_at          timestamptz,
  phase_started_at    timestamptz not null default now(),
  phase_ends_at       timestamptz,
  paused_at           timestamptz,
  paused_from         text,
  paused_remaining_ms integer,
  radar_remaining_ms  integer,
  next_radar_at       timestamptz,
  radar_pulse_count   integer not null default 0,
  team_state          jsonb not null default '{}'::jsonb,
  ended_at            timestamptz,
  winner              text,
  end_reason          text,
  -- Champs techniques (non lisibles par les clients, cf. privilèges colonne 0300)
  seq_all             bigint not null default 0,
  seq_hunter          bigint not null default 0,
  seq_fugitive        bigint not null default 0,
  vis_hunter          jsonb not null default '[]'::jsonb,
  vis_fugitive        jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now(),
  constraint games_mode_check check (mode in ('classic', 'infection')),
  constraint games_phase_check check (phase in ('preparation', 'running', 'paused', 'finished')),
  constraint games_paused_from_check check (paused_from is null or paused_from in ('preparation', 'running')),
  constraint games_winner_check check (winner is null or winner in ('hunter', 'fugitive', 'draw')),
  constraint games_end_reason_check check (end_reason is null or end_reason in
    ('all_captured', 'time_up', 'hunters_left', 'fugitives_left', 'aborted', 'no_players'))
);
create index games_room_idx on public.games (room_id, created_at desc);
create index games_phase_idx on public.games (phase) where phase <> 'finished';

alter table public.rooms
  add constraint rooms_current_game_fk foreign key (current_game_id)
  references public.games (id) on delete set null;

-- -----------------------------------------------------------------------------
-- player_states : état autoritaire d'un joueur dans une partie.
-- Les positions des adversaires ne sont JAMAIS lisibles directement (RLS).
-- -----------------------------------------------------------------------------
create table public.player_states (
  game_id          uuid not null references public.games (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  team             text not null,
  initial_team     text not null,
  status           text not null default 'active',
  x                integer not null,
  y                integer not null,
  steps            integer not null default 0,
  steps_at         timestamptz not null default now(),
  ghost_until      timestamptz,
  jam_until        timestamptz,
  boost_until      timestamptz,
  last_move_at     timestamptz,
  last_capture_at  timestamptz,
  captured_at      timestamptz,
  captured_by      uuid references public.profiles (id) on delete set null,
  captures         integer not null default 0,
  distance         integer not null default 0,
  abilities_used   integer not null default 0,
  connected        boolean not null default true,
  last_seen_at     timestamptz not null default now(),
  seq_personal     bigint not null default 0,
  joined_at        timestamptz not null default now(),
  primary key (game_id, user_id),
  constraint player_states_team_check check (team in ('hunter', 'fugitive')),
  constraint player_states_initial_team_check check (initial_team in ('hunter', 'fugitive')),
  constraint player_states_status_check check (status in ('active', 'captured', 'abandoned')),
  constraint player_states_steps_nonneg check (steps >= 0)
);
create index player_states_user_idx on public.player_states (user_id);
create index player_states_team_idx on public.player_states (game_id, team, status);

-- -----------------------------------------------------------------------------
-- game_events : journal append-only, découpé en flux (audiences).
--   stream = 'all' | 'hunter' | 'fugitive' | 'p:<user_id>'
--   sn     = numéro de séquence strictement croissant par (game_id, stream)
-- Sert à l'historique, au journal, à la détection de messages manquants.
-- -----------------------------------------------------------------------------
create table public.game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games (id) on delete cascade,
  stream      text not null,
  sn          bigint not null,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint game_events_stream_check check (stream in ('all', 'hunter', 'fugitive') or stream ~ '^p:[0-9a-f-]{36}$'),
  constraint game_events_seq_unique unique (game_id, stream, sn)
);
create index game_events_game_idx on public.game_events (game_id, id desc);

-- -----------------------------------------------------------------------------
-- ability_usage : chaque activation de capacité (cooldowns, utilisations).
-- -----------------------------------------------------------------------------
create table public.ability_usage (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  team         text not null,
  ability_key  text not null references public.abilities (key),
  used_at      timestamptz not null default now(),
  expires_at   timestamptz,
  target       jsonb,
  result       jsonb,
  constraint ability_usage_team_check check (team in ('hunter', 'fugitive'))
);
create index ability_usage_lookup_idx on public.ability_usage (game_id, user_id, ability_key, used_at desc);

-- -----------------------------------------------------------------------------
-- radar_pulses : résultats radar calculés par le serveur, par équipe.
-- L'index unique (game_id, team, pulse_index) empêche toute double impulsion.
-- -----------------------------------------------------------------------------
create table public.radar_pulses (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id) on delete cascade,
  team         text not null,
  pulse_index  integer not null,
  kind         text not null,
  precision    text not null,
  triggered_by uuid references public.profiles (id) on delete set null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  constraint radar_pulses_team_check check (team in ('hunter', 'fugitive')),
  constraint radar_pulses_kind_check check (kind in ('auto', 'manual')),
  constraint radar_pulses_unique unique (game_id, team, pulse_index)
);

-- -----------------------------------------------------------------------------
-- map_effects : zones dynamiques (ex. case bloquée par la capacité Blocage).
-- -----------------------------------------------------------------------------
create table public.map_effects (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  kind        text not null,
  x           integer not null,
  y           integer not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  constraint map_effects_kind_check check (kind in ('blocked'))
);
create index map_effects_game_idx on public.map_effects (game_id, expires_at);

-- -----------------------------------------------------------------------------
-- game_statistics : résultat individuel figé en fin de partie.
-- -----------------------------------------------------------------------------
create table public.game_statistics (
  game_id           uuid not null references public.games (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  room_id           uuid not null references public.rooms (id) on delete cascade,
  team              text not null,
  initial_team      text not null,
  final_status      text not null,
  outcome           text not null,
  captures          integer not null default 0,
  survival_seconds  integer not null default 0,
  distance          integer not null default 0,
  abilities_used    integer not null default 0,
  score             integer not null default 0,
  counted           boolean not null default true,
  created_at        timestamptz not null default now(),
  primary key (game_id, user_id),
  constraint game_statistics_outcome_check check (outcome in ('win', 'loss', 'draw'))
);
create index game_statistics_user_idx on public.game_statistics (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- saved_game_configs : configurations personnalisées réutilisables.
-- -----------------------------------------------------------------------------
create table public.saved_game_configs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name        text not null,
  config      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint saved_game_configs_name_len check (char_length(name) between 1 and 40),
  constraint saved_game_configs_size check (pg_column_size(config) < 8192),
  constraint saved_game_configs_unique unique (owner_id, name)
);

-- -----------------------------------------------------------------------------
-- Triggers utilitaires
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger rooms_touch before update on public.rooms
  for each row execute function private.touch_updated_at();
create trigger games_touch before update on public.games
  for each row execute function private.touch_updated_at();
create trigger saved_game_configs_touch before update on public.saved_game_configs
  for each row execute function private.touch_updated_at();

-- Limite : 20 configurations sauvegardées par utilisateur.
create or replace function private.limit_saved_configs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.saved_game_configs where owner_id = new.owner_id) >= 20 then
    perform private.fail('E_TOO_MANY_CONFIGS');
  end if;
  return new;
end;
$$;
create trigger saved_game_configs_limit before insert on public.saved_game_configs
  for each row execute function private.limit_saved_configs();

-- Création automatique du profil à l'inscription (invité ou e-mail).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, is_guest)
  values (new.id, coalesce(new.is_anonymous, false))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Passage invité -> compte permanent (liaison d'un e-mail).
create or replace function private.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    update public.profiles set is_guest = false where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function private.handle_user_updated();
