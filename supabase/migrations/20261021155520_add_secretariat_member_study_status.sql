-- Keep study status separate from the internal attendance eligibility flag.
ALTER TABLE public.secretariat_members
  ADD COLUMN study_status text NOT NULL DEFAULT 'belum_ditentukan'
  CONSTRAINT secretariat_members_study_status_check
  CHECK (study_status IN ('mahasiswa', 'lulus', 'belum_ditentukan'));
