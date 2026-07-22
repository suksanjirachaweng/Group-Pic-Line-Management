/** Shared shape for a PhotoEvent close-out archive bundle — written once by
 * buildEventArchiveData.ts, read back by reimportEventArchive.ts. Every id here is the ORIGINAL
 * database id at archive time, used only to cross-reference rows within this bundle (e.g. which
 * registrant a tag belonged to) — reimport always mints fresh ids and remaps these internally. */

export type ArchivedRegistrant = {
  id: string;
  channelId: string | null;
  lineUserId: string | null;
  isFriend: boolean;
  displayName: string | null;
  data: unknown;
  status: string;
  deliveryStatus: string;
  registeredAt: string;
  createdAt: string;
  updatedAt: string;
  ruleExecutions: {
    id: string;
    ruleId: string;
    status: string;
    attemptedAt: string;
    sentAt: string | null;
    errorDetail: string | null;
  }[];
  messageJobs: {
    id: string;
    channelId: string;
    source: string;
    ruleExecutionId: string | null;
    body: string;
    imageUrl: string | null;
    linkUrl: string | null;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    processedAt: string | null;
  }[];
  messageLogs: {
    id: string;
    channelId: string;
    body: string;
    lineApiResponseStatus: number | null;
    createdAt: string;
  }[];
};

export type ArchivedGroupPhotoTag = {
  id: string;
  code: string;
  normalizedCode: string;
  name: string;
  row: number;
  order: number;
  x: number;
  y: number;
  registrantId: string | null;
  matchSource: string;
  nameOverridden: boolean;
  editedViaPublicLink: boolean;
  publicLinkEditedAt: string | null;
  confirmedViaPublicLink: boolean;
  confirmedAt: string | null;
  reportedProblem: boolean;
  reportedAt: string | null;
  problemAcknowledged: boolean;
  ocrLowConfidence: boolean;
  createdAt: string;
  updatedAt: string;
  history: {
    id: string;
    code: string;
    name: string;
    row: number;
    order: number;
    source: string;
    createdAt: string;
  }[];
};

export type ArchivedGroupPhoto = {
  id: string;
  name: string;
  title: string | null;
  archivedImagePath: string; // relative to the archive prefix, e.g. "images/<id>.jpg"
  imageWidth: number;
  imageHeight: number;
  sortOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  tags: ArchivedGroupPhotoTag[];
  shareLinks: { id: string; token: string; isActive: boolean; createdAt: string }[];
  titleHistory: { id: string; title: string | null; source: string; createdAt: string }[];
  // Just the old imageUrl/width/height/timestamp, not a copy of the file itself — unlike the
  // current image (archivedImagePath, physically copied into this same archive by
  // COPYING_IMAGES), a past version's URL still points at wherever it happened to live on the
  // original storage backend, which isn't guaranteed to survive forever. Accepted tradeoff: see
  // GroupPhotoImageHistory's own schema docstring.
  imageHistory: { id: string; imageUrl: string; imageWidth: number; imageHeight: number; createdAt: string }[];
  autoTagJobs: {
    id: string;
    stage: string;
    tilesTotal: number;
    tilesDone: number;
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
    hits: { id: string; tileIndex: number; code: string; x: number; y: number; confident: boolean }[];
  }[];
};

export type ArchivedLegacyReference = {
  id: string;
  name: string;
  code: string;
  normalizedCode: string;
  phone: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type PhotoEventArchiveBundle = {
  version: 1;
  archivedAt: string;
  photoEvent: {
    id: string;
    universityId: string;
    code: string;
    label: string | null;
    startDate: string;
    endDate: string;
    codeRangeMin: number | null;
    codeRangeMax: number | null;
    createdAt: string;
  };
  registrants: ArchivedRegistrant[];
  groupPhotos: ArchivedGroupPhoto[];
  legacyReferences: ArchivedLegacyReference[];
};
