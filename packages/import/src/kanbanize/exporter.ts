/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { KanbanizeClient } from "./client.ts";
import type {
  ExportedAttachment,
  ExportedCard,
  ExportedComment,
  ExportedCommentAttachment,
  ExportOptions,
  KanbanizeBoardExport,
  KanbanizeBoardMetadata,
  KanbanizeColumn,
  KanbanizeLane,
  KanbanizeLinkedCard,
  KanbanizeTag,
  KanbanizeUser,
  KanbanizeWorkspace,
} from "./types.ts";

/**
 * Export cards from Kanbanize boards to local JSON files
 */
export class KanbanizeExporter {
  private client: KanbanizeClient;
  private workspaces: Map<number, KanbanizeWorkspace> = new Map();

  public constructor(client?: KanbanizeClient) {
    this.client = client || new KanbanizeClient();
  }

  /**
   * Export multiple boards to separate directories
   */
  public async exportBoards(options: ExportOptions): Promise<void> {
    const { boardIds, outputDir } = options;

    console.log(chalk.blue(`\nExporting ${boardIds.length} board(s) to ${outputDir}\n`));

    // Fetch workspaces for metadata
    console.log("Fetching workspaces...");
    const workspaces = await this.client.getWorkspaces();
    workspaces.forEach(ws => this.workspaces.set(ws.workspace_id, ws));

    // Export each board
    for (const boardId of boardIds) {
      await this.exportBoard(boardId, outputDir);
    }

    // Show final cache statistics
    const finalCacheStats = this.client.getCacheStats();
    if (finalCacheStats.hits + finalCacheStats.misses > 0) {
      const hitRatePercent = (finalCacheStats.hitRate * 100).toFixed(1);
      const savedRequests = finalCacheStats.hits;
      console.log(
        chalk.gray(
          `\nTotal cache performance: ${finalCacheStats.hits} hits, ${finalCacheStats.misses} misses (${hitRatePercent}% hit rate)`
        )
      );
      console.log(chalk.gray(`Saved ${savedRequests} API requests through caching`));
    }

    console.log(chalk.green(`\n✓ Export complete! Files saved to ${outputDir}\n`));
  }

  /**
   * Export a single board to its own directory
   */
  private async exportBoard(boardId: number, baseOutputDir: string): Promise<void> {
    const boardDir = path.join(baseOutputDir, `board-${boardId}`);
    const attachmentsDir = path.join(boardDir, "attachments");

    console.log(chalk.cyan(`\n━━━ Board ${boardId} ━━━`));

    // Fetch board metadata
    console.log("Fetching board metadata...");
    const board = await this.client.getBoard(boardId);
    const workspace = this.workspaces.get(board.workspace_id);

    // Fetch reference data
    console.log("Fetching reference data (users, tags, columns, lanes)...");
    const [users, tags, columns, lanes] = await Promise.all([
      this.client.getUsers(),
      this.client.getTags(boardId),
      this.client.getColumns(boardId),
      this.client.getLanes(boardId),
    ]);

    // Create lookup maps
    const usersMap: Record<number, KanbanizeUser> = {};
    users.forEach(u => (usersMap[u.user_id] = u));

    const tagsMap: Record<number, KanbanizeTag> = {};
    tags.forEach(t => (tagsMap[t.tag_id] = t));

    const columnsMap: Record<number, KanbanizeColumn> = {};
    columns.forEach(c => (columnsMap[c.column_id] = c));

    const lanesMap: Record<number, KanbanizeLane> = {};
    lanes.forEach(l => (lanesMap[l.lane_id] = l));

    // Process each card (fetch comments, download attachments)
    const exportedCards: ExportedCard[] = [];

    // Simple progress tracking without cli-progress bar
    let currentPhase = "cards";
    let lastProgressMessage = "";

    const updateProgress = (current: number, total: number, phase: string = currentPhase) => {
      const label = phase === "cards" ? "Fetching card details" : "Processing cards";
      lastProgressMessage = `${label}: ${current}/${total}`;
      process.stdout.write(`\r\x1b[K${lastProgressMessage}`);
    };

    // Set up log callback to handle rate limit messages during progress
    this.client.setLogCallback((message: string, isComplete?: boolean) => {
      if (message) {
        // Show progress + rate limit message on the same line
        const fullMessage = lastProgressMessage ? `${lastProgressMessage} - ${message}` : message;
        process.stdout.write(`\r\x1b[K${fullMessage}`);
      }

      // If countdown is complete, restore the last progress message (without the rate limit suffix)
      if (isComplete && lastProgressMessage) {
        process.stdout.write(`\r\x1b[K${lastProgressMessage}`);
      }
    });

    // Fetch cards with full details (this now fetches each card individually)
    console.log("Fetching cards...");
    const cards = await this.client.getCards(boardId, (current, total) => {
      updateProgress(current, total, "cards");
    });
    process.stdout.write("\n");
    console.log(`Found ${cards.length} cards with full details`);

    // Switch to processing phase
    currentPhase = "processing";
    updateProgress(0, cards.length, "processing");

    // Cache for linked card details (to avoid fetching the same card multiple times)
    const linkedCardCache = new Map<number, { title: string; board_id: number; column_name?: string }>();

    for (const card of cards) {
      // Fetch comments for this card
      const comments = await this.client.getCardComments(card.card_id);

      // Process attachments
      const exportedAttachments: ExportedAttachment[] = [];
      if (card.attachments && card.attachments.length > 0) {
        for (const attachment of card.attachments) {
          const localPath = `${card.card_id}/${attachment.id}_${attachment.file_name}`;
          const fullPath = path.join(attachmentsDir, localPath);

          try {
            await this.client.downloadAttachment(attachment.link, fullPath);
            exportedAttachments.push({
              id: attachment.id,
              file_name: attachment.file_name,
              original_link: attachment.link,
              local_path: localPath,
            });
          } catch (error) {
            console.warn(`\nWarning: Failed to download attachment ${attachment.file_name}: ${error}`);
            // Still record the attachment but mark local_path as empty
            exportedAttachments.push({
              id: attachment.id,
              file_name: attachment.file_name,
              original_link: attachment.link,
              local_path: "", // Empty indicates download failed
            });
          }
        }
      }

      // Process comments and their attachments
      const exportedComments: ExportedComment[] = [];
      for (const comment of comments) {
        const commentAttachments: ExportedCommentAttachment[] = [];

        if (comment.attachments && comment.attachments.length > 0) {
          for (const attachment of comment.attachments) {
            const localPath = `${card.card_id}/comments/${comment.comment_id}_${attachment.id}_${attachment.file_name}`;
            const fullPath = path.join(attachmentsDir, localPath);

            try {
              await this.client.downloadAttachment(attachment.link, fullPath);
              commentAttachments.push({
                id: attachment.id,
                file_name: attachment.file_name,
                local_path: localPath,
              });
            } catch (error) {
              console.warn(`\nWarning: Failed to download comment attachment ${attachment.file_name}: ${error}`);
              commentAttachments.push({
                id: attachment.id,
                file_name: attachment.file_name,
                local_path: "",
              });
            }
          }
        }

        exportedComments.push({
          comment_id: comment.comment_id,
          text: comment.text,
          author_user_id: comment.author?.value || 0,
          created_at: comment.created_at,
          attachments: commentAttachments,
        });
      }

      // Enrich linked cards with details (especially for cross-board references)
      const enrichedLinkedCards: KanbanizeLinkedCard[] = [];
      if (card.linked_cards && card.linked_cards.length > 0) {
        for (const link of card.linked_cards) {
          const enrichedLink: KanbanizeLinkedCard = {
            card_id: link.card_id,
            link_type: link.link_type,
          };

          // Try to get details from cache first, or fetch if not cached
          if (!linkedCardCache.has(link.card_id)) {
            try {
              const linkedCardDetails = await this.client.getCard(link.card_id);
              const linkedCardColumn =
                linkedCardDetails.board_id === boardId && columnsMap[linkedCardDetails.column_id]
                  ? columnsMap[linkedCardDetails.column_id]
                  : undefined;

              linkedCardCache.set(link.card_id, {
                title: linkedCardDetails.title,
                board_id: linkedCardDetails.board_id,
                column_name: linkedCardColumn?.name,
              });
            } catch (error) {
              // If we can't fetch the card details, skip enrichment
              console.warn(`\nWarning: Failed to fetch details for linked card ${link.card_id}: ${error}`);
            }
          }

          const cachedDetails = linkedCardCache.get(link.card_id);
          if (cachedDetails) {
            enrichedLink.title = cachedDetails.title;
            enrichedLink.board_id = cachedDetails.board_id;
            enrichedLink.column_name = cachedDetails.column_name;
          }

          enrichedLinkedCards.push(enrichedLink);
        }
      }

      // Build exported card
      const exportedCard: ExportedCard = {
        card_id: card.card_id,
        custom_id: card.custom_id,
        board_id: card.board_id,
        workflow_id: card.workflow_id,
        title: card.title,
        description: card.description || "",
        column_id: card.column_id,
        lane_id: card.lane_id,
        section: card.section,
        position: card.position,
        owner_user_id: card.owner_user_id,
        co_owner_ids: card.co_owner_ids || [],
        priority: card.priority,
        size: card.size,
        deadline: card.deadline,
        color: card.color,
        created_at: card.created_at,
        last_modified: card.last_modified,
        first_start_time: card.first_start_time,
        first_end_time: card.first_end_time,
        tag_ids: card.tag_ids || [],
        linked_cards: enrichedLinkedCards,
        attachments: exportedAttachments,
        comments: exportedComments,
      };

      exportedCards.push(exportedCard);

      // Update progress counter
      updateProgress(exportedCards.length, cards.length, "processing");
    }

    // Move to next line after progress is complete
    process.stdout.write("\n");

    // Clear the log callback after processing is done
    this.client.setLogCallback();

    // Collect used user IDs and tag IDs
    const usedUserIds = new Set<number>();
    const usedTagIds = new Set<number>();

    for (const card of exportedCards) {
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
    }

    // Filter users to only include used ones
    const filteredUsersMap: Record<number, KanbanizeUser> = {};
    for (const userId of usedUserIds) {
      if (usersMap[userId]) {
        filteredUsersMap[userId] = usersMap[userId];
      }
    }

    // Filter tags to only include used ones
    const filteredTagsMap: Record<number, KanbanizeTag> = {};
    for (const tagId of usedTagIds) {
      if (tagsMap[tagId]) {
        filteredTagsMap[tagId] = tagsMap[tagId];
      }
    }

    console.log(
      chalk.gray(
        `Filtered to ${usedUserIds.size} users (from ${Object.keys(usersMap).length}) and ${usedTagIds.size} tags (from ${Object.keys(tagsMap).length})`
      )
    );

    // Create export data
    const exportData: KanbanizeBoardExport = {
      users: filteredUsersMap,
      tags: filteredTagsMap,
      columns: columnsMap,
      lanes: lanesMap,
      cards: exportedCards,
    };

    // Create metadata
    const metadata: KanbanizeBoardMetadata = {
      boardId: boardId, // Use the boardId parameter, not board.board_id (which doesn't exist in API response)
      boardName: board.name,
      workspaceId: board.workspace_id,
      workspaceName: workspace?.name || "Unknown",
      exportedAt: new Date().toISOString(),
      cardCount: exportedCards.length,
      version: "1.0",
    };

    // Ensure output directory exists
    if (!fs.existsSync(boardDir)) {
      fs.mkdirSync(boardDir, { recursive: true });
    }

    // Write export.json
    const exportPath = path.join(boardDir, "export.json");
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
    console.log(chalk.green(`✓ Saved export.json (${exportedCards.length} cards)`));

    // Write metadata.json
    const metadataPath = path.join(boardDir, "metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(chalk.green(`✓ Saved metadata.json`));

    // Report attachments status
    const totalAttachments = exportedCards.reduce(
      (sum, card) => sum + card.attachments.length + card.comments.reduce((cSum, c) => cSum + c.attachments.length, 0),
      0
    );
    const downloadedAttachments = exportedCards.reduce(
      (sum, card) =>
        sum +
        card.attachments.filter(a => a.local_path).length +
        card.comments.reduce((cSum, c) => cSum + c.attachments.filter(a => a.local_path).length, 0),
      0
    );

    if (totalAttachments > 0) {
      console.log(chalk.green(`✓ Downloaded ${downloadedAttachments}/${totalAttachments} attachments`));
    }

    // Report cache statistics
    const cacheStats = this.client.getCacheStats();
    if (cacheStats.hits + cacheStats.misses > 0) {
      const hitRatePercent = (cacheStats.hitRate * 100).toFixed(1);
      console.log(
        chalk.gray(
          `Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${hitRatePercent}% hit rate, ${cacheStats.size} entries)`
        )
      );
    }
  }
}

/**
 * Run the export command
 */
export async function runExport(options: ExportOptions): Promise<void> {
  const exporter = new KanbanizeExporter();
  await exporter.exportBoards(options);
}
