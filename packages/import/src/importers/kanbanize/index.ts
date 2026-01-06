/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import type { Importer } from "../../types.ts";
import type {
  ImportOptions,
  KanbanizeBoardExport,
  KanbanizeBoardMetadata,
  KanbanizeLane,
  KanbanizeWorkflow,
} from "../../kanbanize/types.ts";
import { KanbanizeImporter } from "./KanbanizeImporter.ts";

interface KanbanizeImportAnswers {
  exportPath: string;
  swimlaneIds: number[];
  sections: number[];
  useStatusMapping: boolean;
  statusMappingPath?: string;
}

// Default export directory
const DEFAULT_EXPORT_DIR = "./kanbanize-export";

/**
 * Scan export directory for available board exports
 */
function scanExportDirectory(baseDir: string): { path: string; metadata: KanbanizeBoardMetadata }[] {
  const exports: { path: string; metadata: KanbanizeBoardMetadata }[] = [];

  if (!fs.existsSync(baseDir)) {
    return exports;
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("board-")) {
      const boardDir = path.join(baseDir, entry.name);
      const metadataPath = path.join(boardDir, "metadata.json");
      const exportPath = path.join(boardDir, "export.json");

      if (fs.existsSync(metadataPath) && fs.existsSync(exportPath)) {
        try {
          const metadata: KanbanizeBoardMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
          exports.push({ path: boardDir, metadata });
        } catch {
          // Skip invalid metadata files
          console.warn(`Warning: Could not read metadata from ${metadataPath}`);
        }
      }
    }
  }

  return exports;
}

/**
 * Interactive prompts for Kanbanize import configuration
 */
export const kanbanizeImport = async (): Promise<Importer> => {
  // Scan for available exports
  const availableExports = scanExportDirectory(DEFAULT_EXPORT_DIR);

  let exportPath: string;

  if (availableExports.length === 0) {
    // No exports found, ask user for path
    const answer = await inquirer.prompt<{ exportPath: string }>([
      {
        type: "input",
        name: "exportPath",
        message: "Path to Kanbanize board export directory:",
        validate: (input: string) => {
          const exportFilePath = path.join(input, "export.json");
          const metadataFilePath = path.join(input, "metadata.json");

          if (!fs.existsSync(exportFilePath)) {
            return `export.json not found in ${input}`;
          }
          if (!fs.existsSync(metadataFilePath)) {
            return `metadata.json not found in ${input}`;
          }
          return true;
        },
      },
    ]);
    exportPath = answer.exportPath;
  } else {
    // Show available exports with workspace and board names
    const exportChoices = availableExports
      .map(exp => ({
        name: `${exp.metadata.workspaceName} → ${exp.metadata.boardName} (Board ID: ${exp.metadata.boardId}, ${exp.metadata.cardCount} cards, exported: ${new Date(exp.metadata.exportedAt).toLocaleString("en-NL")})`,
        value: exp.path,
        workspaceId: exp.metadata.workspaceId,
        boardId: exp.metadata.boardId,
      }))
      .sort((a, b) => {
        // First sort by workspace_id
        if (a.workspaceId !== b.workspaceId) {
          return a.workspaceId - b.workspaceId;
        }
        // Then sort by board_id
        return a.boardId - b.boardId;
      });

    const { selectedPath } = await inquirer.prompt<{ selectedPath: string }>([
      {
        type: "list",
        name: "selectedPath",
        message: "Select board export to import:",
        choices: exportChoices,
      },
    ]);

    exportPath = selectedPath;
  }

  // Load export data to show available options
  const exportData: KanbanizeBoardExport = JSON.parse(fs.readFileSync(path.join(exportPath, "export.json"), "utf-8"));
  const metadata: KanbanizeBoardMetadata = JSON.parse(fs.readFileSync(path.join(exportPath, "metadata.json"), "utf-8"));

  console.log(`\nLoaded export for board: ${metadata.boardName}`);
  console.log(`Total cards: ${metadata.cardCount}`);
  console.log(`Exported at: ${metadata.exportedAt}\n`);

  // Get available lanes (swimlanes) and workflows
  const lanes = Object.values(exportData.lanes) as KanbanizeLane[];
  const workflows = exportData.workflows as Record<number, KanbanizeWorkflow>;

  // Count cards per lane
  const cardsPerLane: Record<number, number> = {};
  for (const card of exportData.cards) {
    cardsPerLane[card.lane_id] = (cardsPerLane[card.lane_id] || 0) + 1;
  }

  // Map workflow types to names
  const workflowTypeNames: Record<number, string> = {
    0: "Cards",
    1: "Initiatives",
    2: "Timeline",
  };

  // Create lane choices with workflow names and card counts
  const laneChoices = lanes
    .map(lane => {
      const workflow = workflows[lane.workflow_id];
      const workflowName = workflow?.name || workflowTypeNames[workflow?.type ?? 0] || "Unknown";
      const cardCount = cardsPerLane[lane.lane_id] || 0;
      return {
        name: `${workflowName} → ${lane.name} (${cardCount} cards)`,
        value: lane.lane_id,
        workflow_id: lane.workflow_id,
        workflow_position: workflow?.position ?? 0,
        lane_position: lane.position,
      };
    })
    .sort((a, b) => {
      // First sort by workflow position
      if (a.workflow_position !== b.workflow_position) {
        return a.workflow_position - b.workflow_position;
      }
      // Then by lane position within the same workflow
      return a.lane_position - b.lane_position;
    });

  // Count cards per section
  const cardsPerSection: Record<number, number> = {};
  for (const card of exportData.cards) {
    const column = exportData.columns[card.column_id];
    if (column) {
      cardsPerSection[column.section] = (cardsPerSection[column.section] || 0) + 1;
    }
  }

  // Section choices with card counts
  const sectionChoices = [
    { name: `Backlog (Section 1) - ${cardsPerSection[1] || 0} cards`, value: 1 },
    { name: `Requested (Section 2) - ${cardsPerSection[2] || 0} cards`, value: 2 },
    { name: `In Progress (Section 3) - ${cardsPerSection[3] || 0} cards`, value: 3 },
    { name: `Done (Section 4) - ${cardsPerSection[4] || 0} cards`, value: 4 },
    { name: `Archive (Section 5) - ${cardsPerSection[5] || 0} cards`, value: 5 },
  ];

  const answers = await inquirer.prompt<Omit<KanbanizeImportAnswers, "exportPath">>([
    {
      type: "checkbox",
      name: "swimlaneIds",
      message: "Select swimlanes to import (leave empty for all):",
      choices: laneChoices,
    },
    {
      type: "checkbox",
      name: "sections",
      message: "Select sections to import (leave empty for all):",
      choices: sectionChoices,
    },
    {
      type: "confirm",
      name: "useStatusMapping",
      message: "Do you want to use a custom status mapping file?",
      default: false,
    },
    {
      type: "input",
      name: "statusMappingPath",
      message: "Path to status mapping JSON file:",
      when: ans => ans.useStatusMapping,
      validate: (input: string) => {
        if (!fs.existsSync(input)) {
          return `File not found: ${input}`;
        }
        try {
          JSON.parse(fs.readFileSync(input, "utf-8"));
          return true;
        } catch {
          return "Invalid JSON file";
        }
      },
    },
  ]);

  // Load status mapping if provided
  let statusMapping: Record<string, string> | undefined;
  if (answers.useStatusMapping && answers.statusMappingPath) {
    statusMapping = JSON.parse(fs.readFileSync(answers.statusMappingPath, "utf-8"));
  }

  // Calculate filtered card count
  const filteredCards = exportData.cards.filter(card => {
    if (answers.swimlaneIds && answers.swimlaneIds.length > 0 && !answers.swimlaneIds.includes(card.lane_id)) {
      return false;
    }
    if (answers.sections && answers.sections.length > 0) {
      const column = exportData.columns[card.column_id];
      if (!column || !answers.sections.includes(column.section)) {
        return false;
      }
    }
    return true;
  });

  console.log(`\nWill import ${filteredCards.length} cards\n`);

  const importOptions: ImportOptions = {
    exportPath,
    swimlaneIds: answers.swimlaneIds.length > 0 ? answers.swimlaneIds : undefined,
    sections: answers.sections.length > 0 ? answers.sections : undefined,
    statusMapping,
  };

  return new KanbanizeImporter(importOptions);
};
