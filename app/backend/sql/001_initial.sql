CREATE TABLE IF NOT EXISTS review_analyses (
  workspace_id CHAR(36) NOT NULL, input_hash CHAR(64) NOT NULL, report JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(workspace_id,input_hash)
);
CREATE TABLE IF NOT EXISTS workspaces (
  id CHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL, plan ENUM('free','business','growth','enterprise') NOT NULL DEFAULT 'free', created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE IF NOT EXISTS competitor_workspaces (
  workspace_id CHAR(36) PRIMARY KEY, config JSON NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_competitor_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS intelligence_imports (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, dataset JSON NOT NULL,
  imported_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_intelligence_workspace (workspace_id, imported_at),
  CONSTRAINT fk_intelligence_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS businesses (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, google_location_id VARCHAR(255), name VARCHAR(255) NOT NULL, address TEXT NOT NULL, category VARCHAR(255) NOT NULL, owned BOOLEAN NOT NULL, rating DECIMAL(2,1) NOT NULL DEFAULT 0, review_count INT UNSIGNED NOT NULL DEFAULT 0, health TINYINT UNSIGNED NOT NULL DEFAULT 100, status ENUM('healthy','needs_review','critical') NOT NULL DEFAULT 'healthy', last_checked_at TIMESTAMP(6) NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_business_workspace (workspace_id), CONSTRAINT fk_business_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS business_sources (
  business_id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL,
  source_key VARCHAR(255) NOT NULL, dataset_id CHAR(36) NOT NULL, listing_id VARCHAR(255) NOT NULL,
  UNIQUE KEY idx_business_source_identity (workspace_id, source_key),
  CONSTRAINT fk_source_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS incidents (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, business_id CHAR(36) NOT NULL, title VARCHAR(255) NOT NULL, detail TEXT NOT NULL, severity ENUM('critical','warning','info') NOT NULL, status ENUM('open','investigating','resolved') NOT NULL DEFAULT 'open', evidence_count INT UNSIGNED NOT NULL DEFAULT 0, detected_at TIMESTAMP(6) NOT NULL, INDEX idx_incident_workspace_status (workspace_id,status,detected_at), CONSTRAINT fk_incident_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS competitors (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, business_id CHAR(36) NOT NULL, google_place_id VARCHAR(255) NULL, name VARCHAR(255) NOT NULL, rating DECIMAL(2,1) NOT NULL DEFAULT 0, review_count INT UNSIGNED NOT NULL DEFAULT 0, velocity INT NOT NULL DEFAULT 0, risk ENUM('low','medium','high') NOT NULL DEFAULT 'low', shared_signals INT UNSIGNED NOT NULL DEFAULT 0, last_checked_at TIMESTAMP(6) NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_competitor_business (workspace_id,business_id), INDEX idx_competitor_place (google_place_id), CONSTRAINT fk_competitor_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS collection_jobs (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, kind VARCHAR(64) NOT NULL, payload JSON NOT NULL, status ENUM('queued','running','retryable','completed','failed') NOT NULL DEFAULT 'queued', attempts TINYINT UNSIGNED NOT NULL DEFAULT 0, available_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), lease_owner VARCHAR(128), lease_expires_at TIMESTAMP(6), created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX idx_jobs_claim (status,available_at,lease_expires_at)
);
CREATE TABLE IF NOT EXISTS evidence_objects (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, incident_id CHAR(36), blob_key VARCHAR(512) NOT NULL, sha256 CHAR(64) NOT NULL, content_type VARCHAR(120) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_evidence_workspace (workspace_id,created_at)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, paypal_subscription_id VARCHAR(255) UNIQUE, plan VARCHAR(64) NOT NULL, status VARCHAR(64) NOT NULL, current_period_end TIMESTAMP(6) NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  provider VARCHAR(32) NOT NULL, event_id VARCHAR(255) NOT NULL, event_type VARCHAR(128) NOT NULL, payload JSON NOT NULL, processed_at TIMESTAMP(6) NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY(provider,event_id)
);
CREATE TABLE IF NOT EXISTS google_connections (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL UNIQUE, google_subject VARCHAR(255) NOT NULL, email VARCHAR(320) NOT NULL, display_name VARCHAR(255) NOT NULL, access_token_cipher TEXT NOT NULL, refresh_token_cipher TEXT NOT NULL, token_expires_at TIMESTAMP(6) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), CONSTRAINT fk_google_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS profile_snapshots (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, business_id CHAR(36) NOT NULL, snapshot JSON NOT NULL, sha256 CHAR(64) NOT NULL, captured_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_snapshot_business (business_id,captured_at), CONSTRAINT fk_snapshot_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS transaction_evidence (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, business_id CHAR(36) NOT NULL, external_reference_hash CHAR(64) NOT NULL, occurred_at TIMESTAMP(6) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_transaction_business (business_id,occurred_at), CONSTRAINT fk_transaction_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS review_snapshots (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, subject_type ENUM('business','competitor') NOT NULL, subject_id CHAR(36) NOT NULL, rating DECIMAL(2,1) NOT NULL, review_count INT UNSIGNED NOT NULL, captured_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_review_snapshot_subject (subject_type,subject_id,captured_at)
);
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id CHAR(36) PRIMARY KEY, workspace_id CHAR(36) NOT NULL, business_id CHAR(36) NOT NULL, impressions INT UNSIGNED NOT NULL, calls INT UNSIGNED NOT NULL, website_clicks INT UNSIGNED NOT NULL, direction_requests INT UNSIGNED NOT NULL, captured_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_performance_business (business_id,captured_at), CONSTRAINT fk_performance_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS free_audit_usage (
  fingerprint CHAR(64) PRIMARY KEY, used_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE IF NOT EXISTS public_audit_cache (
  query_hash CHAR(64) PRIMARY KEY, result JSON NOT NULL, expires_at TIMESTAMP(6) NOT NULL, updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX idx_audit_cache_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS reporting_workspaces (workspace_id CHAR(36) PRIMARY KEY, state JSON NOT NULL, updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), CONSTRAINT fk_reporting_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS platform_workspaces (workspace_id CHAR(36) PRIMARY KEY, state JSON NOT NULL, updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), CONSTRAINT fk_platform_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
