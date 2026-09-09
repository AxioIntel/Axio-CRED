CREATE TABLE IF NOT EXISTS monitoring_schedules (
  workspace_id CHAR(36) NOT NULL,
  place_id VARCHAR(300) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_hours INT NOT NULL,
  next_due_at DATETIME(6) NULL,
  last_started_at DATETIME(6) NULL,
  last_finished_at DATETIME(6) NULL,
  last_dataset_id CHAR(36) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  last_error VARCHAR(1000) NULL,
  lease_token CHAR(36) NULL,
  lease_until DATETIME(6) NULL,
  PRIMARY KEY (workspace_id, place_id),
  INDEX idx_schedule_due (enabled, next_due_at),
  CONSTRAINT fk_schedule_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT chk_schedule_interval CHECK (interval_hours IN (6,12))
);
