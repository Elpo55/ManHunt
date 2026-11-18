-- =============================================================================
-- OPTIONNEL — Tâches planifiées côté serveur (pg_cron, inclus dans Supabase).
--
-- Sans ce script, le jeu fonctionne : les échéances sont résolues par les
-- clients (game_tick à l'échéance + heartbeat toutes les 15 s).
-- Avec ce script :
--   * les parties avancent même si TOUS les joueurs ont fermé l'application
--     (fin de partie, abandons après délai de grâce) ;
--   * les vieilles données sont nettoyées chaque nuit.
--
-- Coût : une requête toutes les 15 s, négligeable pour le forfait gratuit.
-- Application : Supabase > SQL Editor > coller ce fichier > Run.
-- Retrait     : select cron.unschedule('pt-tick'); select cron.unschedule('pt-cleanup');
-- =============================================================================

create extension if not exists pg_cron;

create or replace function private.cron_tick_all()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
begin
  for g in select id from public.games where phase in ('preparation', 'running') loop
    begin
      perform private.tick(g.id);
    exception when others then
      raise warning 'tick % : %', g.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke execute on function private.cron_tick_all() from public, anon, authenticated;

select cron.schedule('pt-tick', '15 seconds', $$ select private.cron_tick_all(); $$);
select cron.schedule('pt-cleanup', '17 3 * * *', $$ select private.cleanup(); $$);
