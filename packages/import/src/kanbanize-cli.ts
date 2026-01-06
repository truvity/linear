#!/usr/bin/env node
/* eslint-disable no-console */
import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { runExport } from "./kanbanize/exporter.ts";
import { kanbanizeImport } from "./importers/kanbanize/index.ts";
import { importIssues } from "./importIssues.ts";
import type { ExportOptions } from "./kanbanize/types.ts";

// Default export directory
const DEFAULT_EXPORT_DIR = "./kanbanize-export";

const program = new Command();

program.name("kanbanize-migration").description("CLI tool for migrating from Kanbanize to Linear").version("1.0.0");

// =============================================================================
// Export Command
// =============================================================================
program
  .command("export")
  .description("Export cards from Kanbanize boards to local JSON files")
  .option("--board-ids <ids>", "Comma-separated list of Kanbanize board IDs to export (e.g., 7,8,10,13)")
  .option("--output-dir <path>", "Base output directory for exports", DEFAULT_EXPORT_DIR)
  .action(async options => {
    try {
      // Validate API key
      if (!process.env.KANBANIZE_API_KEY) {
        console.error(chalk.red("Error: KANBANIZE_API_KEY environment variable is required"));
        console.log(chalk.gray("Set it with: export KANBANIZE_API_KEY=your_api_key_here"));
        process.exit(1);
      }

      let boardIds: number[];

      // If board IDs not provided, fetch available boards and let user select
      if (!options.boardIds) {
        const { KanbanizeClient } = await import("./kanbanize/client.ts");
        const client = new KanbanizeClient();

        console.log(chalk.blue("\n🚀 Kanbanize Export\n"));
        console.log("Fetching available boards and workspaces...\n");

        const [boards, workspaces] = await Promise.all([client.getBoards(), client.getWorkspaces()]);

        if (boards.length === 0) {
          console.error(chalk.red("Error: No boards found"));
          process.exit(1);
        }

        // Create workspace lookup map
        const workspaceMap = new Map<number, string>();
        for (const workspace of workspaces) {
          workspaceMap.set(workspace.workspace_id, workspace.name);
        }

        const boardChoices = boards
          .map((board: { name: string; board_id: number; workspace_id: number }) => {
            const workspaceName = workspaceMap.get(board.workspace_id) || "Unknown";
            return {
              name: `${workspaceName} → ${board.name} (ID: ${board.board_id})`,
              value: board.board_id,
              workspace_id: board.workspace_id,
            };
          })
          .sort((a, b) => {
            // First sort by workspace_id
            if (a.workspace_id !== b.workspace_id) {
              return a.workspace_id - b.workspace_id;
            }
            // Then sort by board_id
            return a.value - b.value;
          });

        const { selectedBoardIds } = await inquirer.prompt<{ selectedBoardIds: number[] }>([
          {
            type: "checkbox",
            name: "selectedBoardIds",
            message: "Select boards to export:",
            choices: boardChoices,
            validate: (input: number[]) => input.length > 0 || "Please select at least one board",
          },
        ]);

        boardIds = selectedBoardIds;
      } else {
        // Parse board IDs from CLI option
        boardIds = options.boardIds
          .split(",")
          .map((id: string) => parseInt(id.trim(), 10))
          .filter((id: number) => !isNaN(id));

        if (boardIds.length === 0) {
          console.error(chalk.red("Error: No valid board IDs provided"));
          process.exit(1);
        }
      }

      const exportOptions: ExportOptions = {
        boardIds,
        outputDir: options.outputDir,
      };

      console.log(chalk.blue("\n🚀 Kanbanize Export\n"));
      console.log(`Board IDs: ${boardIds.join(", ")}`);
      console.log(`Output directory: ${options.outputDir}\n`);

      await runExport(exportOptions);
    } catch (error) {
      console.error(chalk.red(`\nExport failed: ${error}`));
      process.exit(1);
    }
  });

// =============================================================================
// Import Command
// =============================================================================
program
  .command("import")
  .description("Import cards from Kanbanize export to Linear")
  .option("--board-id <id>", "Board ID to import (will look in default export directory)")
  .option("--export-path <path>", "Path to a specific board export directory (e.g., ./kanbanize-export/board-7)")
  .option("--swimlane-ids <ids>", "Comma-separated list of swimlane IDs to import (lane_id)")
  .option(
    "--sections <sections>",
    "Comma-separated list of sections to migrate (1=Backlog, 2=Requested, 3=Progress, 4=Done, 5=Archive)"
  )
  .option("--status-mapping <path>", "Path to JSON file mapping column names to Linear status names")
  .option("--api-url <url>", "Linear API URL (optional, for development)")
  .action(async options => {
    try {
      // Get Linear API key
      let linearApiKey = process.env.LINEAR_API_KEY;

      if (!linearApiKey) {
        const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
          {
            type: "input",
            name: "apiKey",
            message: "Input your Linear API key (https://linear.app/settings/account/security):",
          },
        ]);
        linearApiKey = apiKey;
      }

      if (!linearApiKey) {
        console.error(chalk.red("Error: Linear API key is required"));
        process.exit(1);
      }

      console.log(chalk.blue("\n🚀 Kanbanize to Linear Import\n"));

      // Determine export path
      let exportPath: string | undefined = options.exportPath;

      // If board ID is provided, construct path from default directory
      if (options.boardId && !exportPath) {
        const fs = await import("fs");
        const path = await import("path");
        exportPath = path.join(DEFAULT_EXPORT_DIR, `board-${options.boardId}`);

        // Validate that the directory exists
        if (!fs.existsSync(exportPath)) {
          console.error(chalk.red(`Error: Export not found at ${exportPath}`));
          console.log(chalk.gray("Run 'pnpm kanbanize export' first to export boards"));
          process.exit(1);
        }
      }

      // If export path is provided via CLI, use non-interactive mode
      let importer;
      if (exportPath) {
        // Non-interactive mode with CLI options
        const { KanbanizeImporter } = await import("./importers/kanbanize/KanbanizeImporter.ts");
        const importOptions = {
          exportPath,
          swimlaneIds: options.swimlaneIds
            ? options.swimlaneIds.split(",").map((id: string) => parseInt(id.trim(), 10))
            : undefined,
          sections: options.sections
            ? options.sections.split(",").map((s: string) => parseInt(s.trim(), 10))
            : undefined,
          statusMapping: options.statusMapping
            ? JSON.parse((await import("fs")).readFileSync(options.statusMapping, "utf-8"))
            : undefined,
        };
        importer = new KanbanizeImporter(importOptions);
      } else {
        // Interactive mode - will scan DEFAULT_EXPORT_DIR automatically
        importer = await kanbanizeImport();
      }

      // Run the import
      await importIssues(linearApiKey, importer, options.apiUrl);
    } catch (error) {
      console.error(chalk.red(`\nImport failed: ${error}`));
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
