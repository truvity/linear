/**
 * Kanbanize API and Export Types
 *
 * Types for interacting with the Kanbanize (Businessmap) API
 * and for the export/import data structures.
 */

// =============================================================================
// API Response Types (from Kanbanize API)
// =============================================================================

export interface KanbanizeUser {
  user_id: number;
  username: string;
  email?: string;
  realname: string;
  avatar?: string | null;
}

export interface KanbanizeTag {
  tag_id: number;
  label: string;
  color: string; // hex without #, e.g. "eceff1"
}

export interface KanbanizeColumn {
  column_id: number;
  workflow_id: number;
  name: string;
  section: 1 | 2 | 3 | 4 | 5; // 1=Backlog, 2=Requested, 3=Progress, 4=Done, 5=Archive
  position: number;
  parent_column_id: number | null;
  color: string;
}

export interface KanbanizeLane {
  lane_id: number;
  workflow_id: number;
  name: string;
  position: number;
  parent_lane_id: number | null;
  color: string;
}

export interface KanbanizeLinkedCard {
  card_id: number;
  link_type: "parent" | "child" | "predecessor" | "successor" | "relative";
}

export interface KanbanizeAttachment {
  id: number;
  file_name: string;
  link: string;
}

export interface KanbanizeCommentAttachment {
  id: number;
  file_name: string;
  link: string;
}

export interface KanbanizeComment {
  comment_id: number;
  text: string; // HTML format
  type: "plain" | "sent as email" | "received as email";
  author?: {
    type: "internal";
    value: number; // user_id
  };
  created_at: string; // ISO 8601 datetime
  last_modified: string;
  attachments?: KanbanizeCommentAttachment[];
}

export interface KanbanizeCard {
  card_id: number;
  custom_id: string | null;
  board_id: number;
  workflow_id: number;
  title: string;
  description: string; // HTML format
  column_id: number;
  lane_id: number;
  section: number;
  position: number;
  owner_user_id: number | null;
  co_owner_ids?: number[];
  priority: 1 | 2 | 3 | 4 | null; // 1=Critical, 2=High, 3=Average, 4=Low
  size: number | null;
  deadline: string | null; // ISO 8601 datetime
  color: string;
  created_at: string; // ISO 8601 datetime
  last_modified: string;
  first_start_time: string | null;
  first_end_time: string | null;
  tag_ids?: number[];
  linked_cards?: KanbanizeLinkedCard[];
  attachments?: KanbanizeAttachment[];
}

export interface KanbanizeBoard {
  board_id: number;
  name: string;
  workspace_id: number;
  is_archived: 0 | 1;
}

export interface KanbanizeWorkspace {
  workspace_id: number;
  name: string;
  type: 1 | 2; // 1=Team, 2=Management
  is_archived: 0 | 1;
}

// =============================================================================
// Export File Types (stored locally)
// =============================================================================

export interface ExportedAttachment {
  id: number;
  file_name: string;
  original_link: string;
  local_path: string; // relative path in attachments/ directory
}

export interface ExportedCommentAttachment {
  id: number;
  file_name: string;
  local_path: string;
}

export interface ExportedComment {
  comment_id: number;
  text: string; // HTML format
  author_user_id: number;
  created_at: string; // ISO 8601 datetime
  attachments: ExportedCommentAttachment[];
}

export interface ExportedCard {
  // Card identity
  card_id: number;
  custom_id: string | null;
  board_id: number;
  workflow_id: number;

  // Content
  title: string;
  description: string; // HTML format

  // Position
  column_id: number;
  lane_id: number;
  section: number;
  position: number;

  // Assignment
  owner_user_id: number | null;
  co_owner_ids: number[];

  // Metadata
  priority: 1 | 2 | 3 | 4 | null; // 1=Critical, 2=High, 3=Average, 4=Low
  size: number | null;
  deadline: string | null; // ISO 8601 datetime
  color: string;

  // Timestamps
  created_at: string; // ISO 8601 datetime
  last_modified: string;
  first_start_time: string | null;
  first_end_time: string | null;

  // Tags
  tag_ids: number[];

  // Relations (links to other cards)
  linked_cards: KanbanizeLinkedCard[];

  // Attachments (file references stored locally)
  attachments: ExportedAttachment[];

  // Comments
  comments: ExportedComment[];
}

export interface KanbanizeBoardExport {
  // Reference data
  users: Record<number, KanbanizeUser>;
  tags: Record<number, KanbanizeTag>;
  columns: Record<number, KanbanizeColumn>;
  lanes: Record<number, KanbanizeLane>;

  // Cards with their comments
  cards: ExportedCard[];
}

export interface KanbanizeBoardMetadata {
  boardId: number;
  boardName: string;
  workspaceId: number;
  workspaceName: string;
  exportedAt: string; // ISO 8601 datetime
  cardCount: number;
  version: string;
}

// =============================================================================
// API Client Types
// =============================================================================

export interface KanbanizeApiConfig {
  apiKey: string;
  baseUrl: string;
}

export interface PaginatedResponse<T> {
  data: T[];
}

// =============================================================================
// CLI Types
// =============================================================================

export interface ExportOptions {
  boardIds: number[];
  outputDir: string;
}

export interface ImportOptions {
  exportPath: string;
  swimlaneId?: number;
  sections?: number[];
  statusMapping?: Record<string, string>;
}
