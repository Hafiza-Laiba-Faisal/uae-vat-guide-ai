
-- Vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Bootstrap: first authenticated caller can claim admin if no admin exists
CREATE OR REPLACE FUNCTION public.claim_initial_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_exists boolean;
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO admin_exists;
  IF admin_exists THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (caller, 'admin')
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_initial_admin() TO authenticated;

-- FTA documents
CREATE TABLE public.fta_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source_url text,
  source_kind text NOT NULL DEFAULT 'manual', -- 'manual' | 'firecrawl' | 'upload'
  content_hash text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_url)
);

GRANT SELECT ON public.fta_documents TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fta_documents TO authenticated;
GRANT ALL ON public.fta_documents TO service_role;

ALTER TABLE public.fta_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read FTA documents"
  ON public.fta_documents FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert FTA documents"
  ON public.fta_documents FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update FTA documents"
  ON public.fta_documents FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete FTA documents"
  ON public.fta_documents FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- FTA chunks with 1536-dim embeddings (text-embedding-3-small)
CREATE TABLE public.fta_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.fta_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  section text,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fta_chunks TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fta_chunks TO authenticated;
GRANT ALL ON public.fta_chunks TO service_role;

ALTER TABLE public.fta_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read FTA chunks"
  ON public.fta_chunks FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert FTA chunks"
  ON public.fta_chunks FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete FTA chunks"
  ON public.fta_chunks FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX fta_chunks_document_id_idx ON public.fta_chunks (document_id);
CREATE INDEX fta_chunks_embedding_idx ON public.fta_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Search RPC: returns top-k chunks above similarity threshold
CREATE OR REPLACE FUNCTION public.match_fta_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  similarity_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  title text,
  source_url text,
  section text,
  content text,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.title,
    d.source_url,
    c.section,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.fta_chunks c
  JOIN public.fta_documents d ON d.id = c.document_id
  WHERE 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_fta_chunks(vector, int, float) TO anon, authenticated, service_role;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fta_documents_updated_at
  BEFORE UPDATE ON public.fta_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
