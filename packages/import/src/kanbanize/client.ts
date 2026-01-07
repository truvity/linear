import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import type { SingleBar } from "cli-progress";
import type {
  KanbanizeApiConfig,
  KanbanizeBoard,
  KanbanizeCard,
  KanbanizeColumn,
  KanbanizeComment,
  KanbanizeLane,
  KanbanizeTag,
  KanbanizeUser,
  KanbanizeWorkflow,
  KanbanizeWorkspace,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://truvity.kanbanize.com/api/v2";
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Kanbanize API Client
 *
 * Handles authentication, rate limiting, caching, and API requests to the Kanbanize (Businessmap) API.
 */
export class KanbanizeClient {
  private apiKey: string;
  private baseUrl: string;
  private requestTimestamps: number[] = [];
  private progressBar?: SingleBar;
  private cache: Map<string, unknown> = new Map();
  private cacheEnabled: boolean = true;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private rateLimitWaitPromise: Promise<void> | null = null;

  // Entity-level caches for cross-method optimization
  private cardCache: Map<number, KanbanizeCard> = new Map();
  private commentCache: Map<number, KanbanizeComment[]> = new Map();
  // Track which boards have been fully cached (all cards fetched)
  private fullyCachedBoards: Set<number> = new Set();

  public constructor(config: Partial<KanbanizeApiConfig> = {}) {
    this.apiKey = config.apiKey || process.env.KANBANIZE_API_KEY || "";
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    if (!this.apiKey) {
      throw new Error(
        "Kanbanize API key is required. Set KANBANIZE_API_KEY environment variable or pass apiKey in config."
      );
    }
  }

  /**
   * Set a callback for log messages (useful for progress bar integration)
   */
  /**
   * Set a progress bar to use for displaying retry countdowns
   */
  public setProgressBar(progressBar?: SingleBar): void {
    this.progressBar = progressBar;
  }

  /**
   * Enable or disable caching
   */
  public setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
  }

  /**
   * Clear the cache
   */
  public clearCache(): void {
    this.cache.clear();
    this.cardCache.clear();
    this.commentCache.clear();
    this.fullyCachedBoards.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Check if a board has been fully cached (all cards fetched)
   */
  public isBoardFullyCached(boardId: number): boolean {
    return this.fullyCachedBoards.has(boardId);
  }

  /**
   * Mark a board as fully cached
   */
  private markBoardAsFullyCached(boardId: number): void {
    this.fullyCachedBoards.add(boardId);
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    hits: number;
    misses: number;
    size: number;
    hitRate: number;
    requestCacheSize: number;
    cardCacheSize: number;
    commentCacheSize: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size + this.cardCache.size + this.commentCache.size,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      requestCacheSize: this.cache.size,
      cardCacheSize: this.cardCache.size,
      commentCacheSize: this.commentCache.size,
    };
  }

  /**
   * Cache a card by its ID for cross-method optimization
   */
  private cacheCard(card: KanbanizeCard): void {
    if (this.cacheEnabled) {
      this.cardCache.set(card.card_id, card);
    }
  }

  /**
   * Get a card from entity cache (internal use, updates stats)
   */
  private getCachedCard(cardId: number): KanbanizeCard | undefined {
    if (!this.cacheEnabled) {
      return undefined;
    }
    const card = this.cardCache.get(cardId);
    if (card) {
      this.cacheHits++;
      return card;
    }
    return undefined;
  }

  /**
   * Check if a card is in the cache without updating stats or making API calls
   * Useful for checking cache state without side effects
   */
  public peekCachedCard(cardId: number): KanbanizeCard | undefined {
    if (!this.cacheEnabled) {
      return undefined;
    }
    return this.cardCache.get(cardId);
  }

  /**
   * Cache comments for a card
   */
  private cacheComments(cardId: number, comments: KanbanizeComment[]): void {
    if (this.cacheEnabled) {
      this.commentCache.set(cardId, comments);
    }
  }

  /**
   * Get cached comments for a card
   */
  private getCachedComments(cardId: number): KanbanizeComment[] | undefined {
    if (!this.cacheEnabled) {
      return undefined;
    }
    const comments = this.commentCache.get(cardId);
    if (comments) {
      this.cacheHits++;
      return comments;
    }
    return undefined;
  }

  /**
   * Generate cache key for a request
   */
  private getCacheKey(endpoint: string, params?: Record<string, string | number | undefined>): string {
    const sortedParams = params
      ? Object.keys(params)
          .sort()
          .map(key => `${key}=${params[key]}`)
          .join("&")
      : "";
    return `${endpoint}?${sortedParams}`;
  }

  /**
   * Get cached response if available
   * Cache entries never expire during export (data doesn't change)
   */
  private getCachedResponse<T>(cacheKey: string): T | null {
    if (!this.cacheEnabled) {
      return null;
    }

    const cached = this.cache.get(cacheKey);
    if (cached === undefined) {
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return cached as T;
  }

  /**
   * Store response in cache
   * Cache entries persist for the lifetime of the client (no TTL)
   */
  private setCachedResponse(cacheKey: string, data: unknown): void {
    if (!this.cacheEnabled) {
      return;
    }

    this.cache.set(cacheKey, data);
  }

  /**
   * Rate limiting: wait if we've exceeded the limit
   */
  private async waitForRateLimit(): Promise<void> {
    // If a rate limit wait is already in progress, wait for it to complete
    if (this.rateLimitWaitPromise) {
      await this.rateLimitWaitPromise;
      // After waiting, fall through to check rate limit again and push timestamp
    }

    const now = Date.now();
    // Remove timestamps older than the rate limit window
    this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (this.requestTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp) + 100; // Add 100ms buffer

      // Create a promise for this wait so other requests can wait for it
      this.rateLimitWaitPromise = this.waitWithCountdown(waitTime, "Rate limit reached").finally(() => {
        this.rateLimitWaitPromise = null;
      });

      await this.rateLimitWaitPromise;
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Wait for a specified duration with a countdown timer
   */
  private async waitWithCountdown(waitTimeMs: number, reason: string): Promise<void> {
    const startTime = Date.now();
    const endTime = startTime + waitTimeMs;

    // Update every second
    const updateInterval = 1000;
    let isFirstLog = true;

    while (Date.now() < endTime) {
      const remainingMs = endTime - Date.now();
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      if (this.progressBar) {
        // Using progress bar - update the text token with countdown
        this.progressBar.update({ text: `${reason}. Waiting ${remainingSeconds}s...` });
      } else {
        // Using stdout directly - update same line
        if (!isFirstLog) {
          process.stdout.write("\r\x1b[K"); // Clear current line
        }
        process.stdout.write(`${reason}. Waiting ${remainingSeconds}s...`);
        isFirstLog = false;
      }

      // Wait for the shorter of: update interval or remaining time
      const sleepTime = Math.min(updateInterval, remainingMs);
      if (sleepTime > 0) {
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      }
    }

    // Signal completion
    if (this.progressBar) {
      // Clear the text token
      this.progressBar.update({ text: "" });
    } else {
      process.stdout.write("\n");
    }
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: { method?: string; body?: unknown; params?: Record<string, string | number | undefined> } = {},
    retryCount = 0
  ): Promise<T> {
    const method = options.method || "GET";

    // Check cache for GET requests
    if (method === "GET") {
      const cacheKey = this.getCacheKey(endpoint, options.params);
      const cachedResponse = this.getCachedResponse<T>(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    await this.waitForRateLimit();

    const url = new URL(`${this.baseUrl}${endpoint}`);

    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers: {
        apikey: this.apiKey,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();

      // Handle rate limiting with retry
      if (response.status === 429 && retryCount < 5) {
        try {
          const errorData = JSON.parse(errorBody);
          const retryAfter = errorData.error?.details?.retry_after || 60;
          await this.waitWithCountdown((retryAfter + 1) * 1000, "Rate limit reached");
          return this.request<T>(endpoint, options, retryCount + 1);
        } catch {
          // If parsing fails, wait and retry
          await this.waitWithCountdown(61000, "Rate limit reached");
          return this.request<T>(endpoint, options, retryCount + 1);
        }
      }

      throw new Error(`Kanbanize API error: ${response.status} ${response.statusText}\n${errorBody}`);
    }

    const data = (await response.json()) as T;

    // Cache GET requests
    if (method === "GET") {
      const cacheKey = this.getCacheKey(endpoint, options.params);
      this.setCachedResponse(cacheKey, data);
    }

    return data;
  }

  /**
   * Get a single card with full details
   * Uses entity cache for cards previously fetched via bulk methods
   */
  public async getCard(cardId: number): Promise<KanbanizeCard> {
    // Check entity cache first
    const cached = this.getCachedCard(cardId);
    if (cached) {
      return cached;
    }

    this.cacheMisses++;
    const response = await this.request<{ data: KanbanizeCard }>(`/cards/${cardId}`);
    const card = response.data;

    // Cache for future use
    this.cacheCard(card);

    return card;
  }

  /**
   * Get multiple cards by their IDs with full details
   * Uses the bulk card_ids parameter to fetch multiple cards in fewer API calls
   * Filters out already-cached cards to minimize API calls
   */
  public async getCardsByIds(
    cardIds: number[],
    progressCallback?: (current: number, total: number) => void
  ): Promise<KanbanizeCard[]> {
    if (cardIds.length === 0) {
      return [];
    }

    const allCards: KanbanizeCard[] = [];
    const total = cardIds.length;

    // Check cache first and filter out already-cached cards
    const uncachedIds: number[] = [];
    for (const cardId of cardIds) {
      const cached = this.getCachedCard(cardId);
      if (cached) {
        allCards.push(cached);
      } else {
        this.cacheMisses++;
        uncachedIds.push(cardId);
      }
    }

    // If all cards were cached, return early
    if (uncachedIds.length === 0) {
      if (progressCallback) {
        progressCallback(total, total);
      }
      return allCards;
    }

    const pageSize = 100; // API limits card_ids to reasonable batches

    // Request all fields needed for linked card details
    const fields = [
      "card_id",
      "custom_id",
      "board_id",
      "workflow_id",
      "title",
      "description",
      "column_id",
      "lane_id",
      "section",
      "position",
      "owner_user_id",
      "priority",
      "size",
      "deadline",
      "color",
      "created_at",
      "last_modified",
      "first_start_time",
      "first_end_time",
    ].join(",");

    let fetchedCount = allCards.length; // Start from cached count

    for (let i = 0; i < uncachedIds.length; i += pageSize) {
      const batch = uncachedIds.slice(i, i + pageSize);
      const response = await this.request<{
        data: {
          pagination: { all_pages: number; current_page: number; results_per_page: number };
          data: KanbanizeCard[];
        };
      }>("/cards", {
        params: {
          card_ids: batch.join(","),
          fields,
          expand: "attachments,linked_cards,tag_ids,co_owner_ids",
        },
      });

      // Cache each fetched card and add to results
      for (const card of response.data.data) {
        this.cacheCard(card);
        allCards.push(card);
        fetchedCount++;
      }

      if (progressCallback) {
        progressCallback(fetchedCount, total);
      }
    }

    return allCards;
  }

  /**
   * Get all cards for a board with full details
   * Uses expand parameter to get attachments and linked_cards inline, avoiding N+1 queries
   * Uses fields parameter to request all needed card properties
   * Uses per_page=1000 (API maximum) to minimize pagination calls
   */
  public async getCards(
    boardId: number,
    progressCallback?: (current: number, total: number) => void
  ): Promise<KanbanizeCard[]> {
    const allCards: KanbanizeCard[] = [];
    let page = 1;
    const pageSize = 1000; // API maximum
    let totalPages = 1;

    // Request all fields needed for export
    const fields = [
      "card_id",
      "custom_id",
      "board_id",
      "workflow_id",
      "title",
      "description",
      "column_id",
      "lane_id",
      "section",
      "position",
      "owner_user_id",
      "priority",
      "size",
      "deadline",
      "color",
      "created_at",
      "last_modified",
      "first_start_time",
      "first_end_time",
    ].join(",");

    while (page <= totalPages) {
      const response = await this.request<{
        data: {
          pagination: { all_pages: number; current_page: number; results_per_page: number };
          data: KanbanizeCard[];
        };
      }>("/cards", {
        params: {
          board_ids: boardId,
          page,
          per_page: pageSize,
          fields,
          // Expand related data inline to avoid separate API calls per card
          expand: "attachments,linked_cards,tag_ids,co_owner_ids",
        },
      });

      const { pagination, data: cards } = response.data;
      totalPages = pagination.all_pages;

      // Cache each card individually for cross-method optimization
      for (const card of cards) {
        this.cacheCard(card);
        allCards.push(card);
      }

      if (progressCallback) {
        // Calculate progress based on pagination
        const progress = Math.min(page * pageSize, allCards.length + (totalPages - page) * pageSize);
        progressCallback(allCards.length, Math.max(allCards.length, progress));
      }

      page++;
    }

    // Mark this board as fully cached so we don't refetch it
    this.markBoardAsFullyCached(boardId);

    return allCards;
  }

  /**
   * Prefetch all cards from a board and cache them
   * Useful for optimizing linked card fetches - fetch entire board once instead of individual cards
   * Returns the number of cards cached
   */
  public async prefetchBoardCards(boardId: number): Promise<number> {
    if (this.isBoardFullyCached(boardId)) {
      return 0; // Already cached
    }

    const cards = await this.getCards(boardId);
    return cards.length;
  }

  /**
   * Get comments for a specific card
   * Uses entity cache for comments previously fetched via bulk method
   */
  public async getCardComments(cardId: number): Promise<KanbanizeComment[]> {
    // Check entity cache first
    const cached = this.getCachedComments(cardId);
    if (cached) {
      return cached;
    }

    this.cacheMisses++;
    const response = await this.request<{ data: KanbanizeComment[] }>(`/cards/${cardId}/comments`);
    const comments = response.data;

    // Cache for future use
    this.cacheComments(cardId, comments);

    return comments;
  }

  /**
   * Get comments for multiple cards in bulk
   * Uses the /cards/comments endpoint with card_ids parameter to minimize API calls
   * Returns a Map of card_id -> comments for easy lookup
   * Utilizes entity cache to skip already-cached cards and caches results
   */
  public async getCardCommentsForMultiple(cardIds: number[]): Promise<Map<number, KanbanizeComment[]>> {
    const commentsMap = new Map<number, KanbanizeComment[]>();

    if (cardIds.length === 0) {
      return commentsMap;
    }

    // Check cache first and filter out already-cached card comments
    const uncachedIds: number[] = [];
    for (const cardId of cardIds) {
      const cached = this.getCachedComments(cardId);
      if (cached) {
        commentsMap.set(cardId, cached);
      } else {
        this.cacheMisses++;
        uncachedIds.push(cardId);
        commentsMap.set(cardId, []); // Initialize for uncached
      }
    }

    // If all comments were cached, return early
    if (uncachedIds.length === 0) {
      return commentsMap;
    }

    let page = 1;
    const pageSize = 1000; // API maximum
    let hasMore = true;

    // Response type can vary - handle both direct array and paginated wrapper
    type CommentWithCardId = KanbanizeComment & { card_id: number };
    type BulkCommentsResponse =
      | { data: CommentWithCardId[] }
      | { data: { pagination?: unknown; data: CommentWithCardId[] } };

    while (hasMore) {
      const response = await this.request<BulkCommentsResponse>("/cards/comments", {
        params: {
          card_ids: uncachedIds.join(","),
          page,
          per_page: pageSize,
        },
      });

      // Handle response - could be { data: [...] } or { data: { data: [...], pagination: {...} } }
      let comments: CommentWithCardId[] = [];
      if (response.data) {
        if (Array.isArray(response.data)) {
          // Direct array: { data: [...] }
          comments = response.data;
        } else if (typeof response.data === "object" && "data" in response.data && Array.isArray(response.data.data)) {
          // Paginated wrapper: { data: { data: [...], pagination: {...} } }
          comments = response.data.data;
        }
      }

      // If no comments or empty response, stop pagination
      if (comments.length === 0) {
        hasMore = false;
        break;
      }

      // Group comments by card_id
      for (const comment of comments) {
        const cardComments = commentsMap.get(comment.card_id) || [];
        cardComments.push(comment);
        commentsMap.set(comment.card_id, cardComments);
      }

      hasMore = comments.length === pageSize;
      page++;
    }

    // Sort comments by comment_id for each card and cache them
    for (const cardId of uncachedIds) {
      const cardComments = commentsMap.get(cardId) || [];
      cardComments.sort((a, b) => a.comment_id - b.comment_id);
      commentsMap.set(cardId, cardComments);
      // Cache for future use
      this.cacheComments(cardId, cardComments);
    }

    return commentsMap;
  }

  /**
   * Get all users
   */
  public async getUsers(): Promise<KanbanizeUser[]> {
    // Note: The /users endpoint does NOT support pagination in the response
    // It returns { data: [...] } directly, not { data: { pagination, data } }
    // Request email field explicitly along with other fields
    const response = await this.request<{ data: KanbanizeUser[] }>("/users", {
      params: {
        fields: "user_id,email,username,realname,avatar",
      },
    });
    return response.data;
  }

  /**
   * Get all tags for a board
   * First gets tag IDs available on the board, then fetches full tag details
   */
  public async getTags(boardId: number): Promise<KanbanizeTag[]> {
    // Get tag IDs available on this board
    const boardTagsResponse = await this.request<{ data: { tag_id: number }[] }>(`/boards/${boardId}/tags`);

    if (boardTagsResponse.data.length === 0) {
      return [];
    }

    // Get full tag details for these tag IDs
    const tagIds = boardTagsResponse.data.map(t => t.tag_id);
    const tagsResponse = await this.request<{ data: KanbanizeTag[] }>("/tags", {
      params: {
        tag_ids: tagIds.join(","),
        fields: "tag_id,label,color",
      },
    });

    return tagsResponse.data;
  }

  /**
   * Get all columns for a board
   */
  public async getColumns(boardId: number): Promise<KanbanizeColumn[]> {
    const response = await this.request<{ data: KanbanizeColumn[] }>(`/boards/${boardId}/columns`);
    return response.data;
  }

  /**
   * Get all lanes (swimlanes) for a board
   */
  public async getLanes(boardId: number): Promise<KanbanizeLane[]> {
    const response = await this.request<{ data: KanbanizeLane[] }>(`/boards/${boardId}/lanes`);
    return response.data;
  }

  /**
   * Get all workflows for a board
   */
  public async getWorkflows(boardId: number): Promise<KanbanizeWorkflow[]> {
    const response = await this.request<{ data: KanbanizeWorkflow[] }>(`/boards/${boardId}/workflows`);
    return response.data;
  }

  /**
   * Get all boards
   */
  public async getBoards(): Promise<KanbanizeBoard[]> {
    const response = await this.request<{ data: KanbanizeBoard[] }>("/boards");
    return response.data;
  }

  /**
   * Get board details
   */
  public async getBoard(boardId: number): Promise<KanbanizeBoard> {
    const response = await this.request<{ data: KanbanizeBoard }>(`/boards/${boardId}`);
    return response.data;
  }

  /**
   * Get all workspaces
   */
  public async getWorkspaces(): Promise<KanbanizeWorkspace[]> {
    const response = await this.request<{ data: KanbanizeWorkspace[] }>("/workspaces");
    return response.data;
  }

  /**
   * Download an attachment to a local file
   */
  public async downloadAttachment(attachmentLink: string, outputPath: string): Promise<void> {
    await this.waitForRateLimit();

    // Construct full URL for attachment
    const url = attachmentLink.startsWith("http")
      ? attachmentLink
      : `${this.baseUrl.replace("/api/v2", "")}${attachmentLink}`;

    const response = await fetch(url, {
      headers: {
        apikey: this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
    }

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    const buffer = await response.buffer();
    fs.writeFileSync(outputPath, buffer);
  }

  /**
   * Download an inline image as a buffer
   */
  public async downloadInlineImage(imageLink: string): Promise<{ buffer: Buffer; contentType: string }> {
    await this.waitForRateLimit();

    // Construct full URL for inline image
    const url = imageLink.startsWith("http") ? imageLink : `${this.baseUrl.replace("/api/v2", "")}${imageLink}`;

    const response = await fetch(url, {
      headers: {
        apikey: this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download inline image: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.buffer();
    const contentType = response.headers.get("content-type") || "image/png";

    return { buffer, contentType };
  }

  /**
   * Get the base URL for constructing card links
   */
  public getCardUrl(boardId: number, cardId: number): string {
    const baseUrl = this.baseUrl.replace("/api/v2", "");
    return `${baseUrl}/ctrl_board/${boardId}/cards/${cardId}`;
  }
}
