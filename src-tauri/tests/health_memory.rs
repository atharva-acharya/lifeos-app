//! Threat model T16: the caps apply while a Health export is parsed, so a
//! file full of tiny items keeps only the capped number of them and is read
//! in a single pass. The crate forbids `unsafe`, so a counting allocator is
//! not possible here; the kept counts (items that are not kept are never
//! built) and the time stand in for a memory bound.

use std::time::{Duration, Instant};

use lifeos_app_lib::health::{MAX_FILE_BYTES, MAX_POINTS, parse_export};

/// A file near the size limit: one metric whose data list repeats `point`.
fn file_of(point: &str) -> String {
    let head = r#"{"data":{"metrics":[{"name":"step_count","units":"count","data":["#;
    let tail = "]}]}}";
    let each = point.len() + 1;
    let n = (usize::try_from(MAX_FILE_BYTES).expect("fits") - head.len() - tail.len()) / each;
    let mut text = String::with_capacity(head.len() + n * each + tail.len());
    text.push_str(head);
    for i in 0..n {
        if i > 0 {
            text.push(',');
        }
        text.push_str(point);
    }
    text.push_str(tail);
    assert!(u64::try_from(text.len()).expect("fits") <= MAX_FILE_BYTES);
    text
}

fn kept_and_time(text: &str) -> (usize, Duration) {
    let started = Instant::now();
    let export = parse_export(text.as_bytes()).expect("parses");
    (export.point_count("step_count"), started.elapsed())
}

#[test]
fn a_32_mb_file_of_empty_points_keeps_nothing() {
    let (kept, took) = kept_and_time(&file_of("{}"));
    assert_eq!(kept, 0);
    assert!(took < Duration::from_secs(20), "{took:?}");
}

#[test]
fn a_32_mb_file_of_array_valued_points_keeps_nothing() {
    let (kept, took) = kept_and_time(&file_of(r#"{"qty":[0,0,0,0,0,0,0,0,0,0,0,0]}"#));
    assert_eq!(kept, 0);
    assert!(took < Duration::from_secs(20), "{took:?}");
}

#[test]
fn a_32_mb_file_of_dated_points_keeps_only_the_cap() {
    let (kept, took) = kept_and_time(&file_of(r#"{"date":"2026-10-01","qty":1}"#));
    assert_eq!(kept, MAX_POINTS);
    assert!(took < Duration::from_secs(20), "{took:?}");
}
