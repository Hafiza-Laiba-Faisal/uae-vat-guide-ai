
-- Revoke broad defaults so only the roles we explicitly grant can call these
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.claim_initial_admin() FROM public, anon;
-- has_role still needs authenticated/service_role for RLS policies + middleware
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_initial_admin() TO authenticated;
