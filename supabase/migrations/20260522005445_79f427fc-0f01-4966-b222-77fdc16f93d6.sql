
-- Scan sessions
CREATE TABLE public.scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  items_count INTEGER NOT NULL DEFAULT 0,
  actions_summary JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage scan_sessions" ON public.scan_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.scan_session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.scan_sessions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, order_id)
);
ALTER TABLE public.scan_session_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage scan_session_items" ON public.scan_session_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  session_id UUID,
  scanned_value TEXT NOT NULL,
  order_id UUID,
  action TEXT NOT NULL DEFAULT 'scan',
  success BOOLEAN NOT NULL DEFAULT true,
  error_reason TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage scan_logs" ON public.scan_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  old_status_id UUID,
  new_status_id UUID,
  changed_by UUID,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage order_status_history" ON public.order_status_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_scan_session_items_session ON public.scan_session_items(session_id);
CREATE INDEX idx_scan_logs_session ON public.scan_logs(session_id);
CREATE INDEX idx_order_status_history_order ON public.order_status_history(order_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_session_items;
