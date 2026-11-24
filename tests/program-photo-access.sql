-- Run as a database administrator. Evaluate the policies as authenticated
-- users, without uploading any files or changing program or account records.
begin read only;
do $test$
declare
  account record;
  rule record;
  allowed boolean;
begin
  for account in
    select u.id, u.email, true as expected, string_agg(r.role, ',') as label
    from auth.users u join public.cssmora_user_roles r on r.email = lower(u.email)
    where r.is_active
    group by u.id, u.email
    union all
    select gen_random_uuid(), 'unassigned@access-test.invalid', false, 'unassigned'
  loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub',account.id,'email',account.email,'role','authenticated')::text, true);
    set local role authenticated;
    for rule in
      select p.policyname, condition.expression
      from pg_policies p
      cross join lateral (values (p.qual), (p.with_check)) condition(expression)
      where condition.expression is not null and (
        (p.schemaname = 'public' and p.tablename = 'cssmora_program_details'
         and p.policyname = 'CSSMoRA organization roles manage proker details')
        or (p.schemaname = 'storage' and p.tablename = 'objects'
         and p.policyname in ('cssmora_agenda_photo_upload', 'cssmora_agenda_photo_delete',
                              'cssmora_agenda_photo_read_for_management'))
      )
    loop
      execute format('select (%s) from (values (%L::text)) as photo(bucket_id)',
                     rule.expression, 'cssmora-agenda-programs') into allowed;
      if allowed is distinct from account.expected then
        raise exception 'Unexpected result for role % in policy %', account.label, rule.policyname;
      end if;
    end loop;
    reset role;
  end loop;
  if (select count(*) from pg_policies
      where (schemaname = 'public' and tablename = 'cssmora_program_details'
             and policyname = 'CSSMoRA organization roles manage proker details' and cmd = 'ALL')
         or (schemaname = 'storage' and tablename = 'objects' and policyname in
            ('cssmora_agenda_photo_upload', 'cssmora_agenda_photo_delete',
             'cssmora_agenda_photo_read_for_management'))) <> 4 then
    raise exception 'Missing a policy used by the program photo form';
  end if;
end
$test$;
rollback;
