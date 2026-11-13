-- TestPilot 最小流程数据表。H2(MySQL 模式) 与 MySQL 8 都能执行。
CREATE TABLE IF NOT EXISTS tool_asset (
    id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    tool VARCHAR(32) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    source_json TEXT,
    scenario_key VARCHAR(200),
    request_refs_json TEXT,
    version INT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS task (
    id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    site_id VARCHAR(200),
    environment_id VARCHAR(200),
    tool VARCHAR(32) NOT NULL,
    asset_id VARCHAR(64) NOT NULL,
    asset_version INT NOT NULL,
    status VARCHAR(32) NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    iterations INT NOT NULL,
    delay_request_ms INT NOT NULL,
    timeout_request_ms INT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    started_at VARCHAR(40),
    finished_at VARCHAR(40),
    source_task_id VARCHAR(64),
    idempotency_key VARCHAR(200) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    exit_code INT,
    error_code VARCHAR(64),
    error_message VARCHAR(2000),
    summary_json TEXT,
    metrics_json TEXT,
    report_text TEXT,
    run_dir VARCHAR(1000),
    CONSTRAINT ux_task_idem UNIQUE (idempotency_key),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS task_log (
    task_id VARCHAR(64) NOT NULL,
    seq BIGINT NOT NULL,
    log_time VARCHAR(40) NOT NULL,
    stream VARCHAR(16) NOT NULL,
    text VARCHAR(4000) NOT NULL,
    PRIMARY KEY (task_id, seq)
);

CREATE TABLE IF NOT EXISTS task_result (
    task_id VARCHAR(64) NOT NULL,
    case_order INT NOT NULL,
    case_id VARCHAR(200) NOT NULL,
    name VARCHAR(500) NOT NULL,
    status VARCHAR(32) NOT NULL,
    duration_ms INT,
    status_code INT,
    failure_kind VARCHAR(32),
    failure_message VARCHAR(2000),
    assertions_json TEXT,
    PRIMARY KEY (task_id, case_order)
);

CREATE TABLE IF NOT EXISTS workspace_lock (id INT PRIMARY KEY);
INSERT INTO workspace_lock(id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM workspace_lock WHERE id=1);
CREATE TABLE IF NOT EXISTS workspace_resource (
    kind VARCHAR(40) NOT NULL,
    id VARCHAR(100) NOT NULL,
    revision INT NOT NULL,
    payload MEDIUMTEXT NOT NULL,
    PRIMARY KEY(kind,id)
);

-- 删除过的种子资产记墓碑，避免重启时按 application.yaml 重新插入。
CREATE TABLE IF NOT EXISTS tool_asset_tombstone (
    id VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id)
);
