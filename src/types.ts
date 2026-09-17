export interface Bucket {
  id: string;
  name: string;
  description: string;
  color: string;
  fundCount: number;
  coveredFundCount: number;
  coverageComplete?: boolean;
  latestDate: string | null;
  totalMillionBaht: number | null;
  partialMillionBaht?: number | null;
  previousDate: string | null;
  previousTotalMillionBaht: number | null;
  changeMillionBaht: number | null;
  changePct: number | null;
  history: Array<{ date: string; value: number; fundCount: number }>;
}

export interface Fund {
  code: string;
  bucketId: string;
  bucketName: string;
  group: string | null;
  dataSource: string;
  inceptionDate: string | null;
  latestDate: string | null;
  aumMillionBaht: number | null;
  previousAumMillionBaht: number | null;
  changeMillionBaht: number | null;
  sourceUrl: string | null;
  sparkline: Array<{ date: string; value: number }>;
}

export interface AuaObservation {
  id: string;
  referenceDate: string;
  amountMillionBaht: number;
  announcedAt: string | null;
  discoveredAt: string;
  label: string;
  status: string;
  sources: Array<{ id: string; publisher: string; title: string; url: string; announcedAt: string | null; verificationStatus: string; completenessStatus: string; archived: boolean }>;
}

export interface DashboardData {
  cacheWarning?: string | null;
  appId: string;
  schemaVersion: number;
  generatedAt: string;
  dataVersion: string;
  canonicalStore: string;
  offline?: boolean;
  cachedAt?: string;
  buckets: Bucket[];
  funds: Fund[];
  officialAua: AuaObservation[];
  latestActual: AuaObservation | null;
  projection: { status: string; value: number | null; lower?: number | null; upper?: number | null; intervalLevel?: number; intervalMethod?: string; algorithmVersion?: string; inputFingerprint?: string; extrapolated?: boolean; reason: string | null; asOfDate: string | null; aumDate: string | null; aumMillionBaht: number | null; modelVersion: string; anchorReferenceDate: string | null; anchorAuaMillionBaht: number | null };
  model: { id: string; status: string; reason: string | null; pairCount: number; slope: number | null; intercept: number | null; pearsonR: number | null; rSquared: number | null; createdAt: string; isProvisional: boolean };
  charts: {
    officialAua: AuaObservation[];
    comparison: Array<{ referenceDate: string; aumDate: string; seriesxAum: number; actualAua: number }>;
    timeline: Array<{ date: string; seriesxAum: number | null; projectedAua: number | null; lower?: number | null; upper?: number | null; modelVersion?: string; actualAua: number | null }>;
  };
  sourceStatus: Array<{ id: string; name: string; status: string; checkedAt: string; lastSuccessAt: string | null; message: string | null; url: string }>;
  cautions: string[];
  pendingReviewCount?: number;
}

export interface RefreshJob {
  id: string;
  status: string;
  stage: string;
  stageLabel: string;
  progress: number;
  cursor: number;
  total: number;
  error: string | null;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  requestedAt?: string;
}
