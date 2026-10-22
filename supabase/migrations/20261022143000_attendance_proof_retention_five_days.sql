-- Extend currently stored attendance proofs to five days from upload.
-- New uploads use the matching five-day expiration in attendance-checkin.
update public.secretariat_attendance_records
set proof_expires_at = proof_uploaded_at + interval '5 days'
where proof_path is not null
  and proof_uploaded_at is not null
  and proof_expires_at > now()
  and proof_expires_at < proof_uploaded_at + interval '5 days';
