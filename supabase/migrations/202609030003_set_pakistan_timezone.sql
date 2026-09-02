-- 1. Set database-wide timezone to Pakistan
ALTER DATABASE postgres SET timezone TO 'Asia/Karachi';

-- 2. Reload PgBouncer so the change takes effect immediately
SELECT pg_reload_conf();

-- 3. Verify it's set
SELECT current_setting('timezone') as timezone;
