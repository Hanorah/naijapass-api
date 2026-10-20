-- NaijaPass MySQL schema (standalone backend)
-- Charset / engine defaults for Ubuntu MySQL 8+

CREATE DATABASE IF NOT EXISTS naijapass
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE naijapass;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  full_name VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  role ENUM('individual', 'business', 'govt', 'admin') NOT NULL DEFAULT 'individual',
  account_status ENUM('pending', 'active', 'suspended', 'rejected') NOT NULL DEFAULT 'pending',
  state VARCHAR(64) NULL,
  lga VARCHAR(128) NULL,
  avatar_url TEXT NULL,
  kyc_status ENUM('unverified', 'pending', 'verified', 'rejected') NOT NULL DEFAULT 'unverified',
  nin_hash VARCHAR(255) NULL,
  bvn_hash VARCHAR(255) NULL,
  business_name VARCHAR(255) NULL,
  business_type VARCHAR(128) NULL,
  cac_number VARCHAR(64) NULL,
  tin VARCHAR(64) NULL,
  govt_state VARCHAR(64) NULL,
  department VARCHAR(255) NULL,
  office_title VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  category VARCHAR(128) NOT NULL,
  description TEXT NULL,
  budget_ngn BIGINT NOT NULL DEFAULT 0,
  budget_label VARCHAR(64) NOT NULL DEFAULT 'TBA',
  state VARCHAR(64) NOT NULL,
  lga VARCHAR(128) NULL,
  status ENUM('In Progress', 'Completed', 'Planned', 'Stalled') NOT NULL DEFAULT 'In Progress',
  contractor VARCHAR(255) NULL,
  completion VARCHAR(64) NULL,
  reports_count INT NOT NULL DEFAULT 0,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  era ENUM('current', 'previous', 'legacy') NOT NULL DEFAULT 'current',
  supervising_agency VARCHAR(255) NULL,
  source_title VARCHAR(512) NULL,
  source_url TEXT NULL,
  image_url TEXT NULL,
  notes TEXT NULL,
  published TINYINT(1) NOT NULL DEFAULT 1,
  submitted_by CHAR(36) NULL,
  review_status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
  start_date DATE NULL,
  expected_completion DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_submitter FOREIGN KEY (submitted_by) REFERENCES profiles (id) ON DELETE SET NULL,
  INDEX idx_projects_state (state),
  INDEX idx_projects_status (status),
  INDEX idx_projects_review (review_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS field_reports (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  title VARCHAR(512) NOT NULL,
  time_label VARCHAR(128) NULL,
  body TEXT NOT NULL,
  location VARCHAR(255) NULL,
  status ENUM('In Progress', 'Delayed', 'Completed', 'Planned') NOT NULL DEFAULT 'In Progress',
  author VARCHAR(255) NULL,
  likes INT NOT NULL DEFAULT 0,
  image_url TEXT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 1,
  state VARCHAR(64) NULL,
  submitted_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_field_reports_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_field_reports_submitter FOREIGN KEY (submitted_by) REFERENCES profiles (id) ON DELETE SET NULL,
  INDEX idx_field_reports_project (project_id),
  INDEX idx_field_reports_state (state)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_feedback (
  id CHAR(36) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  user_id CHAR(36) NULL,
  user_name VARCHAR(255) NULL,
  user_email VARCHAR(255) NULL,
  rating TINYINT NOT NULL,
  topic VARCHAR(128) NULL,
  body TEXT NOT NULL,
  visibility ENUM('public', 'hidden') NOT NULL DEFAULT 'public',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_feedback_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5),
  INDEX idx_feedback_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS businesses (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(128) NOT NULL,
  subcategory VARCHAR(128) NULL,
  state VARCHAR(64) NOT NULL,
  lga VARCHAR(128) NULL,
  address TEXT NULL,
  phone VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  website TEXT NULL,
  description TEXT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  rating DECIMAL(2,1) NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  status ENUM('pending', 'live', 'hidden', 'suspended') NOT NULL DEFAULT 'pending',
  cac_number VARCHAR(64) NULL,
  year_founded VARCHAR(16) NULL,
  employees VARCHAR(64) NULL,
  services JSON NULL,
  image_url MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_businesses_owner FOREIGN KEY (owner_id) REFERENCES profiles (id) ON DELETE SET NULL,
  UNIQUE KEY uq_businesses_owner (owner_id),
  INDEX idx_businesses_state (state),
  INDEX idx_businesses_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS listings (
  id CHAR(36) PRIMARY KEY,
  seller_id CHAR(36) NULL,
  business_id CHAR(36) NULL,
  title VARCHAR(512) NOT NULL,
  category VARCHAR(128) NOT NULL,
  state VARCHAR(64) NOT NULL,
  lga VARCHAR(128) NULL,
  price DECIMAL(18,2) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
  description TEXT NULL,
  status ENUM('pending', 'live', 'hidden', 'sold', 'expired') NOT NULL DEFAULT 'pending',
  image_url TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_listings_seller FOREIGN KEY (seller_id) REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT fk_listings_business FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE SET NULL,
  INDEX idx_listings_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tenders (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  reference VARCHAR(128) NULL UNIQUE,
  mda VARCHAR(255) NULL,
  state VARCHAR(64) NULL,
  sector VARCHAR(128) NULL,
  value DECIMAL(18,2) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
  deadline DATETIME NULL,
  status ENUM('open', 'closed', 'awarded', 'cancelled') NOT NULL DEFAULT 'open',
  description TEXT NULL,
  source VARCHAR(255) NULL,
  published_at DATETIME NULL,
  lga VARCHAR(128) NULL,
  contact_email VARCHAR(255) NULL,
  document_url TEXT NULL,
  submitted_by CHAR(36) NULL,
  publisher_type ENUM('govt', 'business', 'federal') NOT NULL DEFAULT 'govt',
  business_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tenders_submitter FOREIGN KEY (submitted_by) REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT fk_tenders_business FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE SET NULL,
  INDEX idx_tenders_state (state),
  INDEX idx_tenders_deadline (deadline),
  INDEX idx_tenders_publisher (publisher_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tender_bids (
  id CHAR(36) PRIMARY KEY,
  tender_id CHAR(36) NOT NULL,
  bidder_id CHAR(36) NOT NULL,
  business_id CHAR(36) NULL,
  business_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  proposed_amount DECIMAL(18,2) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
  notes TEXT NULL,
  status ENUM('draft', 'submitted', 'withdrawn', 'accepted', 'rejected') NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bids_tender FOREIGN KEY (tender_id) REFERENCES tenders (id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_bidder FOREIGN KEY (bidder_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_business FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE SET NULL,
  UNIQUE KEY uq_tender_bidder (tender_id, bidder_id),
  INDEX idx_bids_tender (tender_id),
  INDEX idx_bids_bidder (bidder_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS state_content (
  id CHAR(36) PRIMARY KEY,
  state VARCHAR(64) NOT NULL,
  type ENUM('law', 'order', 'mda', 'emergency', 'notice', 'announcement', 'service') NOT NULL,
  title VARCHAR(512) NOT NULL,
  body TEXT NULL,
  contact VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  url TEXT NULL,
  category VARCHAR(128) NULL,
  effective_date DATE NULL,
  published TINYINT(1) NOT NULL DEFAULT 1,
  submitted_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_state_content_submitter FOREIGN KEY (submitted_by) REFERENCES profiles (id) ON DELETE SET NULL,
  INDEX idx_state_content_state (state),
  INDEX idx_state_content_type (state, type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kyc_verifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  method ENUM('nin', 'bvn', 'cac', 'tin') NOT NULL,
  status ENUM('pending', 'verified', 'rejected', 'error') NOT NULL DEFAULT 'pending',
  provider VARCHAR(128) NULL,
  provider_ref VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_messages (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  state VARCHAR(64) NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NULL,
  entity_id VARCHAR(128) NULL,
  meta JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES profiles (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Files stored in MySQL (not on disk)
CREATE TABLE IF NOT EXISTS file_uploads (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NULL,
  filename VARCHAR(255) NOT NULL,
  mime VARCHAR(128) NOT NULL,
  size INT NOT NULL,
  data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_file_uploads_owner FOREIGN KEY (owner_id) REFERENCES profiles (id) ON DELETE SET NULL,
  INDEX idx_file_uploads_owner (owner_id)
) ENGINE=InnoDB;
