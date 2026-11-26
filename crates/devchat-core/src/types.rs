use serde::{Deserialize, Serialize};

pub const MAX_TEXT_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_MEMBERS_PER_ROOM: usize = 50;
pub const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

pub type AuthorId = String;
pub type RoomId = String;
pub type Epoch = u32;
pub type Sequence = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HlcTimestamp {
    pub physical_ms: u64,
    pub logical: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceCandidate {
    pub name: String,
    pub description: String,
    pub ipv4: String,
    pub is_up: bool,
    pub is_loopback: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryStage {
    Mdns,
    UdpBroadcast,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DropReason {
    Duplicate,
    WrongRoom,
    InvalidSequence,
    OversizedBody,
    InvalidSignature,
    UnknownAuthor,
    RemovedAuthor,
    StaleEpoch,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCounters {
    pub dropped_duplicate: u64,
    pub dropped_invalid_signature: u64,
    pub dropped_unknown_author: u64,
    pub dropped_removed_author: u64,
    pub dropped_oversized: u64,
    pub dropped_other: u64,
}

impl DiagnosticsCounters {
    pub fn record_drop(&mut self, reason: DropReason) {
        match reason {
            DropReason::Duplicate => self.dropped_duplicate += 1,
            DropReason::InvalidSignature => self.dropped_invalid_signature += 1,
            DropReason::UnknownAuthor => self.dropped_unknown_author += 1,
            DropReason::RemovedAuthor | DropReason::StaleEpoch => self.dropped_removed_author += 1,
            DropReason::OversizedBody => self.dropped_oversized += 1,
            DropReason::WrongRoom | DropReason::InvalidSequence => self.dropped_other += 1,
        }
    }
}
