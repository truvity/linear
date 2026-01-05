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
  private swimlaneId?: number;
  private sections?: number[];
  private statusMapping?: Record<string, string>;
  private exportData!: KanbanizeBoardExport;
  private metadata!: KanbanizeBoardMetadata;
  private migratedCardIds: Set<number> = new Set();

  public constructor(options: ImportOptions) {
    this.exportPath = options.exportPath;
    this.swimlaneId = options.swimlaneId;
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
   * Filter cards based on swimlane and sections
   */
  private filterCards(cards: ExportedCard[]): ExportedCard[] {
    return cards.filter(card => {
      // Filter by swimlane if specified
      if (this.swimlaneId !== undefined && card.lane_id !== this.swimlaneId) {
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
    if (this.statusMapping && this.statusMapping[column.name]) {
      return this.statusMapping[column.name];
    }

    return column.name;
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
   * Build the relations section for a card's description
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

    // Group relations by type
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
        const linkedCard = this.exportData.cards.find(c => c.card_id === link.card_id);
        const title = linkedCard?.title || `Card #${link.card_id}`;
        const url = `${KANBANIZE_BASE_URL}/ctrl_board/${this.metadata.boardId}/cards/${link.card_id}`;
        const isMigrated = this.migratedCardIds.has(link.card_id);
        const marker = isMigrated ? "*(migrated)*" : "*(not migrated)*";

        return `- [${title}](${url}) ${marker}`;
      });

      sections.push(`**${label}:**\n${items.join("\n")}`);
    }

    if (sections.length === 0) {
      return "";
    }

    return `\n\n---\n\n**Relations from Kanbanize**\n\n${sections.join("\n\n")}\n\n---`;
  }

  /**
   * Build the full description for a card
   */
  private buildDescription(card: ExportedCard): string {
    const parts: string[] = [];

    // Original description converted to Markdown
    const mdDescription = htmlToMarkdown(card.description);
    if (mdDescription) {
      parts.push(mdDescription);
    }

    // Link to original card
    const originalUrl = `${KANBANIZE_BASE_URL}/ctrl_board/${this.metadata.boardId}/cards/${card.card_id}`;
    parts.push(`\n\n[View original card in Kanbanize](${originalUrl})`);

    // Kanbanize card ID reference
    parts.push(`\n\n*Kanbanize ID: kn-${card.card_id}*`);

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
      const userId = user?.email || user?.username || String(comment.author_user_id);

      return {
        body: htmlToMarkdown(comment.text),
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

    // Build users map
    for (const [id, user] of Object.entries(this.exportData.users)) {
      const userId = user.email || user.username || id;
      importData.users[userId] = {
        name: user.realname || user.username,
        email: user.email,
        avatarUrl: user.avatar,
      };
    }

    // Build labels from tags
    for (const [id, tag] of Object.entries(this.exportData.tags)) {
      importData.labels[id] = {
        name: tag.label,
        color: tag.color ? `#${tag.color}` : undefined,
      };
    }

    // Build statuses from columns
    const statusesSet = new Set<string>();
    for (const column of Object.values(this.exportData.columns) as KanbanizeColumn[]) {
      const statusName = this.statusMapping?.[column.name] || column.name;
      if (!statusesSet.has(statusName)) {
        statusesSet.add(statusName);
        if (importData.statuses) {
          importData.statuses[statusName] = {
            name: statusName,
            color: column.color ? `#${column.color}` : undefined,
            type: SECTION_TO_STATUS_TYPE[column.section],
          };
        }
      }
    }

    // Convert cards to issues
    for (const card of filteredCards) {
      const column = this.exportData.columns[card.column_id];
      const user = card.owner_user_id ? this.exportData.users[card.owner_user_id] : null;
      const assigneeId = user ? user.email || user.username || String(card.owner_user_id) : undefined;

      // Convert tags to label IDs
      const labels = card.tag_ids.map(tagId => String(tagId));

      // Determine if card should be archived (section 5 = Archive)
      const isArchived = column?.section === 5;

      importData.issues.push({
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
        completedAt: card.first_end_time ? new Date(card.first_end_time) : undefined,
        startedAt: card.first_start_time ? new Date(card.first_start_time) : undefined,
        archived: isArchived,
        estimate: card.size ?? undefined,
      });
    }

    return importData;
  };
}
