use chrono::{DateTime, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    fs::File,
    io::{self, BufRead, BufReader, BufWriter, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};

const INDEX_VERSION: u32 = 1;
const METADATA_PREFIX_BYTES: usize = 512;
const MAX_METADATA_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
struct TokenUsage {
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
}

impl TokenUsage {
    fn add_assign(&mut self, other: Self) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.cached_input_tokens = self
            .cached_input_tokens
            .saturating_add(other.cached_input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.reasoning_output_tokens = self
            .reasoning_output_tokens
            .saturating_add(other.reasoning_output_tokens);
        self.total_tokens = self.total_tokens.saturating_add(other.total_tokens);
    }

    fn delta_from(self, previous: Self) -> Self {
        let delta = Self {
            input_tokens: counter_delta(self.input_tokens, previous.input_tokens),
            cached_input_tokens: counter_delta(
                self.cached_input_tokens,
                previous.cached_input_tokens,
            ),
            output_tokens: counter_delta(self.output_tokens, previous.output_tokens),
            reasoning_output_tokens: counter_delta(
                self.reasoning_output_tokens,
                previous.reasoning_output_tokens,
            ),
            total_tokens: counter_delta(self.total_tokens, previous.total_tokens),
        };
        if delta.total_tokens == 0 && (delta.input_tokens > 0 || delta.output_tokens > 0) {
            return Self {
                total_tokens: delta.input_tokens.saturating_add(delta.output_tokens),
                ..delta
            };
        }
        delta
    }
}

fn counter_delta(current: u64, previous: u64) -> u64 {
    if current >= previous {
        current - previous
    } else {
        // Resumed and migrated transcripts can restart their cumulative counter.
        current
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct FileUsageIndex {
    observed_len: u64,
    processed_offset: u64,
    modified_millis: u64,
    current_model: String,
    last_total: TokenUsage,
    daily: BTreeMap<String, BTreeMap<String, TokenUsage>>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct UsageIndex {
    version: u32,
    files: BTreeMap<String, FileUsageIndex>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
}

impl ModelUsage {
    fn from_usage(model: String, usage: TokenUsage) -> Self {
        Self {
            model,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            reasoning_output_tokens: usage.reasoning_output_tokens,
            total_tokens: usage.total_tokens,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
    pub session_count: u64,
    pub models: Vec<ModelUsage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub status: String,
    pub generated_at: String,
    pub first_activity_date: Option<String>,
    pub last_activity_date: Option<String>,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
    pub session_count: u64,
    pub active_days: u64,
    pub current_streak: u64,
    pub longest_streak: u64,
    pub indexed_files: u64,
    pub skipped_files: u64,
    pub models: Vec<ModelUsage>,
    pub daily: Vec<DailyUsage>,
}

impl UsageStats {
    fn unavailable() -> Self {
        Self {
            status: "unavailable".into(),
            generated_at: Utc::now().to_rfc3339(),
            first_activity_date: None,
            last_activity_date: None,
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 0,
            session_count: 0,
            active_days: 0,
            current_streak: 0,
            longest_streak: 0,
            indexed_files: 0,
            skipped_files: 0,
            models: Vec::new(),
            daily: Vec::new(),
        }
    }
}

pub fn load_usage_stats(index_path: &Path) -> Result<UsageStats, String> {
    let Some(codex_home) = codex_home() else {
        return Ok(UsageStats::unavailable());
    };
    if !codex_home.is_dir() {
        return Ok(UsageStats::unavailable());
    }

    let mut index = load_index(index_path);
    let mut paths = Vec::new();
    let mut skipped_files = 0_u64;
    for directory in [
        codex_home.join("sessions"),
        codex_home.join("archived_sessions"),
    ] {
        if directory.exists() {
            collect_session_files(&directory, &mut paths, &mut skipped_files);
        }
    }
    paths.sort();
    paths.dedup();

    let mut present = BTreeSet::new();
    for path in paths {
        let Some(key) = file_key(&path) else {
            skipped_files = skipped_files.saturating_add(1);
            continue;
        };
        present.insert(key.clone());
        let previous = index.files.get(&key).cloned().unwrap_or_default();
        let mut next = previous.clone();
        if scan_session_file(&path, &mut next).is_err() {
            skipped_files = skipped_files.saturating_add(1);
            if previous.observed_len == 0 {
                index.files.remove(&key);
            }
            continue;
        }
        index.files.insert(key, next);
    }
    index.files.retain(|key, _| present.contains(key));
    index.version = INDEX_VERSION;

    // A cache failure must not hide valid statistics from the current scan.
    let _ = persist_index(index_path, &index);
    Ok(build_usage_stats(&index, skipped_files))
}

fn codex_home() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
}

fn file_key(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
}

fn collect_session_files(directory: &Path, paths: &mut Vec<PathBuf>, skipped: &mut u64) {
    let Ok(entries) = fs::read_dir(directory) else {
        *skipped = skipped.saturating_add(1);
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            *skipped = skipped.saturating_add(1);
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_session_files(&path, paths, skipped);
        } else if file_type.is_file()
            && path.extension().and_then(|value| value.to_str()) == Some("jsonl")
        {
            paths.push(path);
        }
    }
}

fn load_index(path: &Path) -> UsageIndex {
    let Ok(file) = File::open(path) else {
        return UsageIndex {
            version: INDEX_VERSION,
            files: BTreeMap::new(),
        };
    };
    let Ok(index) = serde_json::from_reader::<_, UsageIndex>(BufReader::new(file)) else {
        return UsageIndex {
            version: INDEX_VERSION,
            files: BTreeMap::new(),
        };
    };
    if index.version != INDEX_VERSION {
        UsageIndex {
            version: INDEX_VERSION,
            files: BTreeMap::new(),
        }
    } else {
        index
    }
}

fn persist_index(path: &Path, index: &UsageIndex) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "failed to create usage index directory")?;
    }
    let temporary = path.with_extension("json.tmp");
    let file = File::create(&temporary).map_err(|_| "failed to create usage index")?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, index).map_err(|_| "failed to serialize usage index")?;
    writer.flush().map_err(|_| "failed to write usage index")?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "failed to replace usage index")?;
    }
    fs::rename(temporary, path).map_err(|_| "failed to commit usage index".into())
}

fn scan_session_file(path: &Path, entry: &mut FileUsageIndex) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    let current_len = metadata.len();
    let current_modified = modified_millis(&metadata);
    if entry.processed_offset == current_len
        && entry.observed_len == current_len
        && entry.modified_millis == current_modified
    {
        return Ok(());
    }

    let can_append = entry.observed_len > 0
        && current_len >= entry.observed_len
        && entry.processed_offset <= entry.observed_len
        && (current_len > entry.observed_len || entry.processed_offset < entry.observed_len);
    if !can_append {
        *entry = FileUsageIndex::default();
    }

    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(entry.processed_offset))?;
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut captured = Vec::with_capacity(4096);
    let mut relevant: Option<bool> = None;
    let mut absolute_offset = entry.processed_offset;

    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        if relevant != Some(false) {
            let chunk = &available[..take];
            let mut copied = 0;
            if relevant.is_none() {
                let probe_remaining = METADATA_PREFIX_BYTES.saturating_sub(captured.len());
                copied = probe_remaining.min(chunk.len());
                captured.extend_from_slice(&chunk[..copied]);
                if captured.len() >= METADATA_PREFIX_BYTES || newline.is_some() {
                    let is_relevant = is_metadata_line(&captured);
                    relevant = Some(is_relevant);
                    if !is_relevant {
                        captured.clear();
                    }
                }
            }
            if relevant == Some(true) && copied < chunk.len() {
                let remaining = MAX_METADATA_LINE_BYTES.saturating_sub(captured.len());
                let tail = &chunk[copied..];
                if tail.len() <= remaining {
                    captured.extend_from_slice(tail);
                } else {
                    captured.clear();
                    relevant = Some(false);
                }
            }
        }
        reader.consume(take);
        absolute_offset = absolute_offset.saturating_add(take as u64);
        if newline.is_some() {
            if relevant == Some(true) {
                process_metadata_line(&captured, entry);
            }
            captured.clear();
            relevant = None;
            entry.processed_offset = absolute_offset;
        }
    }

    let final_metadata = fs::metadata(path)?;
    entry.observed_len = final_metadata.len();
    entry.modified_millis = modified_millis(&final_metadata);
    Ok(())
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn process_metadata_line(line: &[u8], entry: &mut FileUsageIndex) {
    let Ok(record) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    let record_type = record
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let payload = record.get("payload").unwrap_or(&Value::Null);
    if record_type == "turn_context" || record_type == "session_meta" {
        if let Some(model) = payload.get("model").and_then(Value::as_str) {
            if !model.trim().is_empty() {
                entry.current_model = model.trim().to_string();
            }
        }
        return;
    }
    if record_type != "event_msg"
        || payload.get("type").and_then(Value::as_str) != Some("token_count")
    {
        return;
    }
    let Some(total) = payload
        .get("info")
        .and_then(|info| info.get("total_token_usage"))
        .map(parse_token_usage)
    else {
        return;
    };
    let delta = total.delta_from(entry.last_total);
    entry.last_total = total;
    if delta.total_tokens == 0 {
        return;
    }
    let Some(date) = record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(local_date)
    else {
        return;
    };
    let model = if entry.current_model.trim().is_empty() {
        "unknown"
    } else {
        entry.current_model.as_str()
    };
    entry
        .daily
        .entry(date)
        .or_default()
        .entry(model.to_string())
        .or_default()
        .add_assign(delta);
}

fn is_metadata_line(prefix: &[u8]) -> bool {
    contains_bytes(prefix, b"turn_context")
        || contains_bytes(prefix, b"session_meta")
        || contains_bytes(prefix, b"token_count")
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|candidate| candidate == needle)
}

fn parse_token_usage(value: &Value) -> TokenUsage {
    TokenUsage {
        input_tokens: value
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cached_input_tokens: value
            .get("cached_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        output_tokens: value
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        reasoning_output_tokens: value
            .get("reasoning_output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        total_tokens: value
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

fn local_date(timestamp: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

fn build_usage_stats(index: &UsageIndex, skipped_files: u64) -> UsageStats {
    let mut daily: BTreeMap<String, (TokenUsage, u64, BTreeMap<String, TokenUsage>)> =
        BTreeMap::new();
    let mut session_count = 0_u64;

    for file in index.files.values() {
        let mut session_has_usage = false;
        for (date, models) in &file.daily {
            let day_total = models
                .values()
                .fold(TokenUsage::default(), |mut total, usage| {
                    total.add_assign(*usage);
                    total
                });
            if day_total.total_tokens == 0 {
                continue;
            }
            session_has_usage = true;
            let target = daily.entry(date.clone()).or_default();
            target.0.add_assign(day_total);
            target.1 = target.1.saturating_add(1);
            for (model, usage) in models {
                target
                    .2
                    .entry(model.clone())
                    .or_default()
                    .add_assign(*usage);
            }
        }
        if session_has_usage {
            session_count = session_count.saturating_add(1);
        }
    }

    let active_dates: Vec<NaiveDate> = daily
        .keys()
        .filter_map(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        .collect();
    let (current_streak, longest_streak) = streaks(&active_dates, Local::now().date_naive());
    let first_activity_date = daily.keys().next().cloned();
    let last_activity_date = daily.keys().next_back().cloned();
    let mut overall = TokenUsage::default();
    let mut overall_models: BTreeMap<String, TokenUsage> = BTreeMap::new();
    let mut daily_rows = Vec::with_capacity(daily.len());

    for (date, (usage, sessions, model_map)) in daily {
        overall.add_assign(usage);
        let mut models: Vec<ModelUsage> = model_map
            .into_iter()
            .map(|(model, model_usage)| {
                overall_models
                    .entry(model.clone())
                    .or_default()
                    .add_assign(model_usage);
                ModelUsage::from_usage(model, model_usage)
            })
            .collect();
        models.sort_by(|left, right| right.total_tokens.cmp(&left.total_tokens));
        daily_rows.push(DailyUsage {
            date,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            reasoning_output_tokens: usage.reasoning_output_tokens,
            total_tokens: usage.total_tokens,
            session_count: sessions,
            models,
        });
    }

    let mut models: Vec<ModelUsage> = overall_models
        .into_iter()
        .map(|(model, usage)| ModelUsage::from_usage(model, usage))
        .collect();
    models.sort_by(|left, right| right.total_tokens.cmp(&left.total_tokens));

    UsageStats {
        status: if overall.total_tokens > 0 {
            "ok"
        } else {
            "empty"
        }
        .into(),
        generated_at: Utc::now().to_rfc3339(),
        first_activity_date,
        last_activity_date,
        input_tokens: overall.input_tokens,
        cached_input_tokens: overall.cached_input_tokens,
        output_tokens: overall.output_tokens,
        reasoning_output_tokens: overall.reasoning_output_tokens,
        total_tokens: overall.total_tokens,
        session_count,
        active_days: active_dates.len() as u64,
        current_streak,
        longest_streak,
        indexed_files: index.files.len() as u64,
        skipped_files,
        models,
        daily: daily_rows,
    }
}

fn streaks(active_dates: &[NaiveDate], today: NaiveDate) -> (u64, u64) {
    if active_dates.is_empty() {
        return (0, 0);
    }
    let mut longest = 1_u64;
    let mut run = 1_u64;
    for dates in active_dates.windows(2) {
        if dates[1].signed_duration_since(dates[0]).num_days() == 1 {
            run = run.saturating_add(1);
            longest = longest.max(run);
        } else {
            run = 1;
        }
    }
    let last = *active_dates.last().unwrap_or(&today);
    if today.signed_duration_since(last).num_days() > 1 {
        return (0, longest);
    }
    let mut current = 1_u64;
    for dates in active_dates.windows(2).rev() {
        if dates[1].signed_duration_since(dates[0]).num_days() == 1 {
            current = current.saturating_add(1);
        } else {
            break;
        }
    }
    (current, longest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;

    fn token_line(timestamp: &str, input: u64, output: u64, total: u64) -> Vec<u8> {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": input,
                        "cached_input_tokens": 0,
                        "output_tokens": output,
                        "reasoning_output_tokens": 0,
                        "total_tokens": total
                    }
                }
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn cumulative_events_are_deduplicated_and_attributed_to_the_active_model() {
        let mut entry = FileUsageIndex::default();
        process_metadata_line(
            br#"{"type":"turn_context","payload":{"model":"gpt-5.4"}}"#,
            &mut entry,
        );
        process_metadata_line(&token_line("2026-07-10T12:00:00Z", 90, 10, 100), &mut entry);
        process_metadata_line(&token_line("2026-07-10T12:00:01Z", 90, 10, 100), &mut entry);
        process_metadata_line(
            &token_line("2026-07-10T12:00:02Z", 150, 20, 170),
            &mut entry,
        );

        let usage = entry.daily.values().next().unwrap().get("gpt-5.4").unwrap();
        assert_eq!(usage.input_tokens, 150);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.total_tokens, 170);
    }

    #[test]
    fn restarted_cumulative_counter_starts_a_new_segment() {
        let mut entry = FileUsageIndex::default();
        process_metadata_line(
            br#"{"type":"turn_context","payload":{"model":"gpt-5.4"}}"#,
            &mut entry,
        );
        process_metadata_line(&token_line("2026-07-10T12:00:00Z", 90, 10, 100), &mut entry);
        process_metadata_line(&token_line("2026-07-10T12:01:00Z", 25, 5, 30), &mut entry);
        let usage = entry.daily.values().next().unwrap().get("gpt-5.4").unwrap();
        assert_eq!(usage.total_tokens, 130);
    }

    #[test]
    fn streaks_keep_yesterdays_run_current_but_expire_older_runs() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
        let dates = vec![
            NaiveDate::from_ymd_opt(2026, 7, 10).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 11).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 12).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 14).unwrap(),
        ];
        assert_eq!(streaks(&dates, today), (1, 3));
        assert_eq!(streaks(&dates[..3], today), (0, 3));
    }

    #[test]
    fn file_index_only_processes_appended_bytes() {
        let path = std::env::temp_dir().join(format!(
            "codex-halo-usage-index-test-{}-{}.jsonl",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let mut initial = br#"{"type":"turn_context","payload":{"model":"gpt-5.4"}}"#.to_vec();
        initial.push(b'\n');
        initial.extend(token_line("2026-07-10T12:00:00Z", 90, 10, 100));
        initial.push(b'\n');
        fs::write(&path, initial).unwrap();

        let mut index = FileUsageIndex::default();
        scan_session_file(&path, &mut index).unwrap();
        let first_total = index
            .daily
            .values()
            .next()
            .unwrap()
            .get("gpt-5.4")
            .unwrap()
            .total_tokens;
        assert_eq!(first_total, 100);

        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(&token_line("2026-07-10T12:01:00Z", 150, 20, 170))
            .unwrap();
        file.write_all(b"\n").unwrap();
        file.flush().unwrap();
        scan_session_file(&path, &mut index).unwrap();
        scan_session_file(&path, &mut index).unwrap();

        let final_total = index
            .daily
            .values()
            .next()
            .unwrap()
            .get("gpt-5.4")
            .unwrap()
            .total_tokens;
        assert_eq!(final_total, 170);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn truncated_file_rebuilds_the_cached_aggregate() {
        let path = std::env::temp_dir().join(format!(
            "codex-halo-usage-truncation-test-{}-{}.jsonl",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let mut initial = br#"{"type":"turn_context","payload":{"model":"gpt-5.4"}}"#.to_vec();
        initial.push(b'\n');
        initial.extend(token_line("2026-07-10T12:00:00Z", 90, 10, 100));
        initial.push(b'\n');
        initial.extend(std::iter::repeat_n(b'x', 2048));
        fs::write(&path, initial).unwrap();

        let mut index = FileUsageIndex::default();
        scan_session_file(&path, &mut index).unwrap();
        assert_eq!(
            index
                .daily
                .values()
                .next()
                .unwrap()
                .get("gpt-5.4")
                .unwrap()
                .total_tokens,
            100
        );

        let mut replacement = br#"{"type":"turn_context","payload":{"model":"gpt-5.4"}}"#.to_vec();
        replacement.push(b'\n');
        replacement.extend(token_line("2026-07-10T12:01:00Z", 25, 5, 30));
        replacement.push(b'\n');
        fs::write(&path, replacement).unwrap();
        scan_session_file(&path, &mut index).unwrap();

        assert_eq!(
            index
                .daily
                .values()
                .next()
                .unwrap()
                .get("gpt-5.4")
                .unwrap()
                .total_tokens,
            30
        );
        let _ = fs::remove_file(path);
    }
}
