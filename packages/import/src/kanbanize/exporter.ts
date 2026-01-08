/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import cliProgress from "cli-progress";
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
  KanbanizeWorkflow,
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

  private padOperationName(value: string, targetLength = 25): string {
    return value.padEnd(targetLength);
  }

  /**
   * Extract inline image URLs from HTML content
   */
  private extractInlineImages(html: string): string[] {
    const regex = /src=["']\/inlineImages\/([^"']+)["']/g;
    const images: string[] = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      images.push(`/inlineImages/${match[1]}`);
    }

    return images;
  }

  /**
   * Download inline images and replace URLs with base64 data URIs
   */
  private async processInlineImages(html: string, cardId: number, warnings?: string[]): Promise<string> {
    const inlineImages = this.extractInlineImages(html);

    if (inlineImages.length === 0) {
      return html;
    }

    let processedHtml = html;

    for (const imageUrl of inlineImages) {
      try {
        const { buffer, contentType } = await this.client.downloadInlineImage(imageUrl);
        const base64 = buffer.toString("base64");
        const dataUri = `data:${contentType};base64,${base64}`;

        // Replace the URL in the HTML
        processedHtml = processedHtml.replace(new RegExp(imageUrl, "g"), dataUri);
      } catch (error) {
        if (warnings) {
          warnings.push(`Failed to download inline image ${imageUrl} for card ${cardId}: ${error}`);
        }
        // Leave the original URL if download fails
      }
    }

    return processedHtml;
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
          `\nCache: ${finalCacheStats.hits} hits, ${finalCacheStats.misses} misses (${hitRatePercent}% hit rate, ~${savedRequests} API calls saved)`
        )
      );
      console.log(
        chalk.gray(
          `Cache entries: ${finalCacheStats.cardCacheSize} cards, ${finalCacheStats.commentCacheSize} comment sets, ${finalCacheStats.requestCacheSize} requests`
        )
      );
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

    // Create a single MultiBar for the entire export process
    const multibar = new cliProgress.MultiBar(
      {
        format: "{operation} | {bar} | {percentage}% | {value}/{total}",
        hideCursor: true,
        autopadding: true,
      },
      cliProgress.Presets.shades_classic
    );

    // Create a status bar at the top for rate limit messages (always visible)
    const statusBar = multibar.create(
      1,
      1,
      { text: "" },
      {
        format: "{text}",
      }
    );

    // Set status bar for client to use during retries for ALL requests
    this.client.setProgressBar(statusBar);

    // Fetch board metadata with progress bar
    const metadataBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching board metadata") });

    const board = await this.client.getBoard(boardId);
    metadataBar.update(1);
    metadataBar.stop();

    const workspace = this.workspaces.get(board.workspace_id);

    // Fetch reference data with progress bars
    // Create progress bars for each operation
    const usersBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching users") });
    const tagsBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching tags") });
    const columnsBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching columns") });
    const lanesBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching lanes") });
    const workflowsBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching workflows") });

    // Fetch all reference data in parallel with progress tracking
    const [users, tags, columns, lanes, workflows] = await Promise.all([
      this.client.getUsers().then(result => {
        usersBar.update(1);
        return result;
      }),
      this.client.getTags(boardId).then(result => {
        tagsBar.update(1);
        return result;
      }),
      this.client.getColumns(boardId).then(result => {
        columnsBar.update(1);
        return result;
      }),
      this.client.getLanes(boardId).then(result => {
        lanesBar.update(1);
        return result;
      }),
      this.client.getWorkflows(boardId).then(result => {
        workflowsBar.update(1);
        return result;
      }),
    ]);

    // Stop individual reference data bars
    usersBar.stop();
    tagsBar.stop();
    columnsBar.stop();
    lanesBar.stop();
    workflowsBar.stop();

    // Create lookup maps
    const usersMap: Record<number, KanbanizeUser> = {};
    users.forEach(u => (usersMap[u.user_id] = u));

    const tagsMap: Record<number, KanbanizeTag> = {};
    tags.forEach(t => (tagsMap[t.tag_id] = t));

    const columnsMap: Record<number, KanbanizeColumn> = {};
    columns.forEach(c => (columnsMap[c.column_id] = c));

    const lanesMap: Record<number, KanbanizeLane> = {};
    lanes.forEach(l => (lanesMap[l.lane_id] = l));

    const workflowsMap: Record<number, KanbanizeWorkflow> = {};
    workflows.forEach(w => (workflowsMap[w.workflow_id] = w));

    // Process each card (fetch comments, download attachments)
    const exportedCards: ExportedCard[] = [];

    // Collect warnings to display after progress bars are stopped
    const warnings: string[] = [];

    // Fetch active cards with progress bar (these will be exported)
    const cardsProgressBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching active cards") });
    const cards = await this.client.getCards(boardId, (current, total) => {
      cardsProgressBar.setTotal(total);
      cardsProgressBar.update(current);
    });
    cardsProgressBar.stop();

    // Also fetch archived and discarded cards to cache them (for linked card lookups)
    // These won't be exported, just cached so linked cards can find them
    const cacheBar = multibar.create(2, 0, { operation: this.padOperationName("Fetching archived cards") });
    await this.client.getCardsByState(boardId, "archived");
    cacheBar.update(1);
    await this.client.getCardsByState(boardId, "discarded");
    cacheBar.update(2);
    cacheBar.stop();

    if (cards.length === 0) {
      // No active cards to process
      multibar.stop();
      this.client.setProgressBar(undefined);
      console.log(chalk.yellow(`No active cards found on board ${boardId}`));
      return;
    }

    // Fetch all comments in bulk (single API call instead of N calls)
    const commentsBar = multibar.create(1, 0, { operation: this.padOperationName("Fetching comments") });
    const cardIds = cards.map(c => c.card_id);
    const commentsMap = await this.client.getCardCommentsForMultiple(cardIds);
    commentsBar.update(1);
    commentsBar.stop();

    // Collect all unique cross-board linked card IDs for batch fetching
    const crossBoardLinkedCardIds = new Set<number>();
    const sameBoardLinkedCards = new Map<number, { title: string; board_id: number; column_name?: string }>();

    // First pass: identify which linked cards are from other boards
    for (const card of cards) {
      if (card.linked_cards && card.linked_cards.length > 0) {
        for (const link of card.linked_cards) {
          // Check if linked card is from the same board (we already have its data)
          const linkedCardInSameBoard = cards.find(c => c.card_id === link.card_id);
          if (linkedCardInSameBoard) {
            // Cache same-board linked card details from already-fetched data
            const linkedCardColumn = columnsMap[linkedCardInSameBoard.column_id];
            sameBoardLinkedCards.set(link.card_id, {
              title: linkedCardInSameBoard.title,
              board_id: linkedCardInSameBoard.board_id,
              column_name: linkedCardColumn?.name,
            });
          } else {
            // Need to fetch from other board
            crossBoardLinkedCardIds.add(link.card_id);
          }
        }
      }
    }

    // Batch fetch cross-board linked cards if any
    const linkedCardCache = new Map<number, { title: string; board_id: number; column_name?: string }>(
      sameBoardLinkedCards
    );

    if (crossBoardLinkedCardIds.size > 0) {
      // Step 1: Initial batch fetch to discover which boards linked cards belong to
      const discoverBar = multibar.create(crossBoardLinkedCardIds.size, 0, {
        operation: this.padOperationName("Discovering linked cards"),
      });

      const linkedBoardIds = new Set<number>();

      try {
        const initialFetch = await this.client.getCardsByIds([...crossBoardLinkedCardIds], current =>
          discoverBar.update(current)
        );

        // Collect unique board IDs from linked cards (excluding current board)
        for (const card of initialFetch) {
          if (card.board_id !== boardId && !this.client.isBoardFullyCached(card.board_id)) {
            linkedBoardIds.add(card.board_id);
          }
          // Cache the card we already have
          linkedCardCache.set(card.card_id, {
            title: card.title,
            board_id: card.board_id,
            column_name: undefined,
          });
        }
        discoverBar.update(crossBoardLinkedCardIds.size);
      } catch (error) {
        warnings.push(`Failed to discover linked cards: ${error}`);
      }
      discoverBar.stop();

      // Step 2: Prefetch entire boards for linked cards
      // This is more efficient than fetching individual cards when multiple cards link to the same board
      if (linkedBoardIds.size > 0) {
        const prefetchBar = multibar.create(linkedBoardIds.size, 0, {
          operation: this.padOperationName("Prefetching linked boards"),
        });

        let boardsFetched = 0;
        for (const linkedBoardId of linkedBoardIds) {
          try {
            await this.client.prefetchBoardCards(linkedBoardId);
          } catch (error) {
            warnings.push(`Failed to prefetch board ${linkedBoardId}: ${error}`);
          }
          boardsFetched++;
          prefetchBar.update(boardsFetched);
        }
        prefetchBar.stop();
      }

      // After prefetching (or if boards were already cached), update linkedCardCache
      // with any cards now available in cache
      for (const cardId of crossBoardLinkedCardIds) {
        if (!linkedCardCache.has(cardId)) {
          const cachedCard = this.client.peekCachedCard(cardId);
          if (cachedCard) {
            linkedCardCache.set(cardId, {
              title: cachedCard.title,
              board_id: cachedCard.board_id,
              column_name: undefined,
            });
          }
        }
      }

      // Step 3: Now fetch any remaining missing cards (deleted/inaccessible)
      const missingCardIds = [...crossBoardLinkedCardIds].filter(id => !linkedCardCache.has(id));
      if (missingCardIds.length > 0) {
        const missingBar = multibar.create(missingCardIds.length, 0, {
          operation: this.padOperationName("Fetching missing cards"),
        });

        let fetchedCount = 0;
        for (const missingId of missingCardIds) {
          try {
            const card = await this.client.getCard(missingId);
            linkedCardCache.set(card.card_id, {
              title: card.title,
              board_id: card.board_id,
              column_name: undefined,
            });
          } catch (error) {
            warnings.push(`Failed to fetch linked card ${missingId}: ${error}`);
          }
          fetchedCount++;
          missingBar.update(fetchedCount);
        }
        missingBar.stop();
      }
    }

    // Processing phase with progress bar
    const processingBar = multibar.create(cards.length, 0, { operation: this.padOperationName("Processing cards") });

    for (const card of cards) {
      // Get comments from the bulk-fetched map (ensure it's an array)
      const commentsFromMap = commentsMap.get(card.card_id);
      const comments = Array.isArray(commentsFromMap) ? commentsFromMap : [];

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
            warnings.push(`Failed to download attachment ${attachment.file_name}: ${error}`);
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
              warnings.push(`Failed to download comment attachment ${attachment.file_name}: ${error}`);
              commentAttachments.push({
                id: attachment.id,
                file_name: attachment.file_name,
                local_path: "",
              });
            }
          }
        }

        // Process inline images in comment text
        const processedCommentText = await this.processInlineImages(comment.text, card.card_id, warnings);

        exportedComments.push({
          comment_id: comment.comment_id,
          text: processedCommentText,
          author_user_id: comment.author?.value || 0,
          created_at: comment.created_at,
          attachments: commentAttachments,
        });
      }

      // Enrich linked cards with details from cache (already batch-fetched)
      const enrichedLinkedCards: KanbanizeLinkedCard[] = [];
      if (card.linked_cards && card.linked_cards.length > 0) {
        for (const link of card.linked_cards) {
          const enrichedLink: KanbanizeLinkedCard = {
            card_id: link.card_id,
            link_type: link.link_type,
          };

          const cachedDetails = linkedCardCache.get(link.card_id);
          if (cachedDetails) {
            enrichedLink.title = cachedDetails.title;
            enrichedLink.board_id = cachedDetails.board_id;
            enrichedLink.column_name = cachedDetails.column_name;
          }

          enrichedLinkedCards.push(enrichedLink);
        }
      }

      // Process inline images in card description
      const processedDescription = await this.processInlineImages(card.description || "", card.card_id, warnings);

      // Build exported card
      const exportedCard: ExportedCard = {
        card_id: card.card_id,
        custom_id: card.custom_id,
        board_id: card.board_id,
        workflow_id: card.workflow_id,
        title: card.title,
        description: processedDescription,
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
      processingBar.update(exportedCards.length);
    }

    // Stop the processing bar
    processingBar.stop();

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

    // Create export data
    const exportData: KanbanizeBoardExport = {
      users: filteredUsersMap,
      tags: filteredTagsMap,
      columns: columnsMap,
      lanes: lanesMap,
      workflows: workflowsMap,
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

    // Write metadata.json
    const metadataPath = path.join(boardDir, "metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Calculate attachment statistics
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

    // Get cache statistics
    const cacheStats = this.client.getCacheStats();

    // Clean up MultiBar and all progress bars
    multibar.stop();
    this.client.setProgressBar(undefined);

    // Display all results after multibar is stopped
    console.log(
      chalk.gray(
        `Filtered to ${usedUserIds.size} users (from ${Object.keys(usersMap).length}) and ${usedTagIds.size} tags (from ${Object.keys(tagsMap).length})`
      )
    );
    console.log(chalk.green(`✓ Saved export.json (${exportedCards.length} cards)`));
    console.log(chalk.green(`✓ Saved metadata.json`));

    if (totalAttachments > 0) {
      console.log(chalk.green(`✓ Downloaded ${downloadedAttachments}/${totalAttachments} attachments`));
    }

    if (cacheStats.hits + cacheStats.misses > 0) {
      const hitRatePercent = (cacheStats.hitRate * 100).toFixed(1);
      console.log(
        chalk.gray(
          `Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${hitRatePercent}% hit rate) | ${cacheStats.cardCacheSize} cards, ${cacheStats.commentCacheSize} comment sets cached`
        )
      );
    }

    // Display warnings if any occurred
    if (warnings.length > 0) {
      console.log(chalk.yellow(`\n⚠ ${warnings.length} warning(s) occurred during export:`));
      warnings.forEach(warning => console.log(chalk.yellow(`  - ${warning}`)));
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
