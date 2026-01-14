/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import type { Comment, Importer, ImportResult, IssuePriority, IssueStatus } from "../../types.ts";
import { htmlToMarkdown } from "../../utils/htmlToMarkdown.ts";
import type {
  ExportedCard,
  ImportOptions,
  KanbanizeBoardExport,
  KanbanizeBoardMetadata,
  KanbanizeColumn,
  KanbanizeLinkedCard,
} from "../../kanbanize/types.ts";

// Base URL for Kanbanize card links
const KANBANIZE_BASE_URL = "https://truvity.kanbanize.com";

/**
 * Section to Linear IssueStatus mapping
 */
const SECTION_TO_STATUS_TYPE: Record<number, IssueStatus> = {
  1: "backlog", // Backlog
  2: "unstarted", // Requested
  3: "started", // Progress
  4: "completed", // Done
  5: "completed", // Archive (completed + archived)
};

/**
 * Kanbanize priority to Linear priority mapping
 * Kanbanize: 1=Critical, 2=High, 3=Average, 4=Low
 * Linear: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=No priority
 */
const PRIORITY_MAP: Record<number, IssuePriority> = {
  1: 1, // Critical -> Urgent
  2: 2, // High -> High
  3: 3, // Average -> Medium
  4: 4, // Low -> Low
};

/**
 * Import issues from Kanbanize JSON export
 */
export class KanbanizeImporter implements Importer {
  private exportPath: string;
  private swimlaneIds?: number[];
  private sections?: number[];
  private statusMapping?: Record<string, string>;
  private exportData!: KanbanizeBoardExport;
  private metadata!: KanbanizeBoardMetadata;
  private migratedCardIds: Set<number> = new Set();

  public constructor(options: ImportOptions) {
    this.exportPath = options.exportPath;
    this.swimlaneIds = options.swimlaneIds;
    this.sections = options.sections;
    this.statusMapping = options.statusMapping;
  }

  public get name(): string {
    return "Kanbanize";
  }

  public get defaultTeamName(): string {
    return this.metadata?.boardName || "Kanbanize";
  }

  /**
   * Load and parse the export files
   */
  private loadExportData(): void {
    const exportFilePath = path.join(this.exportPath, "export.json");
    const metadataFilePath = path.join(this.exportPath, "metadata.json");

    if (!fs.existsSync(exportFilePath)) {
      throw new Error(`Export file not found: ${exportFilePath}`);
    }

    if (!fs.existsSync(metadataFilePath)) {
      throw new Error(`Metadata file not found: ${metadataFilePath}`);
    }

    this.exportData = JSON.parse(fs.readFileSync(exportFilePath, "utf-8"));
    this.metadata = JSON.parse(fs.readFileSync(metadataFilePath, "utf-8"));
  }

  /**
   * Filter cards based on swimlanes and sections
   */
  private filterCards(cards: ExportedCard[]): ExportedCard[] {
    return cards.filter(card => {
      // Filter by swimlanes if specified
      if (this.swimlaneIds && this.swimlaneIds.length > 0 && !this.swimlaneIds.includes(card.lane_id)) {
        return false;
      }

      // Filter by sections if specified
      if (this.sections && this.sections.length > 0) {
        const column = this.exportData.columns[card.column_id];
        if (!column || !this.sections.includes(column.section)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get the status name for a card
   */
  private getStatusName(card: ExportedCard): string {
    const column = this.exportData.columns[card.column_id];
    if (!column) {
      return "Unknown";
    }

    // Use custom status mapping if provided
    let statusName = this.statusMapping?.[column.name] || column.name;

    // Linear has a 30-character limit for workflow state names
    if (statusName.length > 30) {
      statusName = statusName.substring(0, 30);
    }

    return statusName;
  }

  /**
   * Get the status type for a card
   */
  private getStatusType(card: ExportedCard): IssueStatus {
    const column = this.exportData.columns[card.column_id];
    if (!column) {
      return "backlog";
    }
    return SECTION_TO_STATUS_TYPE[column.section] || "backlog";
  }

  /**
   * Check if a linked card can be natively linked (same board and being migrated)
   */
  private canBeNativelyLinked(link: KanbanizeLinkedCard): boolean {
    const linkedBoardId = link.board_id || this.metadata.boardId;
    const isSameBoard = linkedBoardId === this.metadata.boardId;
    const isMigrated = this.migratedCardIds.has(link.card_id);
    return isSameBoard && isMigrated;
  }

  /**
   * Extract native relationship IDs for all Kanbanize link types
   */
  private extractNativeRelationships(card: ExportedCard): {
    parentIds: string[];
    childIds: string[];
    relatedIds: string[];
    predecessorIds: string[];
    successorIds: string[];
  } {
    const parentIds: string[] = [];
    const childIds: string[] = [];
    const relatedIds: string[] = [];
    const predecessorIds: string[] = [];
    const successorIds: string[] = [];

    if (!card.linked_cards || card.linked_cards.length === 0) {
      return { parentIds, childIds, relatedIds, predecessorIds, successorIds };
    }

    for (const link of card.linked_cards) {
      if (!this.canBeNativelyLinked(link)) {
        continue;
      }

      // Map all Kanbanize relationship types to Linear relationships
      const linkId = String(link.card_id);

      switch (link.link_type) {
        case "parent":
          // Parent relationship - current card becomes sub-issue of parent in Linear
          parentIds.push(linkId);
          break;
        case "child":
          // Child relationship - will be linked as sub-issue in Linear
          childIds.push(linkId);
          break;
        case "relative":
          // Relative relationship - maps directly to Linear's 'related'
          relatedIds.push(linkId);
          break;
        case "predecessor":
          // Predecessor blocks this card - will be linked as 'blocks' in Linear
          predecessorIds.push(linkId);
          break;
        case "successor":
          // This card blocks successor - will be linked as 'blocks' in Linear
          successorIds.push(linkId);
          break;
        default:
          // Unknown link type - skip it
          break;
      }
    }

    return { parentIds, childIds, relatedIds, predecessorIds, successorIds };
  }

  /**
   * Build the relations section for a card's description
   * Includes all relations with markers indicating which are natively linked
   */
  private buildRelationsSection(card: ExportedCard): string {
    if (!card.linked_cards || card.linked_cards.length === 0) {
      return "";
    }

    const relationsByType: Record<string, KanbanizeLinkedCard[]> = {
      parent: [],
      child: [],
      predecessor: [],
      successor: [],
      relative: [],
    };

    // Group all relations by type
    for (const link of card.linked_cards) {
      if (relationsByType[link.link_type]) {
        relationsByType[link.link_type].push(link);
      }
    }

    const sections: string[] = [];

    // Build section for each relation type that has entries
    const typeLabels: Record<string, string> = {
      parent: "Parents",
      child: "Children",
      predecessor: "Predecessors",
      successor: "Successors",
      relative: "Related",
    };

    for (const [type, relations] of Object.entries(relationsByType)) {
      if (relations.length === 0) {
        continue;
      }

      const label = typeLabels[type];
      const items = relations.map(link => {
        // Use enriched data from linked card if available (for cross-board references)
        const title = link.title || `Card #${link.card_id}`;

        // Use the linked card's board_id if available, otherwise use current board
        const linkedBoardId = link.board_id || this.metadata.boardId;
        const url = `${KANBANIZE_BASE_URL}/ctrl_board/${linkedBoardId}/cards/${link.card_id}`;

        const canBeNative = this.canBeNativelyLinked(link);
        const isMigrated = this.migratedCardIds.has(link.card_id);

        // Determine the appropriate marker
        let marker = "*(not migrated)*";
        if (canBeNative) {
          marker = "*(natively linked)*";
        } else if (isMigrated) {
          marker = "*(migrated, not linked)*";
        }

        const kanbanizeId = `kn-${link.card_id}`;

        // Get the status (column name) - use enriched data if available
        let statusInfo = "";
        if (link.column_name) {
          statusInfo = ` [${link.column_name}]`;
        }

        // Add board indicator if it's from a different board
        let boardInfo = "";
        if (link.board_id && link.board_id !== this.metadata.boardId) {
          boardInfo = ` *(board ${link.board_id})*`;
        }

        return `- [${title}](${url})${statusInfo}${boardInfo} *${kanbanizeId}* ${marker}`;
      });

      sections.push(`**${label}:**\n${items.join("\n")}`);
    }

    if (sections.length === 0) {
      return "";
    }

    return `\n\n---\n\n**Relations from Kanbanize**\n\n${sections.join("\n\n")}`;
  }

  /**
   * Convert relative inline image URLs to absolute URLs
   */
  private fixInlineImageUrls(markdown: string): string {
    // Convert relative /inlineImages/ paths to absolute URLs
    // Matches: ![...](/inlineImages/...)
    return markdown.replace(
      /!\[([^\]]*)\]\(\/inlineImages\/([^)]+)\)/g,
      `![$1](${KANBANIZE_BASE_URL}/inlineImages/$2)`
    );
  }

  /**
   * Replace user mentions with Linear profile links
   */
  private replaceUserMentions(text: string): string {
    // Build a map of Kanbanize username to Linear profile URL
    const usernameToProfileUrl = new Map<string, string>();

    for (const user of Object.values(this.exportData.users)) {
      if (user.email) {
        // Extract the part before @ from email as Linear username
        const linearUsername = user.email.split("@")[0];
        const profileUrl = `https://linear.app/truvity/profiles/${linearUsername}`;

        // Map both username and realname to the profile URL
        if (user.username) {
          usernameToProfileUrl.set(user.username, profileUrl);
        }
        if (user.realname) {
          usernameToProfileUrl.set(user.realname, profileUrl);
        }
      }
    }

    // Replace @username mentions with Linear profile URLs
    let result = text;
    for (const [username, profileUrl] of usernameToProfileUrl.entries()) {
      // Escape special regex characters in username
      const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match @username as a whole word (not part of email addresses)
      const regex = new RegExp(`@\\*\\*${escapedUsername}\\*\\*`, "gi");
      result = result.replace(regex, profileUrl);
    }

    return result;
  }

  /**
   * Build the full description for a card
   */
  private buildDescription(card: ExportedCard): string {
    const parts: string[] = [];

    // Original description converted to Markdown
    let mdDescription = htmlToMarkdown(card.description);
    if (mdDescription) {
      // Fix relative inline image URLs
      mdDescription = this.fixInlineImageUrls(mdDescription);
      // Replace user mentions with Linear profile links
      mdDescription = this.replaceUserMentions(mdDescription);
      parts.push(mdDescription);
    }

    // Kanbanize card meta information
    parts.push(`\n\n---\n\n**Details from Kanbanize**\n\n- **Kanbanize ID**: kn-${card.card_id}`);

    // Relations section
    const relationsSection = this.buildRelationsSection(card);
    if (relationsSection) {
      parts.push(relationsSection);
    }

    return parts.join("");
  }

  /**
   * Convert comments to Linear format
   */
  private convertComments(card: ExportedCard): Comment[] {
    return card.comments.map(comment => {
      const user = this.exportData.users[comment.author_user_id];
      // Use email as userId (fallback to user_id if no email)
      const userId = user?.email || String(comment.author_user_id);

      // Convert comment text to Markdown and fix inline image URLs
      let commentBody = htmlToMarkdown(comment.text);
      commentBody = this.fixInlineImageUrls(commentBody);
      // Replace user mentions with Linear profile links
      commentBody = this.replaceUserMentions(commentBody);

      return {
        body: commentBody,
        userId,
        createdAt: new Date(comment.created_at),
      };
    });
  }

  /**
   * Import data from Kanbanize export
   */
  public import = async (): Promise<ImportResult> => {
    // Load export data
    this.loadExportData();

    // Filter cards
    const filteredCards = this.filterCards(this.exportData.cards);

    // Build set of migrated card IDs for relations marking
    this.migratedCardIds = new Set(filteredCards.map(c => c.card_id));

    const importData: ImportResult = {
      issues: [],
      labels: {},
      users: {},
      statuses: {},
    };

    // Collect used user IDs, tag IDs, and status names from filtered cards
    const usedUserIds = new Set<number>();
    const usedTagIds = new Set<number>();
    const usedStatusNames = new Set<string>();

    // First pass: collect what's actually used
    for (const card of filteredCards) {
      // Collect owner
      if (card.owner_user_id) {
        usedUserIds.add(card.owner_user_id);
      }

      // Collect co-owners
      if (card.co_owner_ids && card.co_owner_ids.length > 0) {
        card.co_owner_ids.forEach(id => usedUserIds.add(id));
      }

      // Collect comment authors
      if (card.comments && card.comments.length > 0) {
        card.comments.forEach(comment => {
          if (comment.author_user_id) {
            usedUserIds.add(comment.author_user_id);
          }
        });
      }

      // Collect tags
      if (card.tag_ids && card.tag_ids.length > 0) {
        card.tag_ids.forEach(tagId => usedTagIds.add(tagId));
      }

      // Collect status
      const statusName = this.getStatusName(card);
      usedStatusNames.add(statusName);
    }

    // Build users map (only used users)
    for (const userId of usedUserIds) {
      const user = this.exportData.users[userId];
      if (!user) {
        continue;
      }

      // Skip users without email - they must be fetched from Kanbanize API
      if (!user.email) {
        console.warn(
          `Warning: User ${user.user_id} (${user.realname || user.username}) has no email address. Skipping.`
        );
        continue;
      }

      // Use email as the key for user identification
      const userKey = user.email;

      // Convert relative avatar URL to absolute URL
      let avatarUrl: string | undefined;
      if (user.avatar) {
        avatarUrl = user.avatar.startsWith("http") ? user.avatar : `${KANBANIZE_BASE_URL}${user.avatar}`;
      }

      importData.users[userKey] = {
        name: user.realname || user.username,
        email: user.email,
        avatarUrl,
      };
    }

    // Build labels from tags (only used tags)
    for (const tagId of usedTagIds) {
      const tag = this.exportData.tags[tagId];
      if (!tag) {
        continue;
      }

      importData.labels[String(tagId)] = {
        name: tag.label,
        color: tag.color ? `#${tag.color}` : undefined,
      };
    }

    // Add "initiative" label for Initiatives workflow cards
    importData.labels.initiative = {
      name: "initiative",
      color: "#5E6AD2", // Linear's purple color
      description: "Card from Kanbanize Initiatives workflow",
    };

    // Build statuses (only used statuses)
    for (const statusName of usedStatusNames) {
      // Find the column that matches this status name
      const column = Object.values(this.exportData.columns).find(col => {
        const mappedName = this.statusMapping?.[col.name] || col.name;
        return mappedName === statusName;
      }) as KanbanizeColumn | undefined;

      if (column && importData.statuses) {
        importData.statuses[statusName] = {
          name: statusName,
          color: column.color ? `#${column.color}` : undefined,
          type: SECTION_TO_STATUS_TYPE[column.section],
        };
      }
    }

    // Convert cards to issues
    for (const card of filteredCards) {
      const column = this.exportData.columns[card.column_id];
      const user = card.owner_user_id ? this.exportData.users[card.owner_user_id] : null;
      // Use email as assigneeId
      const assigneeId = user?.email;

      // Convert tags to label IDs
      const labels = card.tag_ids.map(tagId => String(tagId));

      // Add "initiative" label if card is from Initiatives workflow (type 1)
      const workflow = this.exportData.workflows[card.workflow_id];
      if (workflow && workflow.type === 1) {
        labels.push("initiative");
      }

      // Determine if card should be archived (section 5 = Archive)
      const isArchived = column?.section === 5;

      // Get status type for this card
      const statusType = this.getStatusType(card);

      // Only set completedAt if status type is "completed" or "canceled"
      const completedAt =
        (statusType === "completed" || statusType === "canceled") && card.first_end_time
          ? new Date(card.first_end_time)
          : undefined;

      // Only set startedAt if status type is "started", "completed", or "canceled"
      const startedAt =
        (statusType === "started" || statusType === "completed" || statusType === "canceled") && card.first_start_time
          ? new Date(card.first_start_time)
          : undefined;

      // Build attachments array with local file paths
      const attachments = card.attachments.map(att => ({
        fileName: att.file_name,
        filePath: path.join(this.exportPath, "attachments", att.local_path),
      }));

      // Extract native relationships for all link types
      const { parentIds, childIds, relatedIds, predecessorIds, successorIds } = this.extractNativeRelationships(card);

      importData.issues.push({
        sourceId: String(card.card_id),
        title: card.title,
        description: this.buildDescription(card),
        status: this.getStatusName(card),
        assigneeId,
        priority: card.priority ? PRIORITY_MAP[card.priority] : 0,
        comments: this.convertComments(card),
        labels,
        url: `${KANBANIZE_BASE_URL}/ctrl_board/${this.metadata.boardId}/cards/${card.card_id}`,
        createdAt: new Date(card.created_at),
        dueDate: card.deadline ? new Date(card.deadline) : undefined,
        completedAt,
        startedAt,
        archived: isArchived,
        estimate: card.size ?? undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        parentIds: parentIds.length > 0 ? parentIds : undefined,
        childIds: childIds.length > 0 ? childIds : undefined,
        relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
        predecessorIds: predecessorIds.length > 0 ? predecessorIds : undefined,
        successorIds: successorIds.length > 0 ? successorIds : undefined,
      });
    }

    return importData;
  };
}
