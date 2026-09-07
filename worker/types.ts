export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
}

export interface FundRow {
  id: string;
  code: string;
  bucket_id: string;
  bucket_name: string;
  group_name: string | null;
  identifier_type: string | null;
  identifier: string | null;
  data_source: string;
  source_label: string | null;
  inception_date: string | null;
}

export interface AumRow {
  fund_id: string;
  as_of_date: string;
  aum_million_baht: number;
  nav_per_unit: number | null;
  source_url: string | null;
}

export interface AuaRow {
  id: string;
  reference_date: string;
  amount_million_baht: number;
  announced_at: string | null;
  discovered_at: string;
  status: string;
  label: string;
  observation_key: string;
  revision: number;
}

export interface RefreshJobRow {
  id: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  status: string;
  stage: string;
  cursor: number;
  total: number;
  requested_by: string;
  error: string | null;
  result_json: string | null;
}
