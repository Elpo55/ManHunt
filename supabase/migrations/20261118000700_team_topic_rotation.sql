-- =============================================================================
-- 0700 — Rotation du topic Realtime des Fugitifs (mode Infection).
--
-- Problème : Realtime vérifie l'autorisation d'un canal au moment de
-- l'abonnement. Un Fugitif infecté (devenu Chasseur) qui conserverait
-- volontairement son abonnement au topic Fugitif continuerait à recevoir les
-- déplacements de ses anciens coéquipiers.
--
-- Solution : chaque changement d'équipe Fugitif -> Chasseur incrémente
-- games.fugitive_epoch. Les messages Fugitifs sont alors publiés sur un
-- NOUVEAU topic `game:<id>:fugitive:e<epoch>` que seul un Fugitif actuel
-- peut rejoindre. L'ancien topic ne reçoit plus rien.
-- Les clients Fugitifs reçoivent l'événement public `capture` (infected) et
-- se resynchronisent ; get_game_view indique le topic d'équipe courant.
-- =============================================================================

alter table public.games add column if not exists fugitive_epoch integer not null default 0;

create or replace function private.team_topic(p_game uuid, p_team text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'game:' || p_game::text || ':' || p_team ||
         case when p_team = 'fugitive' and g.fugitive_epoch > 0 then ':e' || g.fugitive_epoch else '' end
    from public.games g where g.id = p_game
$$;

-- Incrément d'époque à chaque passage Fugitif -> Chasseur.
create or replace function private.bump_fugitive_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.team = 'fugitive' and new.team = 'hunter' then
    update public.games set fugitive_epoch = fugitive_epoch + 1 where id = new.game_id;
  end if;
  return new;
end;
$$;

drop trigger if exists player_states_team_epoch on public.player_states;
create trigger player_states_team_epoch
  after update of team on public.player_states
  for each row execute function private.bump_fugitive_epoch();

-- Émission : même logique de séquence, topic d'équipe calculé.
create or replace function private.emit(p_game uuid, p_stream text, p_type text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sn bigint;
  v_audience integer;
  v_now timestamptz := private.now_();
  v_topic text;
begin
  if p_stream = 'all' then
    update public.games set seq_all = seq_all + 1 where id = p_game returning seq_all into v_sn;
    select count(*) into v_audience from public.player_states where game_id = p_game;
    v_topic := 'game:' || p_game::text || ':all';
  elsif p_stream in ('hunter', 'fugitive') then
    if p_stream = 'hunter' then
      update public.games set seq_hunter = seq_hunter + 1 where id = p_game returning seq_hunter into v_sn;
    else
      update public.games set seq_fugitive = seq_fugitive + 1 where id = p_game returning seq_fugitive into v_sn;
    end if;
    select count(*) into v_audience from public.player_states where game_id = p_game and team = p_stream;
    v_topic := private.team_topic(p_game, p_stream);
  elsif p_stream like 'p:%' then
    update public.player_states set seq_personal = seq_personal + 1
     where game_id = p_game and user_id = substr(p_stream, 3)::uuid
     returning seq_personal into v_sn;
    v_audience := 1;
    v_topic := 'game:' || p_game::text || ':' || p_stream;
  end if;

  if v_sn is null then
    perform private.fail('E_INTERNAL', 'unknown stream ' || p_stream);
  end if;

  insert into public.game_events (game_id, stream, sn, type, payload, created_at)
  values (p_game, p_stream, v_sn, p_type, p_payload, v_now);

  perform realtime.send(
    jsonb_build_object('s', p_stream, 'sn', v_sn, 't', p_type, 'd', p_payload, 'at', private.ms(v_now)),
    'ev', v_topic, true);
  perform private.count_usage(0, 1, v_audience);
  return v_sn;
end;
$$;

-- Autorisation : le topic d'équipe doit être le topic COURANT.
create or replace function private.can_access_topic(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id text := split_part(p_topic, ':', 2);
  v_scope text := split_part(p_topic, ':', 3);
  v_target text := split_part(p_topic, ':', 4);
  v_extra text := split_part(p_topic, ':', 5);
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_topic is null or v_id !~ v_uuid_re or v_extra <> '' then
    return false;
  end if;
  if p_write and p_extension <> 'presence' then
    return false;
  end if;

  if v_kind = 'room' and v_scope = '' then
    return private.is_room_member(v_id::uuid, auth.uid());
  end if;

  if v_kind = 'game' then
    if v_scope = 'all' and v_target = '' then
      return private.is_participant(v_id::uuid);
    end if;
    if p_extension = 'presence' then
      return false;
    end if;
    if v_scope in ('hunter', 'fugitive') then
      return private.my_team(v_id::uuid) = v_scope
         and p_topic = private.team_topic(v_id::uuid, v_scope);
    end if;
    if v_scope = 'p' and v_target = auth.uid()::text then
      return private.is_participant(v_id::uuid);
    end if;
  end if;
  return false;
end;
$$;

-- get_game_view expose le topic d'équipe courant.
alter function public.get_game_view(uuid) set schema private;
alter function private.get_game_view(uuid) rename to game_view_base;
revoke execute on function private.game_view_base(uuid) from public, anon, authenticated;

create or replace function public.get_game_view(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view jsonb := private.game_view_base(p_game);
begin
  return v_view || jsonb_build_object('team_topic', private.team_topic(p_game, v_view -> 'me' ->> 'team'));
end;
$$;

revoke execute on function public.get_game_view(uuid) from public, anon;
grant execute on function public.get_game_view(uuid) to authenticated;
revoke execute on function private.team_topic(uuid, text), private.bump_fugitive_epoch() from public, anon;
grant execute on function private.team_topic(uuid, text) to authenticated; -- utilisée par la politique Realtime
