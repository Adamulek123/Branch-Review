//! Read-only, library-first Git branch comparison backend.

pub mod commands;
pub mod error;
pub mod git;
pub mod model;
pub mod security;
pub mod service;

pub use commands::Backend;
pub use error::{AppError, ErrorCode, FrontendError, Result};
pub use model::*;
pub use security::repository_path_identity;
pub use service::{RepositoryRegistry, RepositoryUpdate};
