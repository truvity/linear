 
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
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private cacheEnabled: boolean = true;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes default TTL
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private rateLimitWaitPromise: Promise<void> | null = null;

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
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
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
   * Get cached response if available and not expired
   */
  private getCachedResponse<T>(cacheKey: string): T | null {
    if (!this.cacheEnabled) {
      return null;
    }

    const cached = this.cache.get(cacheKey);
    if (!cached) {
      this.cacheMisses++;
      return null;
    }

    // Check if cache entry is expired
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.cache.delete(cacheKey);
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return cached.data as T;
  }

  /**
   * Store response in cache
   */
  private setCachedResponse(cacheKey: string, data: unknown): void {
    if (!this.cacheEnabled) {
      return;
    }

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });
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
   * Get list of card IDs for a board (using the list endpoint which returns limited fields)
   */
  public async getCardIdsList(boardId: number): Promise<number[]> {
    return this.getCardIds(boardId);
  }

  /**
   * Internal method to get list of card IDs for a board
   */
  private async getCardIds(boardId: number): Promise<number[]> {
    const cardIds: number[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<{
        data: {
          pagination: { all_pages: number; current_page: number; results_per_page: number };
          data: { card_id: number }[];
        };
      }>("/cards", {
        params: {
          board_ids: boardId,
          page,
          per_page: pageSize,
        },
      });

      const cards = response.data.data;
      cardIds.push(...cards.map(c => c.card_id));
      hasMore = cards.length === pageSize;
      page++;
    }

    return cardIds;
  }

  /**
   * Get a single card with full details
   */
  public async getCard(cardId: number): Promise<KanbanizeCard> {
    const response = await this.request<{ data: KanbanizeCard }>(`/cards/${cardId}`);
    return response.data;
  }

  /**
   * Get all cards for a board with full details
   * First fetches card IDs from the list endpoint, then fetches full details for each card
   */
  public async getCards(
    boardId: number,
    progressCallback?: (current: number, total: number) => void
  ): Promise<KanbanizeCard[]> {
    // First, get all card IDs from the list endpoint
    const cardIds = await this.getCardIds(boardId);
    const total = cardIds.length;

    if (total === 0) {
      return [];
    }

    // Then fetch full details for each card
    const allCards: KanbanizeCard[] = [];
    for (let i = 0; i < cardIds.length; i++) {
      const cardId = cardIds[i];
      const card = await this.getCard(cardId);
      allCards.push(card);

      if (progressCallback) {
        progressCallback(i + 1, total);
      }
    }

    return allCards;
  }

  /**
   * Get comments for a specific card
   */
  public async getCardComments(cardId: number): Promise<KanbanizeComment[]> {
    const response = await this.request<{ data: KanbanizeComment[] }>(`/cards/${cardId}/comments`);
    return response.data;
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
