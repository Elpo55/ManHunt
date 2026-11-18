-- =============================================================================
-- 0400 — Profils et salons (RPC autoritaires).
--
-- Règle de transfert d'hôte (documentée dans docs/ARCHITECTURE.md) :
--   le nouvel hôte est le membre restant le plus ANCIEN dans le salon
--   (joined_at le plus petit, puis user_id pour départager).
--   En lobby, si l'hôte n'a donné aucun signe de vie depuis 3 minutes,
--   le prochain heartbeat d'un membre actif déclenche ce même transfert.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profil
-- -----------------------------------------------------------------------------
create or replace function public.update_my_profile(p_username text, p_avatar text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_username, ''), '\s+', ' ', 'g'));
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then perform private.fail('E_NOT_AUTHENTICATED'); end if;
  perform private.rate_limit('profile', 20, 60000);

  if v_name !~ '^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]{2,20}$' then
    perform private.fail('E_INVALID_USERNAME');
  end if;
  if p_avatar is not null and p_avatar !~ '^[a-z]{2,12}:[a-z]{2,12}$' then
    perform private.fail('E_INVALID_AVATAR');
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_name) and id <> v_uid) then
    perform private.fail('E_USERNAME_TAKEN');
  end if;

  -- Le profil est normalement créé par le trigger d'inscription ; filet de sécurité :
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  update public.profiles
     set username = v_name,
         avatar = coalesce(p_avatar, avatar)
   where id = v_uid
   returning * into v_profile;

  return to_jsonb(v_profile);
end;
$$;

-- -----------------------------------------------------------------------------
-- Helpers salons
-- -----------------------------------------------------------------------------
create or replace function private.gen_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i integer;
begin
  loop
    v_code := '';
    for i in 1 .. 6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function private.is_room_member(p_room uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.room_members where room_id = p_room and user_id = p_uid)
$$;

-- Diffuse un événement de salon (le client re-synchronise l'état du lobby).
create or replace function private.room_emit(p_room uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience integer;
begin
  select count(*) into v_audience from public.room_members where room_id = p_room;
  perform realtime.send(
    jsonb_build_object('t', p_type, 'd', p_payload, 'at', private.ms(private.now_())),
    'room', 'room:' || p_room::text, true);
  perform private.count_usage(0, 1, v_audience);
  update public.rooms set last_activity_at = private.now_() where id = p_room;
end;
$$;

-- Verrouille le salon et vérifie que l'appelant en est l'hôte.
create or replace function private.lock_room_as_host(p_room uuid)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found or v_room.status = 'closed' then perform private.fail('E_ROOM_NOT_FOUND'); end if;
  if v_room.host_id <> auth.uid() then perform private.fail('E_NOT_HOST'); end if;
  return v_room;
end;
$$;

create or replace function private.require_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.profiles%rowtype;
begin
  if auth.uid() is null then perform private.fail('E_NOT_AUTHENTICATED'); end if;
  select * into v_p from public.profiles where id = auth.uid();
  if not found or v_p.username is null then perform private.fail('E_PROFILE_INCOMPLETE'); end if;
  return v_p;
end;
$$;

-- Transfère l'hôte au membre restant le plus ancien. Retourne le nouvel hôte
-- (null si le salon est vide, auquel cas il est fermé).
create or replace function private.reassign_host(p_room uuid, p_exclude uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
begin
  select user_id into v_new
    from public.room_members
   where room_id = p_room and user_id <> p_exclude
   order by joined_at asc, user_id asc
   limit 1;

  if v_new is null then
    update public.rooms set status = 'closed' where id = p_room;
    return null;
  end if;

  update public.rooms set host_id = v_new where id = p_room;
  perform private.room_emit(p_room, 'host_changed', jsonb_build_object('host_id', v_new));
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC salons
-- -----------------------------------------------------------------------------
create or replace function public.create_room(
  p_name text,
  p_config jsonb default '{}'::jsonb,
  p_max_players integer default 20,
  p_allow_team_choice boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype := private.require_profile();
  v_name text := btrim(coalesce(p_name, ''));
  v_room public.rooms%rowtype;
begin
  perform private.rate_limit('create_room', 5, 60000);
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    perform private.fail('E_INVALID_ROOM_NAME');
  end if;
  if (select count(*) from public.rooms where host_id = v_profile.id and status <> 'closed') >= 3 then
    perform private.fail('E_TOO_MANY_ROOMS');
  end if;

  insert into public.rooms (code, name, host_id, config, max_players, allow_team_choice)
  values (private.gen_room_code(), v_name, v_profile.id, private.normalize_config(p_config),
          greatest(2, least(20, coalesce(p_max_players, 20))), coalesce(p_allow_team_choice, true))
  returning * into v_room;

  insert into public.room_members (room_id, user_id, joined_at, last_seen_at)
  values (v_room.id, v_profile.id, private.now_(), private.now_());
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code);
end;
$$;

create or replace function public.join_room(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype := private.require_profile();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_room public.rooms%rowtype;
  v_count integer;
begin
  perform private.rate_limit('join_room', 10, 60000);
  -- Les échecs sont RETOURNÉS ({"error": ...}) et non levés : une exception
  -- annulerait la transaction, donc aussi l'incrément du compteur anti-bruteforce.
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    return jsonb_build_object('error', 'E_INVALID_CODE');
  end if;

  select * into v_room from public.rooms where code = v_code for update;
  if not found or v_room.status = 'closed' then return jsonb_build_object('error', 'E_ROOM_NOT_FOUND'); end if;

  if exists (select 1 from public.room_members where room_id = v_room.id and user_id = v_profile.id) then
    -- Reconnexion : déjà membre, on retourne simplement le salon.
    update public.room_members set last_seen_at = private.now_() where room_id = v_room.id and user_id = v_profile.id;
    return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'rejoined', true);
  end if;

  if exists (select 1 from public.room_bans where room_id = v_room.id and user_id = v_profile.id) then
    return jsonb_build_object('error', 'E_BANNED');
  end if;
  if v_room.status <> 'lobby' then
    return jsonb_build_object('error', 'E_GAME_IN_PROGRESS');
  end if;
  select count(*) into v_count from public.room_members where room_id = v_room.id;
  if v_count >= v_room.max_players then
    return jsonb_build_object('error', 'E_ROOM_FULL');
  end if;

  insert into public.room_members (room_id, user_id, joined_at, last_seen_at)
  values (v_room.id, v_profile.id, private.now_(), private.now_());
  perform private.room_emit(v_room.id, 'member_joined', jsonb_build_object('user_id', v_profile.id));
  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'rejoined', false);
end;
$$;

create or replace function public.leave_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then perform private.fail('E_ROOM_NOT_FOUND'); end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = v_uid) then
    perform private.fail('E_NOT_MEMBER');
  end if;

  -- Quitter le salon pendant une partie = abandon.
  if v_room.current_game_id is not null then
    perform private.abandon_player(v_room.current_game_id, v_uid, 'left');
  end if;

  delete from public.room_members where room_id = p_room and user_id = v_uid;
  perform private.room_emit(p_room, 'member_left', jsonb_build_object('user_id', v_uid));

  if v_room.host_id = v_uid then
    perform private.reassign_host(p_room, v_uid);
  end if;
end;
$$;

create or replace function public.kick_member(p_room uuid, p_user uuid, p_ban boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
begin
  if p_user = v_room.host_id then perform private.fail('E_CANNOT_KICK_SELF'); end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = p_user) then
    perform private.fail('E_NOT_MEMBER');
  end if;

  if v_room.current_game_id is not null then
    perform private.abandon_player(v_room.current_game_id, p_user, 'kicked');
  end if;

  delete from public.room_members where room_id = p_room and user_id = p_user;
  if p_ban then
    insert into public.room_bans (room_id, user_id, banned_by) values (p_room, p_user, auth.uid())
    on conflict do nothing;
  end if;
  perform private.room_emit(p_room, 'member_kicked', jsonb_build_object('user_id', p_user, 'banned', p_ban));
end;
$$;

create or replace function public.set_member_team(p_room uuid, p_user uuid, p_team text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
begin
  if v_room.status <> 'lobby' then perform private.fail('E_NOT_IN_LOBBY'); end if;
  if p_team is not null and p_team not in ('hunter', 'fugitive') then perform private.fail('E_INVALID_TEAM'); end if;
  update public.room_members set team = p_team, is_ready = false where room_id = p_room and user_id = p_user;
  if not found then perform private.fail('E_NOT_MEMBER'); end if;
  perform private.room_emit(p_room, 'teams_changed');
end;
$$;

create or replace function public.choose_team(p_room uuid, p_team text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  perform private.rate_limit('choose_team', 20, 60000);
  select * into v_room from public.rooms where id = p_room for update;
  if not found or v_room.status = 'closed' then perform private.fail('E_ROOM_NOT_FOUND'); end if;
  if v_room.status <> 'lobby' then perform private.fail('E_NOT_IN_LOBBY'); end if;
  if not v_room.allow_team_choice and v_room.host_id <> auth.uid() then
    perform private.fail('E_TEAM_CHOICE_DISABLED');
  end if;
  if p_team is not null and p_team not in ('hunter', 'fugitive') then perform private.fail('E_INVALID_TEAM'); end if;
  update public.room_members set team = p_team where room_id = p_room and user_id = auth.uid();
  if not found then perform private.fail('E_NOT_MEMBER'); end if;
  perform private.room_emit(p_room, 'teams_changed');
end;
$$;

create or replace function public.auto_assign_teams(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
  v_n integer;
  v_hunters integer;
begin
  if v_room.status <> 'lobby' then perform private.fail('E_NOT_IN_LOBBY'); end if;
  select count(*) into v_n from public.room_members where room_id = p_room;
  if v_n < 2 then perform private.fail('E_NOT_ENOUGH_PLAYERS'); end if;
  v_hunters := greatest(1, least(v_n - 1, round(v_n * coalesce((v_room.config ->> 'hunter_ratio')::numeric, 0.3))::integer));

  with shuffled as (
    select user_id, row_number() over (order by random()) as rn
      from public.room_members where room_id = p_room
  )
  update public.room_members m
     set team = case when s.rn <= v_hunters then 'hunter' else 'fugitive' end,
         is_ready = false
    from shuffled s
   where m.room_id = p_room and m.user_id = s.user_id;

  perform private.room_emit(p_room, 'teams_changed');
end;
$$;

create or replace function public.update_room_settings(
  p_room uuid,
  p_name text default null,
  p_config jsonb default null,
  p_max_players integer default null,
  p_allow_team_choice boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
  v_count integer;
  v_name text := btrim(coalesce(p_name, v_room.name));
begin
  perform private.rate_limit('room_settings', 30, 60000);
  if v_room.status <> 'lobby' then perform private.fail('E_NOT_IN_LOBBY'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then perform private.fail('E_INVALID_ROOM_NAME'); end if;
  select count(*) into v_count from public.room_members where room_id = p_room;
  if p_max_players is not null and (p_max_players < greatest(2, v_count) or p_max_players > 20) then
    perform private.fail('E_INVALID_MAX_PLAYERS');
  end if;

  update public.rooms
     set name = v_name,
         config = case when p_config is null then config else private.normalize_config(p_config) end,
         max_players = coalesce(p_max_players, max_players),
         allow_team_choice = coalesce(p_allow_team_choice, allow_team_choice)
   where id = p_room
   returning * into v_room;

  -- Toute modification des règles invalide les « prêt ».
  update public.room_members set is_ready = false where room_id = p_room;
  perform private.room_emit(p_room, 'settings_changed');
  return v_room.config;
end;
$$;

create or replace function public.transfer_host(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
begin
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = p_user) then
    perform private.fail('E_NOT_MEMBER');
  end if;
  update public.rooms set host_id = p_user where id = p_room;
  perform private.room_emit(p_room, 'host_changed', jsonb_build_object('host_id', p_user));
end;
$$;

create or replace function public.set_ready(p_room uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rate_limit('ready', 30, 60000);
  update public.room_members set is_ready = coalesce(p_ready, false), last_seen_at = private.now_()
   where room_id = p_room and user_id = auth.uid();
  if not found then perform private.fail('E_NOT_MEMBER'); end if;
  perform private.room_emit(p_room, 'ready_changed');
end;
$$;

create or replace function public.room_heartbeat(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := private.now_();
  v_room public.rooms%rowtype;
  v_host_seen timestamptz;
begin
  update public.room_members set last_seen_at = v_now where room_id = p_room and user_id = v_uid;
  if not found then perform private.fail('E_NOT_MEMBER'); end if;
  perform private.count_usage(1, 0, 0);

  select * into v_room from public.rooms where id = p_room;
  if v_room.status = 'lobby' and v_room.host_id <> v_uid then
    select last_seen_at into v_host_seen from public.room_members where room_id = p_room and user_id = v_room.host_id;
    if v_host_seen is null or v_host_seen < v_now - interval '3 minutes' then
      perform 1 from public.rooms where id = p_room for update;
      -- Hôte inactif : on transfère au membre actif le plus ancien.
      update public.rooms r set host_id = sub.user_id
        from (select user_id from public.room_members
               where room_id = p_room and user_id <> v_room.host_id and last_seen_at >= v_now - interval '1 minute'
               order by joined_at asc, user_id asc limit 1) sub
       where r.id = p_room and r.host_id = v_room.host_id;
      if found then
        perform private.room_emit(p_room, 'host_changed', jsonb_build_object('reason', 'inactive'));
      end if;
    end if;
  end if;

  return jsonb_build_object('server_now', private.ms(v_now));
end;
$$;

create or replace function public.get_room_state(p_room uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_game jsonb;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status = 'closed' then perform private.fail('E_ROOM_NOT_FOUND'); end if;
  if not private.is_room_member(p_room, v_uid) then perform private.fail('E_NOT_MEMBER'); end if;

  select jsonb_build_object('id', g.id, 'phase', g.phase, 'winner', g.winner, 'end_reason', g.end_reason,
                            'participant', exists (select 1 from public.player_states ps where ps.game_id = g.id and ps.user_id = v_uid))
    into v_game
    from public.games g where g.id = v_room.current_game_id;

  return jsonb_build_object(
    'server_now', private.ms(private.now_()),
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'name', v_room.name, 'host_id', v_room.host_id,
      'status', v_room.status, 'config', v_room.config, 'allow_team_choice', v_room.allow_team_choice,
      'max_players', v_room.max_players, 'current_game_id', v_room.current_game_id, 'created_at', v_room.created_at),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'username', p.username, 'avatar', p.avatar, 'team', m.team,
               'is_ready', m.is_ready, 'joined_at', m.joined_at, 'last_seen_at', m.last_seen_at,
               'is_host', m.user_id = v_room.host_id, 'is_guest', p.is_guest)
             order by m.joined_at)
        from public.room_members m join public.profiles p on p.id = m.user_id
       where m.room_id = p_room), '[]'::jsonb),
    'game', v_game
  );
end;
$$;

create or replace function public.get_my_rooms()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'code', r.code, 'name', r.name, 'status', r.status,
           'is_host', r.host_id = auth.uid(), 'current_game_id', r.current_game_id,
           'members', (select count(*) from public.room_members m2 where m2.room_id = r.id),
           'last_activity_at', r.last_activity_at)
         order by r.last_activity_at desc), '[]'::jsonb)
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = auth.uid()
   where r.status <> 'closed'
$$;
