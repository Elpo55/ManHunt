-- =============================================================================
-- 1040 — Suppression de compte par le joueur lui-même (RGPD, droit à
--         l'effacement) (v0.5.0)
--
-- Efface le compte d'authentification ; par cascade : profil, statistiques,
-- succès, appartenances aux salons, positions, sanctions et avis le concernant.
-- Les salons qu'il héberge passent à un autre membre (ou sont supprimés s'il
-- est seul). Les signalements qu'il a envoyés restent, anonymisés.
-- =============================================================================

create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_next uuid;
begin
  if v_uid is null then perform private.fail('E_NOT_AUTHENTICATED'); end if;
  if p_confirm is distinct from 'SUPPRIMER' then perform private.fail('E_CONFIRMATION_REQUIRED'); end if;
  perform private.rate_limit('delete_account', 3, 3600000);
  if private.my_role() = 'owner' then perform private.fail('E_OWNER_CANNOT_DELETE'); end if;
  if exists (select 1 from public.player_states ps join public.games g on g.id = ps.game_id
              where ps.user_id = v_uid and ps.status = 'active' and g.phase <> 'finished') then
    perform private.fail('E_IN_GAME');
  end if;

  for r in select id from public.rooms where host_id = v_uid for update loop
    select user_id into v_next from public.room_members
     where room_id = r.id and user_id <> v_uid order by joined_at limit 1;
    if v_next is null then
      delete from public.rooms where id = r.id;
    else
      update public.rooms set host_id = v_next where id = r.id;
      perform private.room_emit(r.id, 'host_changed', jsonb_build_object('host_id', v_next));
    end if;
  end loop;

  delete from auth.users where id = v_uid;
end;
$$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
