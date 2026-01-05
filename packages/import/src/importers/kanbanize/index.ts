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
} from "../../kanbanize/types.ts";
import { KanbanizeImporter } from "./KanbanizeImporter.ts";

interface KanbanizeImportAnswers {
  exportPath: string;
  swimlaneId?: number;
  sections: number[];
  useStatusMapping: boolean;
  statusMappingPath?: string;
}

/**
 * Interactive prompts for Kanbanize import configuration
 */
export const kanbanizeImport = async (): Promise<Importer> => {
  // First, ask for the export path
  const { exportPath } = await inquirer.prompt<{ exportPath: string }>([
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

  // Load export data to show available options
  const exportData: KanbanizeBoardExport = JSON.parse(fs.readFileSync(path.join(exportPath, "export.json"), "utf-8"));
  const metadata: KanbanizeBoardMetadata = JSON.parse(fs.readFileSync(path.join(exportPath, "metadata.json"), "utf-8"));

  console.log(`\nLoaded export for board: ${metadata.boardName}`);
  console.log(`Total cards: ${metadata.cardCount}`);
  console.log(`Exported at: ${metadata.exportedAt}\n`);

  // Get available lanes (swimlanes)
  const lanes = Object.values(exportData.lanes) as KanbanizeLane[];
  const laneChoices = [
    { name: "All swimlanes", value: undefined },
    ...lanes.map(lane => ({
      name: lane.name,
      value: lane.lane_id,
    })),
  ];

  // Section choices
  const sectionChoices = [
    { name: "Backlog (Section 1)", value: 1 },
    { name: "Requested (Section 2)", value: 2 },
    { name: "In Progress (Section 3)", value: 3 },
    { name: "Done (Section 4)", value: 4 },
    { name: "Archive (Section 5)", value: 5 },
  ];

  const answers = await inquirer.prompt<Omit<KanbanizeImportAnswers, "exportPath">>([
    {
      type: "list",
      name: "swimlaneId",
      message: "Select swimlane to import:",
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
    if (answers.swimlaneId !== undefined && card.lane_id !== answers.swimlaneId) {
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
    swimlaneId: answers.swimlaneId,
    sections: answers.sections.length > 0 ? answers.sections : undefined,
    statusMapping,
  };

  return new KanbanizeImporter(importOptions);
};
