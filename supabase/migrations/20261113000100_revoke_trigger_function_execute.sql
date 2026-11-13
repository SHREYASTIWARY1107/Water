-- Trigger-only functions must not be callable through the REST RPC endpoint.
-- (Triggers still fire: EXECUTE is only checked when the trigger is created.)
revoke execute on function public.handle_new_user()             from public, anon, authenticated;
revoke execute on function public.hydration_logs_after_change() from public, anon, authenticated;
revoke execute on function public.profiles_after_goal_change()  from public, anon, authenticated;
revoke execute on function public.hydration_logs_before_write() from public, anon, authenticated;
