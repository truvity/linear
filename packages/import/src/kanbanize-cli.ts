#!/usr/bin/env node
/* eslint-disable no-console */
import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { runExport } from "./kanbanize/exporter.ts";
import { kanbanizeImport } from "./importers/kanbanize/index.ts";
import { importIssues } from "./importIssues.ts";
import type { ExportOptions } from "./kanbanize/types.ts";

const program = new Command();

program.name("kanbanize-migration").description("CLI tool for migrating from Kanbanize to Linear").version("1.0.0");

// =============================================================================
// Export Command
// =============================================================================
program
  .command("export")
  .description("Export cards from Kanbanize boards to local JSON files")
  .requiredOption("--board-ids <ids>", "Comma-separated list of Kanbanize board IDs to export (e.g., 7,8,10,13)")
  .option("--output-dir <path>", "Base output directory for exports", "./kanbanize-export")
  .action(async options => {
    try {
      // Validate API key
      if (!process.env.KANBANIZE_API_KEY) {
        console.error(chalk.red("Error: KANBANIZE_API_KEY environment variable is required"));
        console.log(chalk.gray("Set it with: export KANBANIZE_API_KEY=your_api_key_here"));
        process.exit(1);
      }

      // Parse board IDs
      const boardIds = options.boardIds
        .split(",")
        .map((id: string) => parseInt(id.trim(), 10))
        .filter((id: number) => !isNaN(id));

      if (boardIds.length === 0) {
        console.error(chalk.red("Error: No valid board IDs provided"));
        process.exit(1);
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
  .option("--export-path <path>", "Path to a specific board export directory (e.g., ./kanbanize-export/board-7)")
  .option("--swimlane-id <id>", "Filter cards by swimlane (lane_id)")
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

      // If export path is provided via CLI, use non-interactive mode
      let importer;
      if (options.exportPath) {
        // Non-interactive mode with CLI options
        const { KanbanizeImporter } = await import("./importers/kanbanize/KanbanizeImporter.ts");
        const importOptions = {
          exportPath: options.exportPath,
          swimlaneId: options.swimlaneId ? parseInt(options.swimlaneId, 10) : undefined,
          sections: options.sections
            ? options.sections.split(",").map((s: string) => parseInt(s.trim(), 10))
            : undefined,
          statusMapping: options.statusMapping
            ? JSON.parse((await import("fs")).readFileSync(options.statusMapping, "utf-8"))
            : undefined,
        };
        importer = new KanbanizeImporter(importOptions);
      } else {
        // Interactive mode
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
