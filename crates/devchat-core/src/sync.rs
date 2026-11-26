use std::collections::{BTreeMap, BTreeSet};
use serde::{Deserialize, Serialize};
use crate::types::{AuthorId, RoomId, Sequence};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorLogState {
    pub highest_contiguous: Sequence,
    pub out_of_order: BTreeSet<Sequence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaveSummary {
    pub room_id: RoomId,
    pub authors: BTreeMap<AuthorId, Sequence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantRange {
    pub author_id: AuthorId,
    pub start: Sequence,
    pub end: Sequence,
}

impl AuthorLogState {
    pub fn highest_seen(&self) -> Sequence {
        self.out_of_order
            .iter()
            .next_back()
            .copied()
            .unwrap_or(self.highest_contiguous)
            .max(self.highest_contiguous)
    }

    pub fn has_gaps(&self) -> bool {
        !self.out_of_order.is_empty()
    }
}

/// Records an incoming sequence number for an author and advances highest_contiguous across filled gaps.
/// Returns `true` if newly inserted, `false` if duplicate or invalid (seq == 0).
pub fn record_sequence(state: &mut AuthorLogState, seq: Sequence) -> bool {
    if seq == 0 {
        return false;
    }
    if seq <= state.highest_contiguous || state.out_of_order.contains(&seq) {
        return false;
    }

    state.out_of_order.insert(seq);
    while state
        .out_of_order
        .remove(&(state.highest_contiguous + 1))
    {
        state.highest_contiguous += 1;
    }
    true
}

/// Computes bounded missing `(author_id, start..=end)` ranges given a peer's Have summary.
pub fn compute_wants(
    local_logs: &BTreeMap<AuthorId, AuthorLogState>,
    remote_have: &HaveSummary,
    max_batch: u64,
) -> Vec<WantRange> {
    let mut wants = Vec::new();
    let mut remaining = max_batch;

    for (author_id, &remote_tip) in &remote_have.authors {
        if remaining == 0 {
            break;
        }
        let local = local_logs.get(author_id);
        let start_from = local.map(|l| l.highest_contiguous + 1).unwrap_or(1);
        if start_from > remote_tip {
            continue;
        }

        let mut cursor = start_from;
        while cursor <= remote_tip && remaining > 0 {
            // Skip sequences already stored out-of-order
            while cursor <= remote_tip
                && local.is_some_and(|l| l.out_of_order.contains(&cursor))
            {
                cursor += 1;
            }
            if cursor > remote_tip {
                break;
            }

            let range_start = cursor;
            while cursor <= remote_tip
                && remaining > 0
                && !local.is_some_and(|l| l.out_of_order.contains(&cursor))
            {
                cursor += 1;
                remaining -= 1;
            }
            let range_end = cursor - 1;
            wants.push(WantRange {
                author_id: author_id.clone(),
                start: range_start,
                end: range_end,
            });
        }
    }

    wants
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heals_out_of_order_sequence_gaps() {
        let mut state = AuthorLogState::default();
        assert!(record_sequence(&mut state, 1));
        assert!(record_sequence(&mut state, 3));
        assert_eq!(state.highest_contiguous, 1);
        assert!(state.has_gaps());

        let mut local = BTreeMap::new();
        local.insert("alice".to_string(), state.clone());

        let mut remote_authors = BTreeMap::new();
        remote_authors.insert("alice".to_string(), 4);
        let remote = HaveSummary {
            room_id: "room-1".to_string(),
            authors: remote_authors,
        };

        let wants = compute_wants(&local, &remote, 32);
        assert_eq!(
            wants,
            vec![
                WantRange {
                    author_id: "alice".to_string(),
                    start: 2,
                    end: 2
                },
                WantRange {
                    author_id: "alice".to_string(),
                    start: 4,
                    end: 4
                },
            ]
        );

        assert!(record_sequence(&mut state, 2));
        assert_eq!(state.highest_contiguous, 3);
        assert!(!state.has_gaps());
    }
}
