-- Only the authenticated Edge Function (service role) may read or write this catalog.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cssmora-proposal-references', 'cssmora-proposal-references', false, 524288, array['application/json'])
on conflict (id) do nothing;
