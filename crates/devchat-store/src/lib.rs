use std::path::Path;
use devchat_crypto::dpapi::{protect_secret, unprotect_secret};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("crypto error: {0}")]
    Crypto(#[from] devchat_crypto::CryptoError),
    #[error("utf-8 decode error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsSearchHit {
    pub message_id: String,
    pub room_id: String,
    pub author_name: String,
    pub body: String,
}

pub struct LocalStore {
    conn: Connection,
}

impl LocalStore {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> Result<(), StoreError> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS workspace_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                protected_blob BLOB NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message_index (
                message_id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                body TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                message_id UNINDEXED,
                room_id UNINDEXED,
                author_name,
                body
            );
            "#,
        )?;
        Ok(())
    }

    /// Saves the full workspace JSON encrypted via Windows DPAPI on Windows hosts.
    pub fn save_workspace_json(&self, workspace_json: &str, now_ms: i64) -> Result<(), StoreError> {
        let protected = protect_secret(workspace_json.as_bytes())?;
        self.conn.execute(
            r#"
            INSERT INTO workspace_state (id, protected_blob, updated_at_ms)
            VALUES (1, ?1, ?2)
            ON CONFLICT(id) DO UPDATE SET
                protected_blob = excluded.protected_blob,
                updated_at_ms = excluded.updated_at_ms
            "#,
            params![protected, now_ms],
        )?;
        Ok(())
    }

    /// Loads and DPAPI-unprotects the stored workspace JSON, if present.
    pub fn load_workspace_json(&self) -> Result<Option<String>, StoreError> {
        let blob: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT protected_blob FROM workspace_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;

        match blob {
            Some(bytes) => {
                let raw = unprotect_secret(&bytes)?;
                Ok(Some(String::from_utf8(raw)?))
            }
            None => Ok(None),
        }
    }

    /// Indexes a message into the local SQLite FTS5 full-text search index.
    pub fn index_message(
        &self,
        message_id: &str,
        room_id: &str,
        author_name: &str,
        body: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            r#"
            INSERT OR REPLACE INTO message_index (message_id, room_id, author_name, body)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![message_id, room_id, author_name, body],
        )?;
        self.conn.execute(
            "DELETE FROM messages_fts WHERE message_id = ?1",
            params![message_id],
        )?;
        self.conn.execute(
            "INSERT INTO messages_fts (message_id, room_id, author_name, body) VALUES (?1, ?2, ?3, ?4)",
            params![message_id, room_id, author_name, body],
        )?;
        Ok(())
    }

    /// Executes an instant local SQLite FTS5 search within a room.
    pub fn search_room_fts(
        &self,
        room_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<FtsSearchHit>, StoreError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT message_id, room_id, author_name, body
            FROM messages_fts
            WHERE room_id = ?1 AND messages_fts MATCH ?2
            LIMIT ?3
            "#,
        )?;

        let rows = stmt.query_map(params![room_id, query, limit as i64], |row| {
            Ok(FtsSearchHit {
                message_id: row.get(0)?,
                room_id: row.get(1)?,
                author_name: row.get(2)?,
                body: row.get(3)?,
            })
        })?;

        let mut hits = Vec::new();
        for hit in rows {
            hits.push(hit?);
        }
        Ok(hits)
    }

    pub fn clear_workspace(&self) -> Result<(), StoreError> {
        self.conn.execute_batch(
            "DELETE FROM workspace_state; DELETE FROM message_index; DELETE FROM messages_fts;",
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_loads_and_searches_fts5() {
        let store = LocalStore::open_in_memory().unwrap();
        store
            .save_workspace_json(r#"{"theme":"dark"}"#, 1_700_000_000_000)
            .unwrap();
        let loaded = store.load_workspace_json().unwrap().unwrap();
        assert_eq!(loaded, r#"{"theme":"dark"}"#);

        store
            .index_message("a:1", "room-1", "Jaideep", "Compiled Rust SQLite FTS5 index cleanly")
            .unwrap();
        let hits = store.search_room_fts("room-1", "SQLite", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].message_id, "a:1");
    }
}
