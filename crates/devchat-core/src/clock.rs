use std::cmp::Ordering;
use crate::types::{HlcTimestamp, Sequence};

pub fn create_clock(now_ms: u64) -> HlcTimestamp {
    HlcTimestamp {
        physical_ms: now_ms,
        logical: 0,
    }
}

pub fn tick_local(prev: HlcTimestamp, now_ms: u64) -> HlcTimestamp {
    if now_ms > prev.physical_ms {
        HlcTimestamp {
            physical_ms: now_ms,
            logical: 0,
        }
    } else {
        HlcTimestamp {
            physical_ms: prev.physical_ms,
            logical: prev.logical.saturating_add(1),
        }
    }
}

pub fn tick_receive(local: HlcTimestamp, remote: HlcTimestamp, now_ms: u64) -> HlcTimestamp {
    let max_phys = now_ms.max(local.physical_ms).max(remote.physical_ms);
    let logical = if max_phys == local.physical_ms && max_phys == remote.physical_ms {
        local.logical.max(remote.logical).saturating_add(1)
    } else if max_phys == local.physical_ms {
        local.logical.saturating_add(1)
    } else if max_phys == remote.physical_ms {
        remote.logical.saturating_add(1)
    } else {
        0
    };
    HlcTimestamp {
        physical_ms: max_phys,
        logical,
    }
}

pub fn compare_hlc(a: HlcTimestamp, b: HlcTimestamp) -> Ordering {
    a.physical_ms
        .cmp(&b.physical_ms)
        .then_with(|| a.logical.cmp(&b.logical))
}

/// Deterministic total message ordering: (hlc.physical_ms, hlc.logical, author_id, sequence).
pub fn compare_message_order(
    a_hlc: HlcTimestamp,
    a_author: &str,
    a_seq: Sequence,
    b_hlc: HlcTimestamp,
    b_author: &str,
    b_seq: Sequence,
) -> Ordering {
    compare_hlc(a_hlc, b_hlc)
        .then_with(|| a_author.cmp(b_author))
        .then_with(|| a_seq.cmp(&b_seq))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hlc_monotonic_under_clock_skew() {
        let c0 = create_clock(10_000);
        let c1 = tick_local(c0, 9_500);
        assert_eq!(c1.physical_ms, 10_000);
        assert_eq!(c1.logical, 1);

        let remote = HlcTimestamp {
            physical_ms: 10_500,
            logical: 4,
        };
        let c2 = tick_receive(c1, remote, 10_200);
        assert_eq!(c2.physical_ms, 10_500);
        assert_eq!(c2.logical, 5);
    }
}
