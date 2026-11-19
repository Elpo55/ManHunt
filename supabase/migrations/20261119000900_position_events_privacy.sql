-- =============================================================================
-- 0900 — Confidentialité des événements porteurs de position (v0.3.0)
--
-- Problème corrigé : les événements Realtime sont aussi journalisés dans
-- public.game_events. Une fois la partie terminée, la politique de lecture
-- ouvrait TOUS les flux à tous les participants, y compris les positions
-- (arrondies) des coéquipiers et adversaires adverses, et ces lignes étaient
-- conservées 30 jours — en contradiction avec la promesse affichée
-- (« positions effacées 24 h après la partie », « arrêt = positions effacées »).
--
-- Après cette migration :
--   * après la partie, seuls les événements SANS position des autres flux
--     restent lisibles (captures, statuts, phases, fin…) ;
--   * les événements porteurs de position sont effacés 24 h après la partie
--     (comme les positions brutes) ;
--   * l'arrêt de sécurité / quitter la partie efface aussi les événements de
--     position du joueur.
-- =============================================================================

create or replace function private.is_positional_event(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('pos', 'enemy_pos', 'move', 'reveal', 'radar', 'tracker', 'sonar', 'vis', 'map_effect');
$$;
revoke execute on function private.is_positional_event(text) from public, anon;
grant execute on function private.is_positional_event(text) to authenticated;

drop policy if exists game_events_read on public.game_events;
create policy game_events_read on public.game_events
  for select to authenticated using (
    private.is_participant(game_id) and (
      stream = 'all'
      or stream = private.my_team(game_id)
      or stream = 'p:' || (select auth.uid())::text
      or (private.game_finished(game_id) and not private.is_positional_event(type))
    )
  );

-- Effacement des positions d'un joueur (arrêt de sécurité, départ) :
-- positions brutes + événements de position qui le concernent.
create or replace function private.erase_positions(p_game uuid, p_user uuid)
returns void language sql security definer set search_path = ''
as $$
  delete from private.player_positions where game_id = p_game and user_id = p_user;
  delete from private.position_history where game_id = p_game and user_id = p_user;
  delete from public.game_events
   where game_id = p_game and type in ('pos', 'enemy_pos', 'move') and payload ->> 'u' = p_user::text;
$$;
revoke execute on function private.erase_positions(uuid, uuid) from public, anon, authenticated;

-- Rétention : événements de position effacés 24 h après la partie.
create or replace function private.cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer; v_pos_events integer; v_rooms integer; v_games integer; v_positions integer;
begin
  with stale as (
    select id from public.games where phase <> 'finished' and updated_at < private.now_() - interval '6 hours'
  )
  update public.games g set phase = 'finished', winner = 'draw', end_reason = 'aborted', ended_at = private.now_()
    from stale where g.id = stale.id;
  get diagnostics v_games = row_count;

  delete from private.position_history h using public.games g
   where h.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours';
  get diagnostics v_positions = row_count;
  delete from private.player_positions p using public.games g
   where p.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours';

  delete from public.game_events e using public.games g
   where e.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours'
     and private.is_positional_event(e.type);
  get diagnostics v_pos_events = row_count;

  delete from public.game_events e using public.games g
   where e.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '30 days';
  get diagnostics v_events = row_count;

  update public.rooms set status = 'closed'
   where status <> 'closed' and last_activity_at < private.now_() - interval '7 days';
  get diagnostics v_rooms = row_count;
  delete from private.rate_limits where window_start < private.now_() - interval '1 day';
  return jsonb_build_object('games_closed', v_games, 'positions_deleted', v_positions,
                            'events_deleted', v_events + v_pos_events, 'position_events_deleted', v_pos_events,
                            'rooms_closed', v_rooms);
end;
$$;
revoke execute on function private.cleanup() from public, anon, authenticated;
