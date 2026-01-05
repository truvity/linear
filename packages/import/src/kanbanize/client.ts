/* eslint-disable no-console */
import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import type {
  KanbanizeApiConfig,
  KanbanizeBoard,
  KanbanizeCard,
  KanbanizeColumn,
  KanbanizeComment,
  KanbanizeLane,
  KanbanizeTag,
  KanbanizeUser,
  KanbanizeWorkspace,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://truvity.kanbanize.com/api/v2";
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Kanbanize API Client
 *
 * Handles authentication, rate limiting, and API requests to the Kanbanize (Businessmap) API.
 */
export class KanbanizeClient {
  private apiKey: string;
  private baseUrl: string;
  private requestTimestamps: number[] = [];

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
   * Rate limiting: wait if we've exceeded the limit
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than the rate limit window
    this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (this.requestTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp) + 100; // Add 100ms buffer
      console.log(`Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: { method?: string; body?: unknown; params?: Record<string, string | number | undefined> } = {},
    retryCount = 0
  ): Promise<T> {
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
          console.log(`Rate limit hit. Retrying after ${retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
          return this.request<T>(endpoint, options, retryCount + 1);
        } catch {
          // If parsing fails, wait and retry
          console.log(`Rate limit hit. Retrying after 60s...`);
          await new Promise(resolve => setTimeout(resolve, 61000));
          return this.request<T>(endpoint, options, retryCount + 1);
        }
      }

      throw new Error(`Kanbanize API error: ${response.status} ${response.statusText}\n${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get all cards for a board with pagination
   */
  public async getCards(boardId: number): Promise<KanbanizeCard[]> {
    const allCards: KanbanizeCard[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
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
          // Expand linked cards and attachments in the response
          expand: "linked_cards,attachments",
        },
      });

      const cards = response.data.data;
      allCards.push(...cards);
      hasMore = cards.length === pageSize;
      page++;
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
    const response = await this.request<{ data: KanbanizeUser[] }>("/users");
    return response.data;
  }

  /**
   * Get all tags for a board
   */
  public async getTags(boardId: number): Promise<KanbanizeTag[]> {
    const response = await this.request<{ data: KanbanizeTag[] }>(`/boards/${boardId}/tags`);
    return response.data;
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
   * Get the base URL for constructing card links
   */
  public getCardUrl(boardId: number, cardId: number): string {
    const baseUrl = this.baseUrl.replace("/api/v2", "");
    return `${baseUrl}/ctrl_board/${boardId}/cards/${cardId}`;
  }
}
