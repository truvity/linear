import TurndownService from "turndown";

// Create a singleton instance with configured options
const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

// Add custom rules for better conversion

// Handle pre/code blocks properly
turndownService.addRule("codeBlock", {
  filter: node => {
    return node.nodeName === "PRE" && node.firstChild !== null && node.firstChild.nodeName === "CODE";
  },
  replacement: (_content, node) => {
    const codeNode = node.firstChild as HTMLElement;
    const code = codeNode.textContent || "";
    return `\n\`\`\`\n${code}\n\`\`\`\n`;
  },
});

// Handle inline code
turndownService.addRule("inlineCode", {
  filter: node => {
    return node.nodeName === "CODE" && node.parentNode !== null && node.parentNode.nodeName !== "PRE";
  },
  replacement: content => {
    return `\`${content}\``;
  },
});

// Handle div elements as paragraphs
turndownService.addRule("div", {
  filter: "div",
  replacement: content => {
    return `\n${content}\n`;
  },
});

// Handle br tags
turndownService.addRule("br", {
  filter: "br",
  replacement: () => {
    return "\n";
  },
});

/**
 * Convert HTML to Markdown
 *
 * Uses TurndownService to convert HTML content to Markdown format
 * suitable for Linear issue descriptions and comments.
 *
 * @param html HTML content to convert
 * @returns Markdown formatted string
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === "") {
    return "";
  }

  try {
    // Clean up the HTML before conversion
    const cleanedHtml = html
      // Remove zero-width spaces and other invisible characters
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      // Handle common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Convert to markdown
    let markdown = turndownService.turndown(cleanedHtml);

    // Post-process the markdown
    markdown = markdown
      // Remove excessive blank lines (more than 2)
      .replace(/\n{3,}/g, "\n\n")
      // Trim leading/trailing whitespace
      .trim();

    return markdown;
  } catch {
    // If conversion fails, return the original content stripped of HTML tags
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

/**
 * Convert HTML to Markdown, preserving empty content as empty string
 */
export function htmlToMarkdownOrEmpty(html: string | undefined | null): string | undefined {
  if (html === undefined || html === null) {
    return undefined;
  }
  const result = htmlToMarkdown(html);
  return result || undefined;
}
