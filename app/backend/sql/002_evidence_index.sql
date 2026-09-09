-- Additive projection: original intelligence_imports.dataset remains the evidence payload.
CREATE TABLE IF NOT EXISTS evidence_subjects (
  workspace_id CHAR(36) NOT NULL,
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_key TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id),
  CONSTRAINT fk_subject_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS evidence_snapshots (
  workspace_id CHAR(36) NOT NULL,
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dataset_id CHAR(36) NOT NULL,
  listing_id VARCHAR(32) NOT NULL,
  collected_at DATETIME(6) NULL,
  imported_at DATETIME(6) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  reported_count INT UNSIGNED NULL,
  collected_count INT UNSIGNED NOT NULL,
  usable_text_count INT UNSIGNED NOT NULL,
  withheld_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,id),
  UNIQUE KEY uq_snapshot_listing (workspace_id,dataset_id,listing_id),
  KEY idx_subject_history (workspace_id,subject_id,collected_at,imported_at),
  CONSTRAINT fk_snapshot_subject FOREIGN KEY (workspace_id,subject_id) REFERENCES evidence_subjects(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshot_dataset FOREIGN KEY (workspace_id,dataset_id) REFERENCES intelligence_imports(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS review_observations (
  workspace_id CHAR(36) NOT NULL,
  snapshot_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  review_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_review_id TEXT NOT NULL,
  rating DECIMAL(2,1) NULL,
  published_at DATETIME(6) NULL,
  has_text BOOLEAN NOT NULL,
  has_reply BOOLEAN NOT NULL,
  has_capture_issue BOOLEAN NOT NULL,
  PRIMARY KEY (workspace_id,snapshot_id,review_key),
  CONSTRAINT fk_observation_snapshot FOREIGN KEY (workspace_id,snapshot_id) REFERENCES evidence_snapshots(workspace_id,id) ON DELETE CASCADE
);
